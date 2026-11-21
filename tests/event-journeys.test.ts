import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventDetails, QuoteDetails } from "../frontend/ui/event-details";
import {
  acceptancePayload, balanceCutoff, canReschedule, earliestRequestDate, equipmentCheckPayload, equipmentOutPayload,
  eventCancellation, eventChargePath, eventWorkTarget, extrasPayload, merchantCancellationOptions, merchantCancellationPayload,
  noticeResolution, quotePayload, requestPayload, reschedulePayload, schedulePayload,
  type EventBooking, type EventCharge, type MerchantEvent, type Notice,
} from "../frontend/ui/event-model";
import { prepareMutation, sendStandard, StandardProblem } from "../frontend/ui/standard-api";
import type { WorkItem } from "../frontend/ui/standard-model";

const id = (n: number) => "10000000-0000-4000-8000-" + String(n).padStart(12, "0");
const [eventId, quoteId, chargeId, depositId, equipmentId, noticeId, commandId] = Array.from({ length: 7 }, (_, i) => id(i + 1));
const now = Date.parse("2026-12-01T02:00:00Z");
const requested = {
  eventDate: "2026-12-08", setupReadyAt: "10:00", startAt: "11:00", expectedEndAt: "14:00",
  line1: "1 Example Lane", city: "Test City", postcode: "50000", region: "Test Region",
  guestCount: "30", budget: "199.05", occasion: "Sample event", theme: "None", specialRequirements: "None",
  contactName: "Test Customer", phone: "+60000000000",
};
const scheduleFields = {
  setupReadyAt: "2026-12-20T10:00", eventStartAt: "2026-12-20T11:00", eventEndAt: "2026-12-20T13:00", teardownAt: "2026-12-20T14:00",
  windowStartAt: "2026-12-20T09:00", windowEndAt: "2026-12-20T15:00",
};
const quoteFields = {
  ...scheduleFields, total: "0.03", depositDueAt: "2026-12-16T11:00", balanceDueAt: "2026-12-17T10:00",
  packageSummary: "Sample dessert package", serviceSummary: "Sample service", extraChargeTerms: "Agreed extras only",
  termsVersion: "event-test-v1", staffCount: "2", assessmentNotes: "Test staffing and travel assessment",
  "name-equipment": "Display stand", "quantity-equipment": "4",
};
function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}
const quoteInput = quotePayload(form(quoteFields), ["equipment"], now);
const { invoiceLines: _invoiceLines, ...quoteWithoutLines } = quoteInput;
const event: EventBooking = {
  id: eventId, number: "EVT-SYNTHETIC", version: 8, status: "QUOTED",
  request: requestPayload(form(requested), new Date(now)), allowedActions: ["ACCEPT_QUOTE", "CANCEL"],
  quote: {
    ...quoteWithoutLines, id: quoteId, version: 4, status: "OFFERED", issuedAt: "2026-12-01T02:00:00Z", depositMinor: 2, balanceMinor: 1,
    equipment: [{ ...quoteInput.equipment[0], id: equipmentId }], termsText: "Synthetic terms",
    balanceGraceEndsAt: "2026-12-18T02:00:00Z",
  },
  charges: [], actualSetupAt: null, actualEndAt: null, actualTeardownAt: null, extraInvoices: [],
  effectiveBalanceDueAt: null, effectiveBalanceGraceEndsAt: null, alternativeSchedule: null,
  effectiveSchedule: null, safeOutcome: null, balanceDeadlineRevision: 1,
};
const balance: EventCharge = {
  id: chargeId, category: "EVENT_BALANCE", expectedMinor: 1, paidMinor: 0, refundedMinor: 0, dueAt: quoteInput.balanceDueAt,
  state: "OPEN", qrUrl: null, version: 1, refundableMinor: 0, reviewStatus: null, allowedActions: [],
  outstandingMinor: 1, requiredRefundMinor: 0, topUp: null,
};
const merchantEvent: MerchantEvent = {
  ...event, status: "BOOKED", allowedActions: ["RESCHEDULE", "CANCEL"], merchantPlan: null, equipmentLedger: [], recentHistory: [],
  effectiveBalanceDueAt: balance.dueAt, effectiveBalanceGraceEndsAt: "2026-12-18T02:00:00Z",
  charges: [balance, { ...balance, id: depositId, category: "EVENT_DEPOSIT", state: "PAID", paidMinor: 2 }],
};
const notice: Notice = {
  noticeId, sourceType: "EVENT", sourceId: eventId, recipientRole: "CUSTOMER", milestone: "EVENT_QUOTED",
  status: "UNKNOWN", attempts: [], safeNextAction: "Verify the outcome.", resolvedAt: null,
};

