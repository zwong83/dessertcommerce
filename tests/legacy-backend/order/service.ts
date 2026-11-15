import { createHash, randomInt, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import type { Pool } from "pg";
import type { components, operations } from "../../../frontend/contracts/standard-v1";
import { command, requireRole } from "../capacity/commands";
import { mytDate } from "../capacity/domain";
import { allocateCapacity, bumpCapacityImpact, lockCapacityDates } from "../capacity/order";
import { databaseTime, lockPolicy, uuid, type CapacityClock } from "../capacity/store";
import { withTransaction, type Queryable } from "../db";
import { ApiProblem, validation } from "../http/problem";
import { parseCheckoutReview, parseSubmitOrder } from "./input";
import { availability, cartSelections, fulfilmentSnapshot, missing, ownOrder, reviewPaymentMethods, staleReview,
  type CheckoutTerms, type ReviewSnapshot } from "./snapshot";

type Schemas = components["schemas"];
type Actor = Pick<Schemas["Session"], "accountId" | "role">;
type Outcome = Schemas["CheckoutOutcome"];
type CommandOutcome = operations["getOwnCommandOutcome"]["responses"][200]["content"]["application/json"];
type OrderCommand = { idempotencyKey: string; requestId: string };
type ReviewRow = {
  status: Outcome["state"]; expires_at: Date; updated_at: Date; review_digest: Buffer;
  terms_version: string; review_snapshot: ReviewSnapshot;
};

export type OrderConfig = {
  pool: Pool;
  terms: () => CheckoutTerms;
  pickupDisplay: () => string;
  reviewTtlMs: number;
  clock?: CapacityClock;
  duitNowQrUrl?: string;
};

const proofWindowMs = 30 * 60_000;
const submitOperation = "submitOrder";
const abandonOperation = "abandonOrResolveCheckout";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest();
const termsChanged = () => new ApiProblem("TERMS_CHANGED", 409, "Review the current terms before submitting.");
const unavailable = () => new ApiProblem("CAPACITY_UNAVAILABLE", 409, "Choose an available handoff time.");

async function checkoutTransaction<T>(pool: Pool, run: (tx: Queryable) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTransaction(pool, run);
    } catch (error) {
      // PostgreSQL has aborted these transactions. A lost commit response must use receipt replay instead.
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (attempt === 2 || (code !== "40001" && code !== "40P01")) throw error;
      await delay(randomInt(10, 31));
    }
  }
}

async function lockedReview(tx: Queryable, actorId: string, reviewId: string) {
  const { rows: [review] } = await tx.query<ReviewRow>(
    `SELECT status, expires_at, updated_at, review_digest, terms_version, review_snapshot
       FROM checkout_review WHERE account_id = $1 AND id = $2 FOR UPDATE`,
    [actorId, reviewId],
  );
  if (!review) throw missing();
  return review;
}

async function submittedOrder(tx: Queryable, actorId: string, reviewId: string) {
  const { rows: [order] } = await tx.query<{ id: string; payment_method: Schemas["Order"]["paymentMethod"] }>(
    "SELECT id, payment_method FROM standard_order WHERE account_id = $1 AND checkout_review_id = $2",
    [actorId, reviewId],
  );
  if (!order) throw new Error("Submitted checkout review has no order");
  return order;
}

function outcome(review: Pick<ReviewRow, "status" | "expires_at" | "updated_at">, now: string, orderId: string | null): Outcome {
  if (review.status === "OPEN" && Date.parse(now) >= review.expires_at.getTime()) {
    return { state: "EXPIRED", orderId: null, updatedAt: review.expires_at.toISOString() };
  }
  return { state: review.status, orderId, updatedAt: review.updated_at.toISOString() };
}

