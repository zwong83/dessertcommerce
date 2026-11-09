import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChargeDetails, OrderDetails } from "../src/ui/order-details";
import { prepareMutation, proofExtension, sendStandard, StandardProblem } from "../src/ui/standard-api";
import {
  boundedQuery, canAcceptFee, cancellationInput, customerNextStep, isCalendarDate, merchantChargePath, mytInput, proofIssue, whatsAppLink, workTarget,
  type Charge, type JsonInput, type Order, type WorkItem,
} from "../src/ui/standard-model";

const orderId = "10000000-0000-4000-8000-000000000001";
const chargeId = "20000000-0000-4000-8000-000000000001";
const reviewId = "30000000-0000-4000-8000-000000000001";
const key = "40000000-0000-4000-8000-000000000001";
const requested = "2026-11-10T02:00:00.000Z";
const promised = "2026-11-10T03:00:00.000Z";
const dueAt = "2026-11-10T02:30:00.000Z";
const order: Order = {
  id: orderId, number: "SD-TEST-001", version: 4, status: "AWAITING_FEE", fulfilment: "MERCHANT_LALAMOVE",
  paymentMethod: "DUITNOW", requestedHandoffAt: requested, promisedHandoffAt: null, driverArrivedAt: null,
  readyAt: null, handoffAt: null, pickupDisplay: null, address: null, items: [], subtotalMinor: 1800,
  feeMinor: null, totalMinor: null, feeVersion: 2, termsVersion: "checkout-test", termsText: "Captured test terms",
  proofDueAt: null, charge: null, adjustments: [], checkoutReviewId: reviewId, contactName: "Test Customer",
  phone: "+60000000001", notificationEmail: null, safeOutcome: null, allowedActions: ["CONFIRM_DELIVERY_FEE", "CANCEL"],
  feeOffer: { revision: 2, serviceable: true, offeredHandoffAt: promised, feeMinor: 700, totalMinor: 2500,
    termsVersion: "offer-test", termsText: "Updated test terms", safeReason: null },
};
const charge: Charge = {
  id: chargeId, category: "STANDARD", state: "DISPUTED", expectedMinor: 2500, paidMinor: 2000,
  refundedMinor: 0, version: 3, refundableMinor: 2000, outstandingMinor: 500, requiredRefundMinor: 0,
  dueAt: requested, qrUrl: null, reviewStatus: "UNDER_REVIEW", allowedActions: ["UPLOAD_PROOF"],
  topUp: { outstandingMinor: 500, requestedAt: requested, dueAt, status: "UNDER_REVIEW" },
};

test("customer fee consent requires a complete current serviceable offer", () => {
  assert.equal(canAcceptFee(order), true);
  assert.match(customerNextStep(order), /offered delivery time, fee, total and terms/);
  assert.equal(canAcceptFee({ ...order, allowedActions: [] }), false);
  assert.equal(canAcceptFee({ ...order, status: "PENDING_PROOF" }), false);
  assert.equal(canAcceptFee({ ...order, feeOffer: { ...order.feeOffer!, totalMinor: null } }), false);
  assert.equal(canAcceptFee({ ...order, feeOffer: { ...order.feeOffer!, serviceable: false } }), false);
});

test("only an explicit no-transfer answer can create a cancellation request", () => {
  assert.deepEqual(cancellationInput("none"), { noTransferSent: true });
  for (const answer of [null, "sent", "unsure"] as const) assert.equal(cancellationInput(answer), null);
  assert.equal(whatsAppLink("https://api.whatsapp.com/send?phone=60123456789&text=private"), "https://wa.me/60123456789");
  assert.equal(whatsAppLink("https://wa.me/60123456789"), "https://wa.me/60123456789");
  assert.equal(whatsAppLink("https://wa.me.example.com/60123456789"), null);
  assert.equal(whatsAppLink("https://alice:secret@wa.me/60123456789"), null);
});

test("tracking distinguishes requested and promised time, readiness, arrival and actual handoff", () => {
  const html = renderToStaticMarkup(createElement(OrderDetails, {
    order: { ...order, promisedHandoffAt: promised, readyAt: "2026-11-10T02:45:00.000Z", driverArrivedAt: "2026-11-10T02:55:00.000Z" },
    contactPhone: order.phone,
  }));
  assert.match(html, /Requested handoff <time/);
  assert.match(html, /Promised handoff <time/);
  assert.match(html, /Ready at <time/);
  assert.match(html, /Driver arrived at <time/);
  assert.doesNotMatch(html, /Handed off at/);
  assert.match(html, /Captured test terms/);
  assert.match(html, /MYT/);
});

