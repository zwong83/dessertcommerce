import type { components, operations } from "../../contracts/standard-v1";
import { dateMillis } from "../capacity/domain";
import { validation } from "../http/problem";
import { fieldString, fieldUuid } from "../http/request";

type ReviewBody = operations["reviewCheckout"]["requestBody"]["content"]["application/json"];
type SubmitBody = components["schemas"]["SubmitOrder"];
type Address = components["schemas"]["Address"];

export const checkoutFields = [
  "items", "requestedHandoffAt", "fulfilment", "cartVersion", "contactName", "phone", "address", "notificationEmail",
] as const;
export const submitFields = [...checkoutFields, "paymentMethod", "termsVersion", "reviewId"];

function fields(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.includes(key))) throw validation();
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number, pattern = /^[^\u0000]+$/u) {
  return fieldString(value, label, pattern, max);
}

function handoffInstant(value: unknown) {
  const input = text(value, "the handoff time", 80);
  const match = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d+))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.exec(input);
  if (!match) throw validation("Use a handoff time with an explicit timezone.");
  const [, date, time, fraction = "", offset] = match;
  dateMillis(date);
  if (/[1-9]/.test(fraction.slice(6))) throw validation("Use at most six decimal places for the handoff time.");
  const utc = new Date(`${date}T${time}${offset.toUpperCase()}`).toISOString();
  dateMillis(utc.slice(0, 10));
  const seconds = fraction.slice(0, 6).replace(/0+$/, "").padEnd(3, "0");
  return `${utc.slice(0, 19)}.${seconds}Z`;
}

function deliveryAddress(value: unknown): Address {
  const address = fields(value, ["line1", "line2", "city", "postcode", "region", "note"]);
  return {
    line1: text(address.line1, "the address", 200),
    city: text(address.city, "the city", 100),
    postcode: text(address.postcode, "the postcode", 20),
    region: text(address.region, "the region", 100),
    ...(address.line2 === undefined ? {} : { line2: text(address.line2, "the second address line", 200) }),
    ...(address.note === undefined ? {} : { note: text(address.note, "the delivery note", 300) }),
  };
}

function checkout(body: Record<string, unknown>): ReviewBody {
  const { fulfilment, cartVersion } = body;
  if (fulfilment !== "PICKUP" && fulfilment !== "MERCHANT_LALAMOVE" && fulfilment !== "CUSTOMER_LALAMOVE") {
    throw validation("Choose a handoff method.");
  }
  if (typeof cartVersion !== "number" || !Number.isSafeInteger(cartVersion) || cartVersion < 1) {
    throw validation("Refresh the cart version.");
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
    throw validation("Choose between 1 and 100 cart selections.");
  }
  const items = body.items.map((input: unknown) => {
    const { variantId, quantity } = fields(input, ["variantId", "quantity"]);
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      throw validation("Check the item quantities.");
    }
    return { variantId: fieldUuid(variantId, "the selected variant").toLowerCase(), quantity };
  }).sort((a, b) => a.variantId.localeCompare(b.variantId));
  if (new Set(items.map(({ variantId }) => variantId)).size !== items.length) {
    throw validation("Enter each selection once.");
  }
  if (fulfilment === "PICKUP" && body.address !== undefined) throw validation("Pickup uses the merchant pickup point.");
  return {
    fulfilment, cartVersion, items,
    requestedHandoffAt: handoffInstant(body.requestedHandoffAt),
    contactName: text(body.contactName, "the contact name", 120),
    phone: text(body.phone, "the contact phone", 24),
    ...(fulfilment === "PICKUP" ? {} : { address: deliveryAddress(body.address) }),
    ...(body.notificationEmail === undefined ? {} : {
      notificationEmail: text(body.notificationEmail, "the notification email", 254, /^[^\s@\u0000]+@[^\s@\u0000]+$/u),
    }),
  };
}

export function parseCheckoutReview(input: unknown) {
  return checkout(fields(input, checkoutFields));
}

export function parseSubmitOrder(input: unknown): { checkout: ReviewBody; submission: Pick<SubmitBody, "reviewId" | "paymentMethod" | "termsVersion"> } {
  const body = fields(input, submitFields);
  const { paymentMethod } = body;
  if (paymentMethod !== "DUITNOW" && paymentMethod !== "CASH") throw validation("Choose a payment method.");
  return {
    checkout: checkout(body),
    submission: {
      paymentMethod,
      reviewId: fieldUuid(body.reviewId, "the checkout review").toLowerCase(),
      termsVersion: text(body.termsVersion, "the terms version", 40),
    },
  };
}
