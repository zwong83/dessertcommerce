import type { Queryable } from "../db";
import { ApiProblem } from "../http/problem";
import { canFitCapacity, isHandoffEligible, mytDate } from "./domain";
import { databaseTime, lockCapacityDates, lockPolicy, productDemand, readDays, readLimits, readPolicy, uuid,
  type CapacityClock, type ItemRow } from "./store";

export { lockCapacityDates } from "./store";

export type CapacityAllocation = { orderId: string; handoffAt: string; state: "HELD" | "COMMITTED" };
type AllocationRow = { product_id: string; quantity: number };

function unavailable() {
  return new ApiProblem("CAPACITY_UNAVAILABLE", 409, "This handoff is unavailable. Choose another time.");
}

/**
 * Use in Order's READ COMMITTED transaction after locking the order and any charge.
 * Call for an authorized hold, new commitment or remake. Source quantities from saved order lines.
 * Order owns transition, consent, promise and payment writes and must roll them back on failure.
 */
export async function allocateCapacity(tx: Queryable, input: CapacityAllocation, clock?: CapacityClock): Promise<void> {
  await allocate(tx, input, undefined, clock);
}

/** Swap unused allocations. Earlier USED generations stay counted, including on the same date. */
export async function reallocateCapacity(
  tx: Queryable, input: CapacityAllocation & { previousDate: string }, clock?: CapacityClock,
): Promise<void> {
  await allocate(tx, input, input.previousDate, clock);
}

async function allocate(tx: Queryable, input: CapacityAllocation, previousDate?: string, clock?: CapacityClock) {
  const orderId = uuid(input.orderId);
  const date = mytDate(input.handoffAt);
  await lockPolicy(tx, "share");
  // Catalogue edits lock the product before changing its variants.
  await tx.query(
    `SELECT p.id FROM product p
      WHERE p.id IN (SELECT product_id FROM standard_order_line WHERE order_id = $1)
      ORDER BY p.id FOR SHARE`,
    [orderId],
  );
  const { rows } = await tx.query<ItemRow & { quantity: number }>(
    `SELECT l.variant_id, l.product_id, l.quantity, p.status,
            COALESCE(v.available, false) AS available, COALESCE(v.prep_minutes, 0) AS prep_minutes
       FROM standard_order_line l JOIN product p ON p.id = l.product_id
       LEFT JOIN variant v ON v.id = l.variant_id AND v.product_id = l.product_id
      WHERE l.order_id = $1`,
    [orderId],
  );
  const demand = productDemand(rows.map((row) => ({ variantId: row.variant_id, quantity: row.quantity })), rows);
  await lockCapacityDates(tx, previousDate ? [previousDate, date] : [date]);

  const { rows: live } = await tx.query<AllocationRow>(
    `SELECT product_id, quantity FROM capacity_allocation
      WHERE order_id = $1 AND service_date = $2 AND state IN ('HELD','COMMITTED')`,
    [orderId, date],
  );
  if (live.length > 0 && previousDate !== date) {
    throw new ApiProblem("INVALID_TRANSITION", 409, "This order already has a live allocation.");
  }

  const policy = await readPolicy(tx);
  const [day] = await readDays(tx, date, date);
  const limits = new Map((await readLimits(tx, date, date)).map((row) => [row.product_id, row]));
  if (day && previousDate === date) {
    for (const row of live) {
      day.allocated -= row.quantity;
      const limit = limits.get(row.product_id);
      if (limit) limit.allocated -= row.quantity;
    }
  }
  const now = await databaseTime(tx, clock);
  if (!demand.sellable || !isHandoffEligible(policy, now, input.handoffAt, demand.prepMinutes) ||
      !canFitCapacity(day, limits, demand.units)) throw unavailable();

  if (previousDate) {
    const released = await changeAllocation(tx, orderId, previousDate, "RELEASED");
    if (previousDate !== date && released === 0) await advanceDates(tx, [previousDate]);
  }
  const quantities = [...demand.units.values()];
  const total = quantities.reduce((sum, quantity) => sum + quantity, 0);
  const update = await tx.query(
    `UPDATE capacity_day SET allocated_units = allocated_units + $2, version = version + 1
      WHERE service_date = $1 AND NOT closed AND allocated_units <= max_units - $2`,
    [date, total],
  );
  if (update.rowCount !== 1) throw unavailable();

  await tx.query(
    `INSERT INTO capacity_allocation (order_id, service_date, product_id, quantity, state, generation)
      SELECT $1, $2, demand.product_id, demand.quantity, $3, COALESCE(MAX(a.generation), 0) + 1
        FROM unnest($4::uuid[], $5::integer[]) AS demand(product_id, quantity)
        LEFT JOIN capacity_allocation a ON a.order_id = $1 AND a.service_date = $2 AND a.product_id = demand.product_id
       GROUP BY demand.product_id, demand.quantity`,
    [orderId, date, input.state, [...demand.units.keys()], quantities],
  );
}