test("intake converts one local date with ordered times and validates the exact MYT lead-time boundary", () => {
  const atCutoff = new Date("2026-12-01T14:00:00.000Z");
  const afterCutoff = new Date(atCutoff.getTime() + 1);
  assert.equal(earliestRequestDate(atCutoff), "2026-12-08");
  assert.equal(earliestRequestDate(afterCutoff), "2026-12-09");
  const input = requestPayload(form(requested), atCutoff);
  assert.equal(input.startAt, "2026-12-08T03:00:00.000Z");
  assert.equal(input.budgetMinor, 19905);
  assert.equal(input.specialRequirements, "None");
  assert.equal("notificationEmail" in input, false);
  assert.throws(() => requestPayload(form(requested), afterCutoff), /seven-day MYT lead time/);
  assert.throws(() => requestPayload(form({ ...requested, setupReadyAt: "14:00" }), atCutoff), /times in order/);
  assert.throws(() => requestPayload(form({ ...requested, eventDate: "2027-02-30" }), atCutoff), /lead time/);
});

test("event requests allow omitted preferences while preserving the API's None representation and length limits", () => {
  const input = requestPayload(form({ ...requested, theme: "  ", specialRequirements: "" }), new Date(now));
  assert.equal(input.theme, "None");
  assert.equal(input.specialRequirements, "None");
  const specified = requestPayload(form({ ...requested, theme: "Floral", specialRequirements: "Nut allergy" }), new Date(now));
  assert.equal(specified.theme, "Floral");
  assert.equal(specified.specialRequirements, "Nut allergy");
  assert.throws(() => requestPayload(form({ ...requested, theme: "x".repeat(121) }), new Date(now)));
  assert.throws(() => requestPayload(form({ ...requested, specialRequirements: "x".repeat(1001) }), new Date(now)));
});

test("quote payload checks offered schedule, coverage, positive split inputs and both deadline rules", () => {
  assert.equal(quoteInput.totalMinor, 3);
  assert.deepEqual(quoteInput.equipment, [{ name: "Display stand", quantity: 4 }]);
  assert.deepEqual(quoteInput.resourceAssessment, { staffCount: 2, notes: "Test staffing and travel assessment" });
  assert.equal(quoteInput.resourceWindow.startAt, "2026-12-20T01:00:00.000Z");
  assert.throws(() => quotePayload(form({ ...quoteFields, total: "0.01" }), [], now), /quote total/);
  assert.throws(() => quotePayload(form({ ...quoteFields, depositDueAt: "2026-12-16T11:01" }), [], now), /four days/);
  assert.throws(() => quotePayload(form({ ...quoteFields, balanceDueAt: "2026-12-18T10:00" }), [], now), /three days/);
  assert.throws(() => quotePayload(form({ ...quoteFields, windowEndAt: "2026-12-20T13:00" }), [], now), /covers setup through teardown/);
  assert.throws(() => schedulePayload(form({ ...scheduleFields, teardownAt: "2026-12-21T00:00" })), /same MYT date/);
});

test("consent binds the current quote and pre-transfer cancellation is explicit", () => {
  const cutoff = Date.parse(event.quote!.depositDueAt);
  assert.deepEqual(acceptancePayload(event, cutoff - 1), { quoteId, quoteVersion: 4, termsVersion: "event-test-v1" });
  assert.equal(acceptancePayload(event, cutoff), null);
  assert.equal(acceptancePayload({ ...event, allowedActions: ["CANCEL"] }, cutoff - 1), null);
  assert.equal(acceptancePayload({ ...event, quote: { ...event.quote!, status: "SUPERSEDED" } }, cutoff - 1), null);
  assert.deepEqual(eventCancellation("none"), { noTransferSent: true });
  for (const answer of [null, "sent", "unsure"] as const) assert.equal(eventCancellation(answer), null);
});

