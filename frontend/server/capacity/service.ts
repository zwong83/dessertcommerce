import type { Pool } from "pg";
import type { components, operations } from "../../contracts/standard-v1";
import { withTransaction, type Queryable } from "../db";
import { ApiProblem, validation } from "../http/problem";
import { audit, command, conflict, createImpactSigner, requireRole, type CapacityActor, type CapacityCommand } from "./commands";
import { addDays, canFitCapacity, dateMillis, earliestHandoff, isHandoffEligible, mytDate } from "./domain";
import {
  databaseTime, lockCapacityDates, lockPolicy, productDemand, projectPolicy, readDays, readLimits, readPolicy, uuid, weekdays,
  type CapacityClock, type DayRow, type ItemRow, type OperatingPolicy,
} from "./store";

type Body<K extends keyof operations> = operations[K] extends {
  requestBody: { content: { "application/json": infer T } };
} ? T : never;
type Success<K extends keyof operations> = operations[K] extends {
  responses: { 200: { content: { "application/json": infer T } } };
} ? T : never;
type Actor = CapacityActor | null | undefined;
type ImpactEdit = Body<"previewCapacityImpact">;
type Impact = components["schemas"]["CapacityImpact"];
type ImpactPage = NonNullable<operations["previewCapacityImpact"]["parameters"]["query"]>;
type CalendarQuery = operations["getCapacityCalendar"]["parameters"]["query"];

const previewLifetimeMs = 10 * 60_000;
const maxPgInteger = 2_147_483_647;
const hhmm = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const fulfilmentModes = ["PICKUP", "MERCHANT_LALAMOVE", "CUSTOMER_LALAMOVE"];

function isUnitLimit(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= maxPgInteger;
}

function normalizeEdit(input: ImpactEdit): ImpactEdit {
  dateMillis(input.date);
  if (typeof input.closed !== "boolean" || !isUnitLimit(input.dayLimit) ||
      !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion === Number.MAX_SAFE_INTEGER ||
      !Array.isArray(input.productLimits) || input.productLimits.length > 100) {
    throw validation("Check the date, revision and capacity limits.");
  }
  const productLimits = input.productLimits.map(({ productId, limit }) => {
    if (!isUnitLimit(limit)) throw validation("Product limits must be non-negative whole units.");
    return { productId: uuid(productId), limit };
  }).sort((a, b) => a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0);
  if (new Set(productLimits.map((item) => item.productId)).size !== productLimits.length) {
    throw validation("Use one limit per product.");
  }
  return { date: input.date, closed: input.closed, dayLimit: input.dayLimit, productLimits, expectedVersion: input.expectedVersion };
}

async function checkProducts(tx: Queryable, edit: ImpactEdit, lock: boolean): Promise<void> {
  if (edit.productLimits.length === 0) return;
  const { rows } = await tx.query(
    "SELECT id FROM product WHERE id = ANY($1::uuid[]) ORDER BY id" + (lock ? " FOR KEY SHARE" : ""),
    [edit.productLimits.map((limit) => limit.productId)],
  );
  if (rows.length !== edit.productLimits.length) throw new ApiProblem("NOT_FOUND", 404, "A product was not found.");
}

async function protectCounts(tx: Queryable, edit: ImpactEdit, day: DayRow | undefined) {
  const { rows } = await tx.query<{ product_id: string; occupied: number; used: number }>(
    `SELECT product_id, SUM(quantity)::integer AS occupied,
            COALESCE(SUM(quantity) FILTER (WHERE state = 'USED'), 0)::integer AS used
       FROM capacity_allocation WHERE service_date = $1 AND state IN ('HELD','COMMITTED','USED')
      GROUP BY product_id`,
    [edit.date],
  );
  const occupiedUnits = Math.max(day?.allocated ?? 0, rows.reduce((total, row) => total + row.occupied, 0));
  const usedUnits = rows.reduce((total, row) => total + row.used, 0);
  const totals = new Map(rows.map((row) => [row.product_id, row.occupied]));
  return {
    occupiedUnits,
    usedUnits,
    canSave: edit.dayLimit >= occupiedUnits &&
      edit.productLimits.every((limit) => limit.limit >= (totals.get(limit.productId) ?? 0)),
  };
}

type ImpactItem = Impact["items"][number];
type ImpactRow = ImpactItem & { createdAt: string };
type Anchor = [createdAt: string, orderId: string];

