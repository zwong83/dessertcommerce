import type { components } from "../../contracts/standard-v1";
import { addDays, canFitCapacity, earliestHandoff, isHandoffEligible, mytDate } from "../capacity/domain";
import { productDemand, readDays, readLimits, readPolicy, type ItemRow } from "../capacity/store";
import type { Queryable } from "../db";
import { ApiProblem } from "../http/problem";
import type { parseCheckoutReview } from "./input";

type Schemas = components["schemas"];
type Order = Schemas["Order"];
type Review = Schemas["CheckoutReview"];
export type CheckoutInput = ReturnType<typeof parseCheckoutReview>;
export type CheckoutTerms = { version: string; text: string };
type DisplayItem = Order["items"][number];
type Line = { display: DisplayItem; productId: string; generation: string };
type FulfilmentSnapshot = Pick<Order, "address" | "pickupDisplay" | "contactName" | "phone" | "notificationEmail" | "termsText" | "requestedHandoffAt">;

export type ReviewSnapshot = {
  fulfilment: FulfilmentSnapshot;
  lines: Line[];
  subtotalMinor: number;
  feeMinor: number | null;
  eligible: boolean;
};

type CartSelection = ItemRow & {
  generation: string;
  cart_quantity: number;
  product: string;
  variant: string;
  flavour: string;
  unit_minor: string;
};

export function staleReview() {
  return new ApiProblem("REVIEW_STALE", 409, "Review the current checkout before submitting.");
}

export function missing() {
  return new ApiProblem("NOT_FOUND", 404, "This resource was not found.");
}

export async function cartSelections(tx: Queryable, actorId: string, input: CheckoutInput) {
  const { rows: [cart] } = await tx.query<{ version: string }>(
    "SELECT version FROM cart WHERE account_id = $1", [actorId],
  );
  if (cart?.version !== String(input.cartVersion)) throw staleReview();

  const { rows } = await tx.query<CartSelection>(
    `SELECT l.id AS generation, l.quantity AS cart_quantity, v.id AS variant_id, p.id AS product_id,
            p.status, v.available, v.prep_minutes, p.name AS product, v.name AS variant, v.flavour, v.unit_minor
       FROM cart_line l JOIN variant v ON v.id = l.variant_id JOIN product p ON p.id = v.product_id
      WHERE l.account_id = $1 AND l.variant_id = ANY($2::uuid[])`,
    [actorId, input.items.map(({ variantId }) => variantId)],
  );
  const byVariant = new Map(rows.map((row) => [row.variant_id, row]));
  const lines = input.items.map(({ variantId, quantity }): Line => {
    const row = byVariant.get(variantId);
    if (!row || quantity > row.cart_quantity) throw staleReview();
    return {
      productId: row.product_id,
      generation: row.generation,
      display: { variantId, quantity, product: row.product, variant: row.variant, flavour: row.flavour, unitMinor: Number(row.unit_minor) },
    };
  });
  const subtotalMinor = lines.reduce((total, { display }) => total + display.quantity * display.unitMinor, 0);
  return { rows, lines, subtotalMinor };
}

export async function availability(tx: Queryable, input: CheckoutInput, now: string, rows: CartSelection[], suggest: boolean) {
  const { units, prepMinutes, sellable } = productDemand(input.items, rows);
  const alternatives: string[] = [];
  const lineIssues = rows.filter((row) => row.status !== "LISTED" || !row.available)
    .map((row) => ({ variantId: row.variant_id, reason: "UNAVAILABLE" }));
  if (!sellable) return { eligible: false, alternatives, lineIssues };

  const policy = await readPolicy(tx);
  const date = mytDate(input.requestedHandoffAt);
  if (isHandoffEligible(policy, now, input.requestedHandoffAt, prepMinutes)) {
    const [day] = await readDays(tx, date, date);
    const limits = new Map((await readLimits(tx, date, date)).map((row) => [row.product_id, row]));
    if (canFitCapacity(day, limits, units)) return { eligible: true, alternatives, lineIssues };
  }
  if (suggest) {
    const today = mytDate(now);
    const end = addDays(today, 30);
    const limitsByDate = new Map<string, Map<string, { max: number; allocated: number }>>();
    for (const row of await readLimits(tx, today, end)) {
      const limits = limitsByDate.get(row.date) ?? new Map();
      limits.set(row.product_id, row);
      limitsByDate.set(row.date, limits);
    }
    for (const day of await readDays(tx, today, end)) {
      if (!canFitCapacity(day, limitsByDate.get(day.date) ?? new Map(), units)) continue;
      const alternative = earliestHandoff(policy, now, day.date, prepMinutes);
      if (alternative) alternatives.push(alternative);
      if (alternatives.length === 20) break;
    }
  }
  return { eligible: false, alternatives, lineIssues };
}