test("rendered event schedules and immutable quote terms keep request, proposal, offer and booking distinct", () => {
  const schedule = quoteInput.schedule;
  const rendered = renderToStaticMarkup(createElement(EventDetails, {
    event: { ...event, alternativeSchedule: schedule, effectiveSchedule: schedule },
  }));
  assert.match(rendered, /Original request/);
  assert.match(rendered, /Suggested alternate schedule/);
  assert.match(rendered, /Confirmed schedule/);
  assert.match(rendered, /MYT/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(EventDetails, { event })), /Confirmed schedule/);
  const offered = renderToStaticMarkup(createElement(QuoteDetails, { quote: event.quote! }));
  assert.match(offered, /Offered schedule/);
  assert.match(offered, /Display stand/);
  assert.match(offered, /Synthetic terms/);
  assert.match(offered, /Quoted balance grace ends/);
});

test("consented reschedule keeps paid balance settled and derives 24 hours of grace for outstanding balance", () => {
  const fields = { ...scheduleFields, agreedAt: "2026-11-30T20:00", channel: "PHONE", reference: "Synthetic consent",
    reason: "Customer agreed to change", replacementDueAt: "2026-12-17T10:00" };
  const result = reschedulePayload(form(fields), merchantEvent, now);
  assert.deepEqual(result.balancePlan, {
    state: "AGREED_OUTSTANDING", chargeId, dueAt: "2026-12-17T02:00:00.000Z", graceEndsAt: "2026-12-18T02:00:00.000Z",
  });
  assert.equal(result.obligationDisposition, "KEEP_APPROVED_TERMS");
  const paid = { ...merchantEvent, charges: [{ ...balance, state: "PAID" as const }, merchantEvent.charges[1]] };
  assert.deepEqual(reschedulePayload(form({ ...fields, replacementDueAt: "" }), paid, now).balancePlan, { state: "SETTLED", chargeId });
  assert.throws(() => reschedulePayload(form({ ...fields, replacementDueAt: "2026-12-18T10:00" }), merchantEvent, now), /minus three days/);
  assert.throws(() => reschedulePayload(form(fields), merchantEvent, Date.parse("2026-12-17T02:00:00Z")), /future balance deadline/);
  assert.equal(canReschedule({ ...merchantEvent, charges: [{ ...balance, reviewStatus: "UNDER_REVIEW" }, merchantEvent.charges[1]] }), false);
});

test("overdue cancellation needs the current cutoff, no recorded payment and a separate bank attestation", () => {
  assert.equal(balanceCutoff(merchantEvent), merchantEvent.effectiveBalanceGraceEndsAt);
  const offered = (value: MerchantEvent, elapsed: boolean) => merchantCancellationOptions(value, elapsed).map(([basis]) => basis);
  assert.ok(!offered(merchantEvent, false).includes("BALANCE_OVERDUE"));
  assert.ok(offered(merchantEvent, true).includes("BALANCE_OVERDUE"));
  assert.ok(offered({ ...merchantEvent, charges: [{ ...balance, state: "PROOF_REVIEW" }] }, true).includes("BALANCE_OVERDUE"));
  assert.ok(!offered({ ...merchantEvent, charges: [{ ...balance, paidMinor: 1 }] }, true).includes("BALANCE_OVERDUE"));
  assert.ok(!offered({ ...merchantEvent, charges: [{ ...balance, reviewStatus: "UNDER_REVIEW" }] }, true).includes("BALANCE_OVERDUE"));
  assert.ok(!offered(merchantEvent, true).includes("CUSTOMER_REQUEST"));
  const data = form({ reason: "Synthetic bank check", noBalanceFundsReceived: "on" });
  assert.deepEqual(merchantCancellationPayload(data, "BALANCE_OVERDUE"), {
    action: "CANCEL", cancellationBasis: "BALANCE_OVERDUE", reason: "Synthetic bank check", noBalanceFundsReceived: true,
  });
  assert.throws(() => merchantCancellationPayload(data, "CUSTOMER_REQUEST"), /sent no transfer/);
});