async function affectedOrders(tx: Queryable, edit: ImpactEdit, day: DayRow | undefined, limit: number, anchor?: Anchor) {
  const wholeDay = (day?.closed ?? false) !== edit.closed || (day?.max ?? 0) !== edit.dayLimit;
  let products: string[] | null = null;
  if (!wholeDay) {
    const proposed = new Map(edit.productLimits.map(({ productId, limit }) => [productId, limit]));
    const current = new Map((await readLimits(tx, edit.date, edit.date)).map((row) => [row.product_id, row.max]));
    products = [...new Set([...proposed.keys(), ...current.keys()])].filter((id) => proposed.get(id) !== current.get(id));
    if (!products.length) return { items: [], affectedCount: 0 };
  }

  const { rows: [row] } = await tx.query<{ items: ImpactRow[]; affected_count: number }>(
    `WITH affected AS (
       SELECT o.id AS "orderId", o.order_number AS "orderNumber", o.status, o.created_at,
              to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
              CASE WHEN o.status IN ('AWAITING_CASH','AWAITING_FEE') OR
                   (o.status = 'EXCEPTION' AND o.accepted_at IS NULL AND NOT EXISTS (
                     SELECT 1 FROM capacity_allocation a WHERE a.order_id = o.id AND a.service_date = o.service_date
                       AND a.state IN ('HELD','COMMITTED','USED')))
                   THEN 'PENDING_RECHECK' ELSE 'EXISTING_COMMITMENT' END AS kind,
              line.units, o.promised_handoff_at AS "promisedHandoffAt"
         FROM standard_order o
         JOIN LATERAL (SELECT SUM(l.quantity)::integer AS units FROM standard_order_line l
                        WHERE l.order_id = o.id AND ($2::uuid[] IS NULL OR l.product_id = ANY($2))) line
           ON line.units IS NOT NULL
        WHERE o.service_date = $1 AND o.status NOT IN ('COMPLETED','EXPIRED','CANCELLED','REJECTED','NO_SHOW')
     ), page AS (
       SELECT * FROM affected WHERE $3::timestamptz IS NULL OR (created_at, "orderId") > ($3, $4::uuid)
        ORDER BY created_at, "orderId" LIMIT $5
     )
     SELECT (SELECT COUNT(*)::integer FROM affected) AS affected_count,
            COALESCE(jsonb_agg(to_jsonb(page) - 'created_at' ORDER BY created_at, "orderId"), '[]') AS items FROM page`,
    [edit.date, products, anchor?.[0] ?? null, anchor?.[1] ?? null, limit + 1],
  );
  return { items: row.items, affectedCount: row.affected_count };
}