export function fulfilmentSnapshot(input: CheckoutInput, terms: CheckoutTerms, pickupDisplay: () => string): FulfilmentSnapshot {
  return {
    address: input.address ?? null,
    pickupDisplay: input.fulfilment === "PICKUP" ? pickupDisplay() : null,
    contactName: input.contactName,
    phone: input.phone,
    notificationEmail: input.notificationEmail ?? null,
    termsText: terms.text,
    requestedHandoffAt: input.requestedHandoffAt,
  };
}

type OrderRow = {
  id: string; order_number: string; version: string; status: Order["status"];
  fulfilment: Order["fulfilment"]; payment_method: Order["paymentMethod"]; checkout_review_id: string;
  promised_handoff_at: Date | null; ready_at: Date | null; driver_arrived_at: Date | null; handoff_at: Date | null;
  subtotal_minor: string; fee_minor: string | null; total_minor: string | null; terms_version: string;
  fee_version: string | null; proof_due_at: Date | null; fulfilment_snapshot: FulfilmentSnapshot; items: DisplayItem[];
  charge_id: string | null; charge_state: Schemas["Charge"]["state"]; expected_minor: string;
  charge_due_at: Date | null; charge_version: string; paid_minor: string; refunded_minor: string;
};

const iso = (value: Date | null) => value?.toISOString() ?? null;
const numberOrNull = (value: string | null) => value === null ? null : Number(value);

export async function ownOrder(tx: Queryable, actorId: string, orderId: string, now: string, qrUrl?: string): Promise<Order> {
  const { rows: [row] } = await tx.query<OrderRow>(
    `SELECT o.id, o.order_number, o.version, o.status, o.fulfilment, o.payment_method, o.checkout_review_id,
            o.promised_handoff_at, o.ready_at, o.driver_arrived_at, o.handoff_at, o.subtotal_minor, o.fee_minor,
            o.total_minor, o.terms_version, o.fee_version, o.proof_due_at, o.fulfilment_snapshot,
            lines.items, c.id AS charge_id, c.state AS charge_state, c.expected_minor, c.due_at AS charge_due_at,
            c.version AS charge_version, money.paid_minor, money.refunded_minor
       FROM standard_order o
       CROSS JOIN LATERAL (
         SELECT jsonb_agg(l.display_snapshot ORDER BY l.variant_id) AS items
           FROM standard_order_line l WHERE l.order_id = o.id
       ) lines
       LEFT JOIN charge c ON c.order_id = o.id AND c.category = 'STANDARD'
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(amount_minor) FILTER (WHERE kind = 'RECEIPT'), 0) AS paid_minor,
                COALESCE(sum(amount_minor) FILTER (WHERE kind = 'REFUND'), 0) AS refunded_minor
           FROM money_entry WHERE charge_id = c.id
       ) money ON true
      WHERE o.account_id = $1 AND o.id = $2`,
    [actorId, orderId],
  );
  if (!row) throw missing();
  const showTransfer = row.status === "PENDING_PROOF" && row.charge_state === "OPEN" &&
    row.proof_due_at !== null && Date.parse(now) < row.proof_due_at.getTime();
  const paidMinor = Number(row.paid_minor);
  const refundedMinor = Number(row.refunded_minor);
  const expectedMinor = Number(row.expected_minor);
  const saved = row.fulfilment_snapshot;
  return {
    id: row.id, number: row.order_number, version: Number(row.version), status: row.status,
    fulfilment: row.fulfilment, paymentMethod: row.payment_method, checkoutReviewId: row.checkout_review_id,
    requestedHandoffAt: saved.requestedHandoffAt, address: saved.address, pickupDisplay: saved.pickupDisplay,
    contactName: saved.contactName, phone: saved.phone, notificationEmail: saved.notificationEmail, termsText: saved.termsText,
    promisedHandoffAt: iso(row.promised_handoff_at), readyAt: iso(row.ready_at),
    driverArrivedAt: iso(row.driver_arrived_at), handoffAt: iso(row.handoff_at),
    items: row.items, subtotalMinor: Number(row.subtotal_minor), feeMinor: numberOrNull(row.fee_minor),
    totalMinor: numberOrNull(row.total_minor), termsVersion: row.terms_version, feeVersion: numberOrNull(row.fee_version),
    proofDueAt: iso(row.proof_due_at), feeOffer: null, adjustments: [],
    charge: row.charge_id === null ? null : {
      id: row.charge_id, category: "STANDARD", state: row.charge_state, expectedMinor, paidMinor, refundedMinor,
      dueAt: iso(row.charge_due_at), version: Number(row.charge_version), qrUrl: showTransfer ? qrUrl ?? null : null,
      outstandingMinor: Math.max(0, expectedMinor - paidMinor + refundedMinor),
      refundableMinor: Math.max(0, paidMinor - refundedMinor), requiredRefundMinor: 0,
      reviewStatus: null, topUp: null, allowedActions: [],
    },
    allowedActions: [], safeOutcome: null,
  };
}

export function reviewPaymentMethods(input: CheckoutInput): Review["paymentMethods"] {
  return input.fulfilment === "PICKUP" ? ["DUITNOW", "CASH"] : ["DUITNOW"];
}
