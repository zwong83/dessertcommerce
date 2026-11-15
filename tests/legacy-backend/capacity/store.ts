import type { Queryable } from "../db";
import type { components } from "../../../frontend/contracts/standard-v1";
import { validation } from "../http/problem";
import { dateMillis, type HandoffPolicy } from "./domain";

export const weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function uuid(value: string): string {
  if (!uuidPattern.test(value)) throw validation("Use a valid identifier.");
  return value.toLowerCase();
}

export type CapacityClock = () => Date | string;
export type OperatingPolicy = components["schemas"]["OperatingPolicy"];
type PolicyRow = { open_weekdays: number[]; opens_at: string; closes_at: string; version: string };

export async function databaseTime(tx: Queryable, clock?: CapacityClock): Promise<string> {
  if (clock) {
    const now = clock();
    return typeof now === "string" ? now : now.toISOString();
  }
  const { rows: [row] } = await tx.query<{ time: string }>(
    `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS time`,
  );
  return row.time;
}

export async function readPolicy(tx: Queryable): Promise<HandoffPolicy & { version: number }> {
  const { rows: [row] } = await tx.query<PolicyRow>(
    "SELECT open_weekdays, opens_at::text, closes_at::text, version FROM operating_policy WHERE singleton",
  );
  return row
    ? { openWeekdays: row.open_weekdays, opensAt: row.opens_at.slice(0, 5), closesAt: row.closes_at.slice(0, 5), version: Number(row.version) }
    : { openWeekdays: [1, 2, 3, 4, 5, 6, 7], opensAt: "06:00", closesAt: "22:00", version: 1 };
}

export async function lockPolicy(tx: Queryable, mode: "share" | "exclusive"): Promise<void> {
  // The lock also protects the default policy before the singleton is first saved.
  await tx.query(mode === "share"
    ? "SELECT pg_advisory_xact_lock_shared(1599625048, 24)"
    : "SELECT pg_advisory_xact_lock(1599625048, 24)");
}

export function projectPolicy(policy: HandoffPolicy & { version: number }): OperatingPolicy {
  return {
    version: policy.version,
    timezone: "Asia/Kuala_Lumpur",
    openWeekdays: policy.openWeekdays.map((day) => weekdays[day - 1]),
    opensAt: policy.opensAt,
    closesAt: policy.closesAt,
    sameDaySubmitCutoff: "18:00",
    latestSameDayHandoff: "21:00",
    eventRollover: "22:00",
  };
}

export type DayRow = { date: string; closed: boolean; max: number; allocated: number; version: string };
export type LimitRow = { date: string; product_id: string; max: number; allocated: number };

export async function readDays(tx: Queryable, from: string, to: string): Promise<DayRow[]> {
  const { rows } = await tx.query<DayRow>(
    `SELECT to_char(service_date, 'YYYY-MM-DD') AS date, closed, max_units AS max, allocated_units AS allocated, version
       FROM capacity_day WHERE service_date BETWEEN $1 AND $2 ORDER BY service_date`,
    [from, to],
  );
  return rows;
}

export async function readLimits(tx: Queryable, from: string, to: string): Promise<LimitRow[]> {
  const { rows } = await tx.query<LimitRow>(
    `SELECT to_char(l.service_date, 'YYYY-MM-DD') AS date, l.product_id, l.max_units AS max,
            COALESCE(SUM(a.quantity), 0)::integer AS allocated
       FROM capacity_product_limit l
       LEFT JOIN capacity_allocation a ON a.service_date = l.service_date AND a.product_id = l.product_id
        AND a.state IN ('HELD','COMMITTED','USED')
      WHERE l.service_date BETWEEN $1 AND $2
      GROUP BY l.service_date, l.product_id, l.max_units ORDER BY l.service_date, l.product_id`,
    [from, to],
  );
  return rows;
}

/** Lock after Order/charge and any catalogue/policy locks. Pass all affected dates together. */
export async function lockCapacityDates(tx: Queryable, dates: readonly string[]): Promise<void> {
  const ordered = [...new Set(dates)].sort();
  for (const date of ordered) {
    // A date with no row still needs a lock for the first edit or pending intake.
    await tx.query("SELECT pg_advisory_xact_lock(1599625049, $1)", [dateMillis(date) / 86_400_000]);
    await tx.query("SELECT service_date FROM capacity_day WHERE service_date = $1 FOR UPDATE", [date]);
  }
}

export type ItemRow = { variant_id: string; product_id: string; status: string; available: boolean; prep_minutes: number };

export function productDemand(
  items: readonly { variantId: string; quantity: number }[],
  rows: readonly ItemRow[],
): { units: Map<string, number>; prepMinutes: number; sellable: boolean } {
  const variants = new Map(rows.map((row) => [row.variant_id, row]));
  const units = new Map<string, number>();
  let prepMinutes = 0;
  let sellable = items.length > 0;
  for (const { variantId, quantity } of items) {
    const row = variants.get(variantId);
    if (!row || row.status !== "LISTED" || !row.available) {
      sellable = false;
      continue;
    }
    units.set(row.product_id, (units.get(row.product_id) ?? 0) + quantity);
    prepMinutes = Math.max(prepMinutes, row.prep_minutes);
  }
  return { units, prepMinutes, sellable };
}
