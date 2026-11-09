import assert from "node:assert/strict";
import test from "node:test";
import { canFitCapacity, earliestHandoff, isHandoffEligible, mytDate } from "../src/server/capacity/domain";

const policy = { openWeekdays: [1, 2, 3, 4, 5, 6, 7], opensAt: "06:00", closesAt: "22:00" };
const atCutoff = "2026-11-09T18:00:00+08:00";
const atHandoff = "2026-11-09T13:00:00Z";

test("SC-16 accepts the exact MYT submission, handoff and preparation boundaries", () => {
  assert.equal(isHandoffEligible(policy, atCutoff, atHandoff, 180), true);
  assert.equal(mytDate("2026-11-08T16:00:00Z"), "2026-11-09");
  assert.equal(mytDate("2026-11-08T15:59:59.999999Z"), "2026-11-08");
  assert.equal(mytDate("2026-11-08T15:59:59.9999999999Z"), "2026-11-08");
});

test("SC-17 rejects each missed boundary independently and offers the next eligible date", () => {
  const late = "2026-11-09T10:00:00.000001Z";
  assert.equal(isHandoffEligible(policy, late, atHandoff, 0), false);
  assert.equal(isHandoffEligible(policy, atCutoff, "2026-11-09T13:00:00.000001Z", 0), false);
  assert.equal(isHandoffEligible(policy, atCutoff, "2026-11-09T12:59:59.999999Z", 180), false);
  assert.equal(earliestHandoff(policy, late, "2026-11-09", 0), null);
  assert.equal(earliestHandoff(policy, late, "2026-11-10", 180), "2026-11-09T22:00:00.000Z");
  assert.equal(isHandoffEligible(policy, atCutoff, "2026-11-10T22:00:00+08:00", 180), true);
});

test("SC-18 applies MYT weekdays, operating hours, closures and both unit limits", () => {
  const weekdays = { ...policy, openWeekdays: [1] };
  assert.equal(isHandoffEligible(weekdays, atCutoff, "2026-11-10T12:00:00+08:00", 0), false);
  assert.equal(isHandoffEligible(policy, "2026-11-09T00:00:00+08:00", "2026-11-09T05:59:59+08:00", 0), false);
  const units = new Map([["cake", 2], ["cookie", 1]]);
  const limits = new Map([["cake", { max: 4, allocated: 2 }]]);
  assert.equal(canFitCapacity({ closed: false, max: 6, allocated: 3 }, limits, units), true);
  assert.equal(canFitCapacity({ closed: true, max: 6, allocated: 3 }, limits, units), false);
  assert.equal(canFitCapacity({ closed: false, max: 5, allocated: 3 }, limits, units), false);
  assert.equal(canFitCapacity({ closed: false, max: 6, allocated: 3 }, new Map([["cake", { max: 3, allocated: 2 }]]), units), false);
  assert.equal(canFitCapacity(undefined, limits, units), false);
});

test("rejects impossible dates and timestamps without a timezone", () => {
  assert.throws(() => mytDate("2026-02-30T12:00:00Z"), { code: "VALIDATION" });
  assert.throws(() => mytDate("2026-11-09T18:00:00"), { code: "VALIDATION" });
});