/** Promote an existing hold after Order checks settlement and feasibility. */
export async function commitHeldCapacity(tx: Queryable, orderId: string, date: string): Promise<number> {
  await lockCapacityDates(tx, [date]);
  return changeAllocation(tx, uuid(orderId), date, "COMMITTED");
}

/** Begin production for committed units. USED units continue counting against both limits. */
export async function markCapacityUsed(tx: Queryable, orderId: string, date: string): Promise<number> {
  await lockCapacityDates(tx, [date]);
  return changeAllocation(tx, uuid(orderId), date, "USED");
}

/** Release unused units and advance the date revision in the same statement. Replays return zero. */
export async function releaseCapacity(tx: Queryable, orderId: string, date: string): Promise<number> {
  await lockCapacityDates(tx, [date]);
  return changeAllocation(tx, uuid(orderId), date, "RELEASED");
}

async function changeAllocation(
  tx: Queryable, orderId: string, date: string, state: "COMMITTED" | "USED" | "RELEASED",
): Promise<number> {
  const from = state === "COMMITTED" ? ["HELD"] : state === "USED" ? ["COMMITTED"] : ["HELD", "COMMITTED"];
  const { rows: [row] } = await tx.query<{ units: number }>(
    `WITH changed AS (
       UPDATE capacity_allocation SET state = $3
        WHERE order_id = $1 AND service_date = $2 AND state = ANY($4::text[]) RETURNING quantity
     ), totals AS (SELECT COALESCE(SUM(quantity), 0)::integer AS units FROM changed)
     UPDATE capacity_day SET allocated_units = allocated_units - CASE WHEN $3 = 'RELEASED' THEN totals.units ELSE 0 END,
            version = version + 1
       FROM totals WHERE service_date = $2 AND totals.units > 0 RETURNING totals.units`,
    [orderId, date, state, from],
  );
  return row?.units ?? 0;
}

/**
 * Call in the same Order transaction for any impact-visible write that didn't
 * already advance the date revision via an allocation change. For moves include both dates.
 */
export async function bumpCapacityImpact(tx: Queryable, dates: readonly string[]): Promise<void> {
  await lockCapacityDates(tx, dates);
  await advanceDates(tx, dates);
}

async function advanceDates(tx: Queryable, dates: readonly string[]): Promise<void> {
  const { rows } = await tx.query<{ date: string }>(
    `UPDATE capacity_day SET version = version + 1 WHERE service_date = ANY($1::date[])
     RETURNING to_char(service_date, 'YYYY-MM-DD') AS date`,
    [dates],
  );
  const existing = new Set(rows.map((row) => row.date));
  const missing = [...new Set(dates)].filter((date) => !existing.has(date));
  if (!missing.length) return;
  await tx.query(
    `INSERT INTO capacity_day (service_date, closed, max_units)
      SELECT day, false, 0 FROM unnest($1::date[]) AS dates(day)`,
    [missing],
  );
}