export function createCapacity({ pool, impactKey, clock }: { pool: Pool; impactKey: Uint8Array; clock?: CapacityClock }) {
  const signer = createImpactSigner(impactKey);

  async function evaluateAvailability(actor: Actor, input: Body<"evaluateAvailability">): Promise<Success<"evaluateAvailability">> {
    requireRole(actor, "CUSTOMER");
    const date = mytDate(input.requestedHandoffAt);
    if (!fulfilmentModes.includes(input.fulfilment) || !Array.isArray(input.items) ||
        input.items.length < 1 || input.items.length > 100) throw validation("Check the handoff and selected items.");
    const items = input.items.map(({ variantId, quantity }) => {
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw validation("Check the item quantities.");
      return { variantId: uuid(variantId), quantity };
    });

    return withTransaction(pool, async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const evaluatedAt = await databaseTime(tx, clock);
      const { rows } = await tx.query<ItemRow>(
        `SELECT v.id AS variant_id, p.id AS product_id, p.status, v.available, v.prep_minutes
           FROM variant v JOIN product p ON p.id = v.product_id WHERE v.id = ANY($1::uuid[])`,
        [items.map((item) => item.variantId)],
      );
      const demand = productDemand(items, rows);
      if (!demand.sellable) return { eligible: false, alternatives: [], evaluatedAt };

      const policy = await readPolicy(tx);
      const today = mytDate(evaluatedAt);
      const end = addDays(today, 30);
      const canHandoff = isHandoffEligible(policy, evaluatedAt, input.requestedHandoffAt, demand.prepMinutes);
      const [requestedDay] = canHandoff ? await readDays(tx, date, date) : [];
      if (requestedDay) {
        const limits = new Map((await readLimits(tx, date, date)).map((row) => [row.product_id, row]));
        if (canFitCapacity(requestedDay, limits, demand.units)) return { eligible: true, alternatives: [], evaluatedAt };
      }

      const days = await readDays(tx, today, end);
      const limitsByDate = new Map<string, Map<string, { max: number; allocated: number }>>();
      for (const row of await readLimits(tx, today, end)) {
        const limits = limitsByDate.get(row.date) ?? new Map();
        limits.set(row.product_id, row);
        limitsByDate.set(row.date, limits);
      }
      const alternatives: string[] = [];
      for (const day of days) {
        if (!canFitCapacity(day, limitsByDate.get(day.date) ?? new Map(), demand.units)) continue;
        const alternative = earliestHandoff(policy, evaluatedAt, day.date, demand.prepMinutes);
        if (alternative) alternatives.push(alternative);
        if (alternatives.length === 20) break;
      }
      return { eligible: false, alternatives, evaluatedAt };
    });
  }

  async function getCapacityCalendar(actor: Actor, { from, to }: CalendarQuery): Promise<Success<"getCapacityCalendar">> {
    requireRole(actor, "ADMIN");
    const span = dateMillis(to) - dateMillis(from);
    if (span < 0 || span > 30 * 86_400_000) throw validation("Use a calendar range of at most 31 days.");
    return withTransaction(pool, async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const days = await readDays(tx, from, to);
      const limits = await readLimits(tx, from, to);
      return { days: days.map((day) => ({
        date: day.date, closed: day.closed, version: Number(day.version), maxUnits: day.max, allocatedUnits: day.allocated,
        productLimits: limits.filter((row) => row.date === day.date).map((row) => ({
          productId: row.product_id, maxUnits: row.max, allocatedUnits: row.allocated,
        })),
        eventWindows: [],
      })) };
    });
  }

  async function getOperatingPolicy(actor: Actor): Promise<OperatingPolicy> {
    requireRole(actor, "ADMIN");
    return projectPolicy(await readPolicy(pool));
  }

  async function updateOperatingPolicy(
    actor: Actor, input: Body<"updateOperatingPolicy">, ifMatch: string, context: CapacityCommand,
  ): Promise<OperatingPolicy> {
    const actorId = requireRole(actor, "ADMIN");
    const expected = /^"([1-9]\d*)"$/.exec(ifMatch);
    const version = Number(expected?.[1]);
    if (!Number.isSafeInteger(version) || version === Number.MAX_SAFE_INTEGER || !Array.isArray(input.openWeekdays) ||
        input.openWeekdays.length < 1 || input.openWeekdays.length > 7 ||
        new Set(input.openWeekdays).size !== input.openWeekdays.length ||
        !input.openWeekdays.every((day) => weekdays.includes(day)) ||
        !hhmm.test(input.opensAt) || !hhmm.test(input.closesAt) || input.closesAt <= input.opensAt) {
      throw validation("Check the operating hours, weekdays and policy revision.");
    }
    const policy = {
      openWeekdays: input.openWeekdays.map((day) => weekdays.indexOf(day) + 1).sort((a, b) => a - b),
      opensAt: input.opensAt, closesAt: input.closesAt, version: version + 1,
    };
    return withTransaction(pool, (tx) => command(tx, actorId, "updateOperatingPolicy", context, policy, async () => {
      await lockPolicy(tx, "exclusive");
      if ((await readPolicy(tx)).version !== version) throw conflict();
      await tx.query(
        `INSERT INTO operating_policy (singleton, open_weekdays, opens_at, closes_at, version) VALUES (TRUE, $1, $2, $3, $4)
         ON CONFLICT (singleton) DO UPDATE SET open_weekdays = EXCLUDED.open_weekdays, opens_at = EXCLUDED.opens_at,
           closes_at = EXCLUDED.closes_at, version = EXCLUDED.version`,
        [policy.openWeekdays, policy.opensAt, policy.closesAt, policy.version],
      );
      await audit(tx, actorId, "UPDATE_OPERATING_POLICY", "00000000-0000-4000-8000-000000000001", context, policy);
      return projectPolicy(policy);
    }));
  }

  async function previewCapacityImpact(actor: Actor, input: ImpactEdit, context: CapacityCommand, page: ImpactPage = {}): Promise<Impact> {
    const actorId = requireRole(actor, "ADMIN");
    const edit = normalizeEdit(input);
    const limit = page.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
        (page.cursor !== undefined && (typeof page.cursor !== "string" || !page.cursor || page.cursor.length > 500))) {
      throw validation("Check the impact page parameters.");
    }
    const cursorBinding = ["capacity-cursor", actorId, edit];
    let anchor: Anchor | undefined;
    if (page.cursor !== undefined) {
      const decoded = signer.decode(page.cursor, cursorBinding);
      if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== "string" || typeof decoded[1] !== "string") {
        throw validation("Use the cursor from this impact preview.");
      }
      anchor = [decoded[0], decoded[1]];
    }

    return withTransaction(pool, (tx) => command(tx, actorId, "previewCapacityImpact", context,
      [edit, limit, page.cursor ?? null], async () => {
        await checkProducts(tx, edit, false);
        await lockCapacityDates(tx, [edit.date]);
        const now = await databaseTime(tx, clock);
        if (edit.date < mytDate(now)) throw validation("Choose today or a future MYT date.");
        const [day] = await readDays(tx, edit.date, edit.date);
        if (Number(day?.version ?? 0) !== edit.expectedVersion) throw conflict();
        const { occupiedUnits, usedUnits, canSave } = await protectCounts(tx, edit, day);
        const { items, affectedCount } = await affectedOrders(tx, edit, day, limit, anchor);
        const last = items[limit - 1];
        const expires = Date.parse(now) + previewLifetimeMs;
        return {
          date: edit.date, expectedVersion: edit.expectedVersion, occupiedUnits, usedUnits, canSave, affectedCount,
          impactToken: signer.encode(expires, ["capacity-confirm", actorId, edit]),
          expiresAt: new Date(expires).toISOString(),
          items: items.slice(0, limit).map(({ createdAt, ...item }) => item),
          nextCursor: items.length > limit ? signer.encode([last.createdAt, last.orderId], cursorBinding) : null,
        };
      }));
  }

  async function configureCapacity(
    actor: Actor, input: Body<"configureCapacity">, context: CapacityCommand,
  ): Promise<Success<"configureCapacity">> {
    const actorId = requireRole(actor, "ADMIN");
    const edit = normalizeEdit(input);
    if (typeof input.impactToken !== "string" || !input.impactToken || input.impactToken.length > 600) {
      throw validation("Provide the impact token for this edit.");
    }
    return withTransaction(pool, (tx) => command(tx, actorId, "configureCapacity", context,
      [edit, input.impactToken], async () => {
        await checkProducts(tx, edit, true);
        await lockCapacityDates(tx, [edit.date]);
        const now = await databaseTime(tx, clock);
        const expires = signer.decode(input.impactToken, ["capacity-confirm", actorId, edit]);
        const [day] = await readDays(tx, edit.date, edit.date);
        if (typeof expires !== "number" || Date.parse(now) >= expires || edit.date < mytDate(now) ||
            Number(day?.version ?? 0) !== edit.expectedVersion) throw conflict();
        if (!(await protectCounts(tx, edit, day)).canSave) {
          throw new ApiProblem("CAPACITY_UNAVAILABLE", 409, "Capacity limits must cover occupied and used units.");
        }
        const version = edit.expectedVersion + 1;
        await tx.query(
          `INSERT INTO capacity_day (service_date, closed, max_units, version) VALUES ($1, $2, $3, $4)
           ON CONFLICT (service_date) DO UPDATE SET closed = EXCLUDED.closed, max_units = EXCLUDED.max_units,
             version = EXCLUDED.version`,
          [edit.date, edit.closed, edit.dayLimit, version],
        );
        await tx.query("DELETE FROM capacity_product_limit WHERE service_date = $1", [edit.date]);
        await tx.query(
          `INSERT INTO capacity_product_limit (service_date, product_id, max_units)
           SELECT $1, product_id, max_units FROM unnest($2::uuid[], $3::integer[]) AS caps(product_id, max_units)`,
          [edit.date, edit.productLimits.map((limit) => limit.productId), edit.productLimits.map((limit) => limit.limit)],
        );
        const resource = `00000000-0000-4000-8000-0000${edit.date.replaceAll("-", "")}`;
        await audit(tx, actorId, "CONFIGURE_CAPACITY", resource, context, { ...edit, version });
        return { date: edit.date, version };
      }));
  }

  return { evaluateAvailability, getCapacityCalendar, getOperatingPolicy, updateOperatingPolicy, previewCapacityImpact, configureCapacity };
}

export type Capacity = ReturnType<typeof createCapacity>;
export type { CapacityActor, CapacityCommand } from "./commands";
export type { CapacityClock } from "./store";