function reviewInstructions(fulfilment: Schemas["Order"]["fulfilment"]) {
  switch (fulfilment) {
    case "PICKUP": return "Collect the order at the listed pickup point.";
    case "CUSTOMER_LALAMOVE": return "Book and pay Lalamove separately. The external delivery fee is excluded.";
    case "MERCHANT_LALAMOVE": return "The subtotal is provisional. Review and confirm the merchant’s delivery fee before paying.";
  }
}

export function createOrderService({ pool, terms, pickupDisplay, reviewTtlMs, clock, duitNowQrUrl }: OrderConfig) {
  if (!Number.isSafeInteger(reviewTtlMs) || reviewTtlMs < 1) throw new Error("Checkout needs a positive review lifetime");
  const nowAt = (tx: Queryable) => databaseTime(tx, clock);

  async function reviewCheckout(actor: Actor, input: unknown): Promise<Schemas["CheckoutReview"]> {
    const actorId = requireRole(actor, "CUSTOMER");
    const checkout = parseCheckoutReview(input);
    return checkoutTransaction(pool, async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const now = await nowAt(tx);
      const reviewId = randomUUID();
      const expiresAt = new Date(Date.parse(now) + reviewTtlMs).toISOString();
      const currentTerms = terms();
      const fulfilment = fulfilmentSnapshot(checkout, currentTerms, pickupDisplay);
      const { lines, rows, subtotalMinor } = await cartSelections(tx, actorId, checkout);
      if (subtotalMinor > 999_999_999) throw validation("The checkout total exceeds the supported amount.");
      const { eligible, alternatives, lineIssues } = await availability(tx, checkout, now, rows, true);
      const feeMinor = checkout.fulfilment === "MERCHANT_LALAMOVE" ? null : 0;
      const saved: ReviewSnapshot = { fulfilment, lines, subtotalMinor, feeMinor, eligible };
      await tx.query(
        `INSERT INTO checkout_review (id, account_id, cart_version, review_digest, terms_version, review_snapshot, expires_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [reviewId, actorId, checkout.cartVersion, digest(checkout), currentTerms.version, JSON.stringify(saved), expiresAt, now],
      );
      return {
        ...fulfilment, reviewId, expiresAt, cartVersion: checkout.cartVersion, fulfilment: checkout.fulfilment,
        items: lines.map(({ display }) => display), subtotalMinor, feeMinor, totalMinor: feeMinor === null ? null : subtotalMinor,
        termsVersion: currentTerms.version, eligible, alternatives, lineIssues,
        paymentMethods: eligible ? reviewPaymentMethods(checkout) : [], instructions: reviewInstructions(checkout.fulfilment),
      };
    });
  }

  async function submitOrder(actor: Actor, input: unknown, context: OrderCommand) {
    const actorId = requireRole(actor, "CUSTOMER");
    const { checkout, submission } = parseSubmitOrder(input);
    const { reviewId, paymentMethod, termsVersion } = submission;
    return checkoutTransaction(pool, async (tx) => {
      const { orderId } = await command(tx, actorId, submitOperation, context, [checkout, submission], async () => {
        const review = await lockedReview(tx, actorId, reviewId);
        if (!review.review_digest.equals(digest(checkout))) throw staleReview();
        if (review.terms_version !== termsVersion) throw termsChanged();
        if (review.status === "SUBMITTED") {
          const order = await submittedOrder(tx, actorId, reviewId);
          if (order.payment_method !== paymentMethod) throw staleReview();
          return { orderId: order.id };
        }
        if (review.status !== "OPEN") throw staleReview();
        if (!reviewPaymentMethods(checkout).includes(paymentMethod)) {
          throw new ApiProblem("VALIDATION", 422, "Cash is available for pickup only.");
        }

        // Match the capacity and catalogue writers, then lock the owner cart before re-reading its lines.
        const date = mytDate(checkout.requestedHandoffAt);
        await lockPolicy(tx, "share");
        await tx.query(
          `SELECT p.id FROM product p WHERE p.id IN (SELECT product_id FROM variant WHERE id = ANY($1::uuid[]))
            ORDER BY p.id FOR SHARE`,
          [checkout.items.map(({ variantId }) => variantId)],
        );
        await lockCapacityDates(tx, [date]);
        await tx.query("SELECT account_id FROM cart WHERE account_id = $1 FOR SHARE", [actorId]);

        const now = await nowAt(tx);
        if (Date.parse(now) >= review.expires_at.getTime()) throw staleReview();
        const currentTerms = terms();
        const current = fulfilmentSnapshot(checkout, currentTerms, pickupDisplay);
        const saved = review.review_snapshot;
        if (currentTerms.version !== termsVersion || current.termsText !== saved.fulfilment.termsText) throw termsChanged();
        if (!isDeepStrictEqual(current, saved.fulfilment)) throw staleReview();
        const { lines, rows, subtotalMinor } = await cartSelections(tx, actorId, checkout);
        if (subtotalMinor !== saved.subtotalMinor || !isDeepStrictEqual(lines, saved.lines)) throw staleReview();
        if (!saved.eligible) throw staleReview();

        const orderId = randomUUID();
        const status = checkout.fulfilment === "MERCHANT_LALAMOVE" ? "AWAITING_FEE"
          : paymentMethod === "CASH" ? "AWAITING_CASH" : "PENDING_PROOF";
        if (status !== "PENDING_PROOF" && !(await availability(tx, checkout, now, rows, false)).eligible) {
          throw unavailable();
        }
        const createdAt = new Date(now).toISOString();
        const deadline = status === "PENDING_PROOF" ? new Date(Date.parse(now) + proofWindowMs).toISOString() : null;
        await tx.query(
          `INSERT INTO standard_order (id, order_number, account_id, checkout_review_id, status, fulfilment, payment_method,
             service_date, requested_handoff_at, fulfilment_snapshot, subtotal_minor, fee_minor, terms_version,
             proof_due_at, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
          [orderId, "SC-" + orderId.toUpperCase(), actorId, reviewId, status, checkout.fulfilment, paymentMethod,
            date, checkout.requestedHandoffAt, JSON.stringify(saved.fulfilment), saved.subtotalMinor, saved.feeMinor,
            termsVersion, deadline, createdAt],
        );
        await tx.query(
          `INSERT INTO standard_order_line (order_id, variant_id, product_id, cart_line_generation, quantity, unit_minor, display_snapshot)
           SELECT $1, x.variant_id, x.product_id, x.generation, x.quantity, x.unit_minor, x.display
             FROM jsonb_to_recordset($2) AS x(variant_id uuid, product_id uuid, generation uuid,
                                              quantity integer, unit_minor bigint, display jsonb)`,
          [orderId, JSON.stringify(saved.lines.map(({ display, productId, generation }) => ({
            variant_id: display.variantId, product_id: productId, generation,
            quantity: display.quantity, unit_minor: display.unitMinor, display,
          })))],
        );

        if (deadline !== null) {
          const chargeId = randomUUID();
          await tx.query(
            `INSERT INTO charge (id, order_id, category, state, expected_minor, due_at, created_at)
             VALUES ($1,$2,'STANDARD','OPEN',$3,$4,$5)`,
            [chargeId, orderId, saved.subtotalMinor, deadline, createdAt],
          );
          await allocateCapacity(tx, { orderId, handoffAt: checkout.requestedHandoffAt, state: "HELD" }, () => now);
          await tx.query(
            `INSERT INTO durable_work (id, event_key, kind, resource_id, work_state, not_before, payload, created_at)
             VALUES ($1,$2,'STANDARD_PROOF_EXPIRY',$3,'READY',$4,$5,$6)`,
            [randomUUID(), `STANDARD_PROOF_EXPIRY:${orderId}:1`, orderId, deadline, JSON.stringify({ deadline, chargeId }), createdAt],
          );
        } else {
          await bumpCapacityImpact(tx, [date]);
        }
        await tx.query(
          "UPDATE checkout_review SET status = 'SUBMITTED', consumed_at = $2, updated_at = $2 WHERE id = $1",
          [reviewId, createdAt],
        );
        await tx.query(
          `INSERT INTO audit_event (id, actor_id, feature, resource_id, action, occurred_at, request_id, safe_change)
           VALUES ($1,$2,'ORDER',$3,'SUBMIT',$4,$5,$6)`,
          [randomUUID(), actorId, orderId, createdAt, context.requestId, JSON.stringify({ status })],
        );
        return { orderId };
      });
      return ownOrder(tx, actorId, orderId, await nowAt(tx), duitNowQrUrl);
    });
  }

  async function getCheckoutOutcome(actor: Actor, id: string): Promise<Outcome> {
    const actorId = requireRole(actor, "CUSTOMER");
    const reviewId = uuid(id);
    return withTransaction(pool, async (tx) => {
      // Wait for any submit already holding the row before reporting a terminal expiry.
      const { rows: [review] } = await tx.query<Pick<ReviewRow, "status" | "expires_at" | "updated_at">>(
        "SELECT status, expires_at, updated_at FROM checkout_review WHERE account_id = $1 AND id = $2 FOR SHARE",
        [actorId, reviewId],
      );
      if (!review) throw missing();
      const orderId = review.status === "SUBMITTED" ? (await submittedOrder(tx, actorId, reviewId)).id : null;
      return outcome(review, await nowAt(tx), orderId);
    });
  }

  async function abandonOrResolveCheckout(actor: Actor, id: string, context: OrderCommand): Promise<Outcome> {
    const actorId = requireRole(actor, "CUSTOMER");
    const reviewId = uuid(id);
    return withTransaction(pool, (tx) => command(tx, actorId, abandonOperation, context, [reviewId], async () => {
      const review = await lockedReview(tx, actorId, reviewId);
      const now = await nowAt(tx);
      const orderId = review.status === "SUBMITTED" ? (await submittedOrder(tx, actorId, reviewId)).id : null;
      const result = outcome(review, now, orderId);
      if (review.status !== "OPEN") return result;

      const state = result.state === "EXPIRED" ? "EXPIRED" : "ABANDONED";
      const updatedAt = state === "EXPIRED" ? result.updatedAt : new Date(now).toISOString();
      await tx.query("UPDATE checkout_review SET status = $2, updated_at = $3 WHERE id = $1", [reviewId, state, updatedAt]);
      return { state, orderId: null, updatedAt };
    }));
  }

  async function getOwnOrder(actor: Actor, id: string) {
    const actorId = requireRole(actor, "CUSTOMER");
    return ownOrder(pool, actorId, uuid(id), await nowAt(pool), duitNowQrUrl);
  }

  async function getOwnCommandOutcome(actor: Actor, operation: string, idempotencyKey: string): Promise<CommandOutcome> {
    const actorId = requireRole(actor, "CUSTOMER");
    const key = uuid(idempotencyKey);
    if (operation !== submitOperation && operation !== abandonOperation) throw missing();
    const { rows: [receipt] } = await pool.query<{ resource_id: string; created_at: Date }>(
      `SELECT o.id AS resource_id, c.created_at
         FROM command_receipt c JOIN standard_order o
           ON o.id::text = c.result_reference->>'orderId' AND o.account_id = c.actor_id
        WHERE c.actor_id = $1 AND c.operation = $2 AND c.idem_key = $3`,
      [actorId, operation, key],
    );
    if (!receipt) throw missing();
    return { resourceType: "ORDER", resourceId: receipt.resource_id, completedAt: receipt.created_at.toISOString() };
  }

  return { reviewCheckout, submitOrder, getCheckoutOutcome, abandonOrResolveCheckout, getOwnOrder, getOwnCommandOutcome };
}

export type OrderService = ReturnType<typeof createOrderService>;
