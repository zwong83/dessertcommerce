import { validation } from "../http/problem";

const millisecondsPerMinute = 60_000;
const mytOffset = 480 * millisecondsPerMinute;
const millisecondsPerDay = 86_400_000;

type Instant = { wholeMillis: number; fraction: string };

export interface HandoffPolicy {
  openWeekdays: readonly number[];
  opensAt: string;
  closesAt: string;
}

export interface UnitLimit {
  max: number;
  allocated: number;
}

export function dateMillis(date: string): number {
  const millis = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000") ||
      !Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 10) !== date) {
    throw validation("Use a valid calendar date.");
  }
  return millis;
}

export function addDays(date: string, days: number): string {
  return new Date(dateMillis(date) + days * millisecondsPerDay).toISOString().split("T")[0];
}

function instant(value: string): Instant {
  const match = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d+))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.exec(value);
  if (!match) throw validation("Use a valid handoff timestamp with an explicit timezone.");
  const [, date, time, fraction = "", offset] = match;
  dateMillis(date);
  // Keep the full fraction so conversion to JavaScript Date cannot round across a cutoff.
  return { wholeMillis: Date.parse(`${date}T${time}${offset}`), fraction: fraction.replace(/0+$/, "") };
}

function localDate(value: Instant): string {
  return new Date(value.wholeMillis + mytOffset).toISOString().split("T")[0];
}

function compare(left: Instant, right: Instant): number {
  return left.wholeMillis - right.wholeMillis ||
    (left.fraction < right.fraction ? -1 : left.fraction > right.fraction ? 1 : 0);
}

export function mytDate(timestamp: string): string {
  return localDate(instant(timestamp));
}

function localTime(date: string, time: string): Instant {
  return instant(`${date}T${time}:00+08:00`);
}

function handoffWindow(policy: HandoffPolicy, now: Instant, date: string, prepMinutes: number) {
  const weekday = new Date(dateMillis(date)).getUTCDay() || 7;
  const today = localDate(now);
  const sameDay = date === today;
  if (!policy.openWeekdays.includes(weekday) || date < today || (sameDay && compare(now, localTime(date, "18:00")) > 0)) {
    return null;
  }

  const opens = localTime(date, policy.opensAt);
  const ready = { ...now, wholeMillis: now.wholeMillis + prepMinutes * millisecondsPerMinute };
  const closes = sameDay && policy.closesAt > "21:00" ? "21:00" : policy.closesAt;
  return { earliest: compare(opens, ready) > 0 ? opens : ready, latest: localTime(date, closes) };
}

export function isHandoffEligible(policy: HandoffPolicy, now: string, handoff: string, prepMinutes: number): boolean {
  const requested = instant(handoff);
  const window = handoffWindow(policy, instant(now), localDate(requested), prepMinutes);
  return window !== null && compare(requested, window.earliest) >= 0 && compare(requested, window.latest) <= 0;
}

export function earliestHandoff(policy: HandoffPolicy, now: string, date: string, prepMinutes: number): string | null {
  const window = handoffWindow(policy, instant(now), date, prepMinutes);
  if (!window || compare(window.earliest, window.latest) > 0) return null;
  const timestamp = new Date(window.earliest.wholeMillis).toISOString();
  return window.earliest.fraction ? timestamp.replace(".000Z", `.${window.earliest.fraction}Z`) : timestamp;
}

export function canFitCapacity(
  day: (UnitLimit & { closed: boolean }) | undefined,
  limits: ReadonlyMap<string, UnitLimit>,
  units: ReadonlyMap<string, number>,
): boolean {
  let total = 0;
  for (const [productId, quantity] of units) {
    const limit = limits.get(productId);
    if (limit && quantity > limit.max - limit.allocated) return false;
    total += quantity;
  }
  return day !== undefined && !day.closed && total <= day.max - day.allocated;
}