test("equipment retains quote identity and inspection requires exact counts, with itemized extras in integer sen", () => {
  assert.deepEqual(equipmentOutPayload(form({ ["taken-" + equipmentId]: "3" }), event.quote!.equipment), [{ equipmentId, taken: 3 }]);
  assert.throws(() => equipmentOutPayload(form({ ["taken-" + equipmentId]: "5" }), event.quote!.equipment), /between 0 and 4/);
  const withEquipment: MerchantEvent = {
    ...merchantEvent, equipmentLedger: [{ equipmentId, taken: 3, takenAt: "2026-12-20T02:00:00Z", returned: null, damaged: null, lost: null, checkedAt: null }],
  };
  const data = form({ ["returned-" + equipmentId]: "2", ["damaged-" + equipmentId]: "1", ["lost-" + equipmentId]: "1" });
  assert.deepEqual(equipmentCheckPayload(data, withEquipment), [{ equipmentId, name: "Display stand", returned: 2, damaged: 1, lost: 1 }]);
  data.set("lost-" + equipmentId, "0");
  assert.throws(() => equipmentCheckPayload(data, withEquipment), /returned plus lost/);
  assert.deepEqual(extrasPayload(form({ "item-a": "Display stand", "reason-a": "Agreed damage charge", "amount-a": "1.05" }), ["a"]),
    [{ item: "Display stand", reason: "Agreed damage charge", amountMinor: 105 }]);
  assert.throws(() => extrasPayload(form({ "item-a": "Display stand", "reason-a": "Synthetic", "amount-a": "1.005" }), ["a"]), /two decimal places/);
});

test("merchant work gives event, exact charge and notice targets and notice resolution only uses supported dispositions", () => {
  const work: WorkItem = {
    id: eventId, kind: "EVENT", status: "APPLIED", number: event.number, updatedAt: "2026-12-01T02:00:00Z",
    target: { resourceType: "EVENT", resourceId: eventId, eventId, orderId: null, chargeId: null },
    safeNextAction: "Review event.", noticeOutcome: null,
  };
  assert.equal(eventWorkTarget(work), "/merchant/events/" + eventId);
  assert.equal(eventWorkTarget({ ...work, target: { ...work.target, resourceType: "PROOF", chargeId } }),
    eventChargePath(chargeId, eventId));
  assert.equal(eventWorkTarget({ ...work, target: { ...work.target, resourceType: "NOTICE", resourceId: noticeId, chargeId } }),
    "/merchant/notices/" + noticeId);
  const payload = form({ disposition: "PROVIDER_RECONCILED", reason: "Verified synthetic provider outcome" });
  assert.deepEqual(noticeResolution(payload, notice), { disposition: "PROVIDER_RECONCILED", reason: "Verified synthetic provider outcome" });
  assert.throws(() => noticeResolution(payload, { ...notice, status: "SENDING" }), /failed or unknown/);
  assert.throws(() => noticeResolution(form({ disposition: "RESEND", reason: "Synthetic" }), notice), /Choose how/);
});

test("event quote replay keeps the exact consent, version and key and private proof targets its own charge", async t => {
  const requests: { url: string; headers: Headers; body: BodyInit | null | undefined }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    requests.push({ url, headers: new Headers(options.headers), body: options.body });
    if (requests.length === 1) throw new Error("synthetic lost response");
    if (requests.length === 2) return Response.json({ ...event, status: "AWAITING_DEPOSIT" });
    return Response.json({ reviewDisposition: "RECONCILIATION_ONLY" }, { status: 201 });
  });
  const consent = acceptancePayload(event, now)!;
  const mutation = prepareMutation({ path: "events/" + eventId + "/accept-quote", version: event.version, json: consent }, commandId);
  await assert.rejects(sendStandard(mutation, "synthetic-csrf"), (err: unknown) => err instanceof StandardProblem && err.uncertain);
  assert.equal((await sendStandard<EventBooking>(mutation, "synthetic-csrf")).status, "AWAITING_DEPOSIT");
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[1].url, "/api/v1/events/" + eventId + "/accept-quote");
  assert.equal(requests[1].headers.get("if-match"), '"8"');
  assert.equal(requests[1].headers.get("idempotency-key"), commandId);
  assert.equal(requests[1].body, JSON.stringify({ quoteId, quoteVersion: 4, termsVersion: "event-test-v1" }));

  const file = new File(["%PDF-1.4\nsynthetic"], "evidence.pdf", { type: "application/pdf" });
  const proof = await sendStandard<{ reviewDisposition: string }>(prepareMutation({ path: "charges/" + chargeId + "/proof", file }, id(8)), "synthetic-csrf");
  assert.equal(proof.reviewDisposition, "RECONCILIATION_ONLY");
  assert.equal(requests[2].url, "/api/v1/charges/" + chargeId + "/proof");
  assert.equal(requests[2].headers.get("x-file-media-type"), "application/pdf");
  assert.equal(requests[2].headers.get("content-type"), "application/octet-stream");
  assert.equal(requests[2].headers.get("x-csrf-token"), "synthetic-csrf");
  assert.equal(requests[2].body, file);
});
