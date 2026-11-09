import type { components, operations } from "../contracts/standard-v1";

export type Order = components["schemas"]["Order"];
export type AdminOrder = components["schemas"]["AdminOrder"];
export type Charge = components["schemas"]["Charge"];
export type Proof = components["schemas"]["Proof"];
export type WorkItem = components["schemas"]["WorkItem"];
export type Problem = components["schemas"]["Problem"];
export type Session = Pick<components["schemas"]["Session"], "accountId" | "role" | "csrfToken">;
export type JsonInput<K extends keyof operations> = operations[K] extends {
  requestBody: { content: { "application/json": infer Body } };
} ? Body : never;
type JsonResult<T> = T extends { content: { "application/json": infer Body } } ? Body : never;
export type ReadResult<K extends keyof operations> = operations[K]["responses"] extends { 200: infer Response }
  ? JsonResult<Response> : never;
export type MutationResult<K extends keyof operations> = operations[K]["responses"] extends { 200: infer Response }
  ? JsonResult<Response> : operations[K]["responses"] extends { 201: infer Response } ? JsonResult<Response> : never;

export const orderStatuses: Record<Order["status"], string> = {
  AWAITING_FEE: "Awaiting delivery fee agreement",
  AWAITING_CASH: "Awaiting merchant confirmation",
  PENDING_PROOF: "Awaiting payment proof",
  PAYMENT_REVIEW: "Payment proof under review",
  EXCEPTION: "Needs merchant review",
  ACCEPTED: "Accepted",
  PREPARING: "In preparation",
  READY: "Ready for handoff",
  HANDED_OFF: "Handed off",
  COMPLETED: "Completed",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
  REJECTED: "Declined",
  NO_SHOW: "Missed pickup",
};

export const fulfilmentNames: Record<Order["fulfilment"], string> = {
  PICKUP: "Self pickup",
  MERCHANT_LALAMOVE: "Merchant-arranged Lalamove",
  CUSTOMER_LALAMOVE: "Customer-arranged Lalamove",
};

const nextSteps: Record<Order["status"], string> = {
  AWAITING_FEE: "Wait for the merchant to review delivery for this order.",
  AWAITING_CASH: "Wait for the merchant to confirm your pickup before coming to collect.",
  PENDING_PROOF: "Open the order to see your payment instructions and proof deadline.",
  PAYMENT_REVIEW: "The merchant will check your proof and verify the transfer.",
  EXCEPTION: "Open the order for the latest payment or delivery update.",
  ACCEPTED: "Check your promised handoff time.",
  PREPARING: "Your desserts are being prepared.",
  READY: "Follow the pickup or delivery instructions for your order.",
  HANDED_OFF: "Check the actual handoff time in your order.",
  COMPLETED: "Your order is complete.",
  EXPIRED: "If you already sent a transfer, open the order for payment follow-up.",
  CANCELLED: "If you already sent a transfer, open the order for payment follow-up.",
  REJECTED: "Open the order to see the outcome and any payment follow-up.",
  NO_SHOW: "Open the order to see the pickup outcome.",
};

export function customerNextStep(order: Order): string {
  if (order.charge?.topUp?.status === "AWAITING_PROOF") return "A top-up is due. Open the order to review the amount and deadline.";
  if (order.charge?.topUp?.status === "UNDER_REVIEW") return "Your top-up proof is under review.";
  if (canAcceptFee(order)) return "Review the offered delivery time, fee, total and terms.";
  return order.safeOutcome ?? nextSteps[order.status];
}

export function canAcceptFee(order: Order) {
  return order.allowedActions.includes("CONFIRM_DELIVERY_FEE") &&
    order.status === "AWAITING_FEE" && order.feeOffer?.serviceable === true &&
    order.feeOffer.feeMinor !== null && order.feeOffer.totalMinor !== null && order.feeOffer.offeredHandoffAt !== null;
}

export type TransferAnswer = "none" | "sent" | "unsure";
export function cancellationInput(answer: TransferAnswer | null): JsonInput<"cancelOwnOrder"> | null {
  return answer === "none" ? { noTransferSent: true } : null;
}

export function workTarget(item: WorkItem) {
  const { resourceType, resourceId, orderId, eventId, chargeId } = item.target;
  if (eventId || resourceType === "EVENT") return null;
  if (resourceType === "ORDER") return "/merchant/orders/" + encodeURIComponent(resourceId);
  if (resourceType === "PROOF" || resourceType === "PAYMENT_EXCEPTION") {
    if (chargeId) return merchantChargePath(chargeId, orderId);
  }
  return orderId ? "/merchant/orders/" + encodeURIComponent(orderId) : null;
}

export function merchantChargePath(chargeId: string, orderId: string | null) {
  const path = "/merchant/charges/" + encodeURIComponent(chargeId);
  return orderId ? path + "?" + new URLSearchParams({ order: orderId }) : path;
}

export function whatsAppLink(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const phone = url.hostname === "wa.me" ? url.pathname.slice(1)
      : url.hostname === "api.whatsapp.com" && url.pathname === "/send" ? url.searchParams.get("phone") : null;
    if (phone && /^[1-9]\d{6,14}$/.test(phone)) return "https://wa.me/" + phone;
  } catch {
    return null;
  }
  return null;
}

export const proofTypes = ["image/jpeg", "image/png", "application/pdf"] as const;
export function proofIssue(file: Pick<File, "type" | "size">) {
  if (file.size > 5 * 1024 * 1024) return "Choose a file no larger than 5 MiB.";
  if (!file.size || !proofTypes.some(type => type === file.type)) return "Choose a JPEG, PNG or PDF proof file.";
  return null;
}

const currency = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" });
const myt = new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" });
const businessDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" });
export const money = (minor: number) => currency.format(minor / 100);
export const localTime = (instant: string) => myt.format(new Date(instant)) + " MYT";
export const mytDate = (instant: Date) => businessDate.format(instant);
export const label = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, first => first.toUpperCase());
export const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function mytInput(value: string) {
  const date = new Date(value + "+08:00");
  if (!value || !Number.isFinite(date.getTime())) throw new Error("Enter a valid date and time in MYT.");
  return date.toISOString();
}

export function formText(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

export function requiredText(form: FormData, name: string, title: string) {
  const value = formText(form, name);
  if (!value) throw new Error("Enter " + title + ".");
  return value;
}

export function boundedQuery(query: Record<string, string | string[] | undefined>) {
  const result = new URLSearchParams({ limit: "25" });
  if (typeof query.cursor === "string" && query.cursor.length > 0 && query.cursor.length <= 500) result.set("cursor", query.cursor);
  return result;
}