test("top-up shows the server amount and current deadline even while proof is under review", () => {
  const html = renderToStaticMarkup(createElement(ChargeDetails, { charge }));
  assert.match(html, /Top-up RM\s?5\.00/);
  assert.match(html, new RegExp(dueAt.replace(".", "\\.")));
  assert.doesNotMatch(html, /Original proof deadline/);
  assert.match(html, /production hold during review/);
  assert.match(customerNextStep({ ...order, charge }), /top-up proof is under review/);
});

test("standard work drill-down is typed, keeps related order context and excludes event targets", () => {
  const work: WorkItem = {
    id: reviewId, kind: "PAYMENT_EXCEPTION", status: "OPEN", number: order.number, updatedAt: requested,
    target: { resourceType: "PAYMENT_EXCEPTION", resourceId: reviewId, orderId, eventId: null, chargeId },
    safeNextAction: "Verify the bank movement.", noticeOutcome: null,
  };
  assert.equal(workTarget(work), merchantChargePath(chargeId, orderId));
  assert.equal(workTarget({ ...work, target: { ...work.target, eventId: reviewId } }), null);
  assert.equal(workTarget({ ...work, target: { ...work.target, resourceType: "ORDER", resourceId: orderId } }), "/merchant/orders/" + orderId);
  assert.equal(boundedQuery({ cursor: "cursor-value" }).toString(), "limit=25&cursor=cursor-value");
  assert.equal(boundedQuery({ cursor: "x".repeat(501) }).has("cursor"), false);
  assert.equal(isCalendarDate("2026-02-30"), false);
  assert.equal(mytInput("2026-11-10T10:30"), dueAt);
});

test("retry reuses the frozen intent and key, and a superseded fee is a typed stale result", async t => {
  const sent: { url: string; headers: Headers; body: BodyInit | null | undefined }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    sent.push({ url, headers: new Headers(options.headers), body: options.body });
    if (sent.length === 1) throw new Error("lost response");
    if (sent.length === 2) return Response.json(order);
    return Response.json({ code: "FEE_CHANGED", message: "Review the new offer.", requestId: "synthetic", retryable: false }, { status: 409 });
  });
  const input: JsonInput<"confirmDeliveryFee"> = { feeVersion: 2, termsVersion: "offer-test" };
  const intent = prepareMutation({ path: "orders/" + orderId + "/confirm-fee", version: order.version, json: input }, key);
  input.feeVersion = 3;
  await assert.rejects(sendStandard(intent, "test-csrf"), (issue: unknown) => issue instanceof StandardProblem && issue.uncertain);
  assert.deepEqual(await sendStandard(intent, "test-csrf"), order);
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(sent[1].url, "/api/v1/orders/" + orderId + "/confirm-fee");
  assert.equal(sent[1].headers.get("if-match"), '"4"');
  assert.equal(sent[1].headers.get("idempotency-key"), key);
  assert.equal(sent[1].body, JSON.stringify({ feeVersion: 2, termsVersion: "offer-test" }));
  await assert.rejects(sendStandard(intent, "test-csrf"),
    (issue: unknown) => issue instanceof StandardProblem && issue.stale && !issue.uncertain && issue.problem?.code === "FEE_CHANGED");
});

test("proof is bounded and sent as protected binary, with late disposition preserved", async t => {
  const file = new File(["synthetic proof"], "test.pdf", { type: "application/pdf" });
  assert.equal(proofIssue(file), null);
  assert.match(proofIssue({ type: "image/svg+xml", size: 10 }) ?? "", /JPEG, PNG or PDF/);
  assert.match(proofIssue({ type: "image/png", size: 5 * 1024 * 1024 + 1 }) ?? "", /5 MiB/);
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "/api/v1/charges/" + chargeId + "/proof");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.equal(options.body, file);
    const headers = new Headers(options.headers);
    assert.equal(headers.get("x-csrf-token"), "test-csrf");
    assert.equal(headers.get("x-file-media-type"), "application/pdf");
    assert.equal(headers.get("content-type"), "application/octet-stream");
    return Response.json({ reviewDisposition: "RECONCILIATION_ONLY" }, { status: 201 });
  });
  const result = await sendStandard<{ reviewDisposition: string }>(prepareMutation({ path: "charges/" + chargeId + "/proof", file }, key), "test-csrf");
  assert.equal(result.reviewDisposition, "RECONCILIATION_ONLY");
});

test("protected octet-stream evidence gets a usable filename without being rendered inline", () => {
  assert.equal(proofExtension(new TextEncoder().encode("%PDF-1.4\n")), "pdf");
  assert.equal(proofExtension(Uint8Array.from([0xff, 0xd8, 0xff, 0xdb])), "jpg");
  assert.equal(proofExtension(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "png");
  assert.equal(proofExtension(new TextEncoder().encode("<svg>")), "bin");
});
