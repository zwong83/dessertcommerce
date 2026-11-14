import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createCart } from "../frontend/server/cart/service";
import { problemResponse } from "../frontend/server/http/problem";
import { createIdentity } from "../frontend/server/identity/service";
import { createOrderService, orderRoutes } from "../frontend/server/order";
import { startTestPostgres } from "./postgres-harness";

const origin = "http://127.0.0.1:3000";
const command = () => ({ idempotencyKey: randomUUID(), requestId: randomUUID() });
const address = { line1: "4 Fixture Lane", city: "Kuala Lumpur", postcode: "50000", region: "Kuala Lumpur", note: "Call at the gate" };
const reviewTtlMs = 60_000;

test("checkout 3.1 against isolated PostgreSQL 16", async (context) => {
  const { api, clock, otp, close } = await startTestPostgres();
  context.after(close);
  const cart = createCart(api);
  const identity = createIdentity({
    pool: api, secret: Buffer.alloc(32, 7), delivery: otp, now: clock.now, newCode: otp.newCode,
    sessionTtlMs: 3_600_000, globalSendLimit: 30,
  });
  let customerCount = 0;
  let day = 1;
  async function customer() {
    const challenge = await identity.start("CUSTOMER", `+60100000${String(++customerCount).padStart(3, "0")}`);
    return identity.verify("CUSTOMER", challenge.challengeId, "123456");
  }

  async function fixture(max = 8, existingDate?: string) {
    const { token, session } = await customer();
    const date = existingDate ?? `2030-01-${String(day++).padStart(2, "0")}`;
    const variant = randomUUID();
    const product = randomUUID();
    await api.query("INSERT INTO product (id,name,status) VALUES ($1,'Mini Tart','LISTED')", [product]);
    await api.query(
      "INSERT INTO variant (id,product_id,name,flavour,available,unit_minor,prep_minutes) VALUES ($1,$2,'Box of tarts','Chocolate',true,450,30)",
      [variant, product],
    );
    if (!existingDate) await api.query("INSERT INTO capacity_day (service_date,closed,max_units) VALUES ($1,false,$2)", [date, max]);
    await cart.setQuantity(session, { variantId: variant, quantity: 3, expectedVersion: "1", ...command() });
    let terms = { version: "fixture-v1", text: "Fixture pickup and delivery terms." };
    let pickupDisplay = "Fixture pickup, Gate 2";
    const order = createOrderService({
      pool: api, terms: () => terms, pickupDisplay: () => pickupDisplay, clock: clock.now, reviewTtlMs,
      duitNowQrUrl: "/fixture-qr",
    });
    const input = {
      items: [{ variantId: variant, quantity: 2 }], requestedHandoffAt: `${date}T12:30:00+08:00`,
      fulfilment: "PICKUP", cartVersion: 2, contactName: "Fixture Customer",
      phone: "+60100000001", notificationEmail: "fixture@example.test",
    };
    const review = (changes: object = {}) => order.reviewCheckout(session, { ...input, ...changes });
    const submission = (current: { reviewId: string; termsVersion: string }, changes: object = {}) => ({
      ...input, reviewId: current.reviewId, termsVersion: current.termsVersion, paymentMethod: "DUITNOW", ...changes,
    });
    return {
      order, token, session, date, variant, product, input, review, submission,
      setTerms(version: string, text: string) { terms = { version, text }; },
      setPickup(value: string) { pickupDisplay = value; },
    };
  }

  async function effects(reviewId: string, accountId: string) {
    const { rows: [row] } = await api.query(
      `SELECT (SELECT count(*)::int FROM standard_order WHERE checkout_review_id = r.id) AS orders,
              (SELECT count(*)::int FROM command_receipt WHERE actor_id = $2 AND operation = 'submitOrder') AS receipts,
              r.status
         FROM checkout_review r WHERE r.id = $1`,
      [reviewId, accountId],
    );
    return row;
  }

  await context.test("SC-26 and SC-29: HTTP review, concurrent replay, exact hold and historical owner snapshot", async () => {
    const f = await fixture();
    const foreign = await customer();
    const handle = orderRoutes(f.order, identity, origin);
    async function send(method: string, target: string, body?: unknown, headers?: HeadersInit) {
      const path = target.split("?")[0];
      const request = new Request(origin + "/api/v1/" + target, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      try {
        return await handle(request, path, randomUUID()) ?? new Response(null, { status: 404 });
      } catch (error) {
        return problemResponse(error, randomUUID());
      }
    }
    const ownCookie = "__Host-sc-session=" + f.token;
    const foreignCookie = "__Host-sc-session=" + foreign.token;
    const headers = {
      Cookie: ownCookie, Origin: origin, "X-CSRF-Token": f.session.csrfToken,
      "Content-Type": "application/json", "Idempotency-Key": randomUUID(),
    };
    assert.equal((await send("POST", "checkout/review", f.input, { ...headers, "X-CSRF-Token": "wrong" })).status, 403);
    assert.equal((await send("POST", "checkout/review", f.input, { ...headers, Origin: "http://127.0.0.1:4000" })).status, 403);
    const reviewed = await send("POST", "checkout/review", f.input, headers);
    assert.equal(reviewed.status, 200);
    const review = await reviewed.json();
    assert.deepEqual(review.items, [{ variantId: f.variant, quantity: 2, product: "Mini Tart", variant: "Box of tarts", flavour: "Chocolate", unitMinor: 450 }]);
    assert.deepEqual([review.eligible, review.pickupDisplay, review.subtotalMinor, review.feeMinor, review.totalMinor], [true, "Fixture pickup, Gate 2", 900, 0, 900]);
    assert.deepEqual([review.contactName, review.phone, review.notificationEmail, review.termsText],
      [f.input.contactName, f.input.phone, f.input.notificationEmail, "Fixture pickup and delivery terms."]);
    assert.deepEqual(review.paymentMethods, ["DUITNOW", "CASH"]);
    assert.equal((await api.query("SELECT allocated_units FROM capacity_day WHERE service_date = $1", [f.date])).rows[0].allocated_units, 0);

    const body = f.submission(review);
    const [first, second] = await Promise.all([send("POST", "orders", body, headers), send("POST", "orders", body, headers)]);
    assert.deepEqual([first.status, second.status], [201, 201]);
    const order = await first.json();
    assert.deepEqual(await second.json(), order);
    assert.deepEqual(await f.order.submitOrder(f.session, body, command()), order);
    assert.equal(order.status, "PENDING_PROOF");
    assert.equal(order.proofDueAt, new Date(clock.now().getTime() + 30 * 60_000).toISOString());
    assert.deepEqual([order.charge.expectedMinor, order.charge.dueAt, order.charge.qrUrl], [900, order.proofDueAt, "/fixture-qr"]);
    assert.deepEqual((await api.query(
      `SELECT a.product_id, a.quantity, a.state, d.allocated_units, d.version, l.cart_line_generation = cl.id AS saved_generation
         FROM capacity_allocation a JOIN capacity_day d USING (service_date)
         JOIN standard_order_line l ON l.order_id = a.order_id JOIN cart_line cl ON cl.account_id = $2 AND cl.variant_id = l.variant_id
        WHERE a.order_id = $1`,
      [order.id, f.session.accountId],
    )).rows, [{ product_id: f.product, quantity: 2, state: "HELD", allocated_units: 2, version: "2", saved_generation: true }]);
    assert.deepEqual((await api.query(
      "SELECT kind, not_before, payload FROM durable_work WHERE resource_id = $1", [order.id],
    )).rows, [{ kind: "STANDARD_PROOF_EXPIRY", not_before: new Date(order.proofDueAt), payload: { deadline: order.proofDueAt, chargeId: order.charge.id } }]);
    assert.deepEqual(await effects(review.reviewId, f.session.accountId), { orders: 1, receipts: 2, status: "SUBMITTED" });
    assert.equal((await cart.get(f.session)).lines[0].quantity, 3);

    const changed = await send("POST", "orders", { ...body, contactName: "Other contact" }, headers);
    assert.equal((await changed.json()).code, "IDEMPOTENCY_CONFLICT");
    const reviewPath = `checkout/reviews/${review.reviewId}`;
    assert.equal((await send("GET", reviewPath + "/outcome", undefined, { Cookie: foreignCookie })).status, 404);
    assert.equal((await send("POST", reviewPath + "/abandon", undefined,
      { ...headers, Cookie: foreignCookie, "X-CSRF-Token": foreign.session.csrfToken })).status, 404);
    assert.equal((await send("POST", "orders", body,
      { ...headers, Cookie: foreignCookie, "X-CSRF-Token": foreign.session.csrfToken })).status, 404);
    assert.equal((await send("GET", `orders/${order.id}`, undefined, { Cookie: foreignCookie })).status, 404);
    assert.equal((await send("GET", `orders/${order.id}`)).status, 401);
    const commandPath = `commands/${headers["Idempotency-Key"]}?operation=submitOrder`;
    assert.equal((await send("GET", commandPath, undefined, { Cookie: foreignCookie })).status, 404);
    const completed = await (await send("GET", commandPath, undefined, { Cookie: ownCookie })).json();
    assert.deepEqual([completed.resourceType, completed.resourceId], ["ORDER", order.id]);
    assert.ok(Number.isFinite(Date.parse(completed.completedAt)));

    // Seed the already-paid state. Settlement commands are a separate task.
    await api.query(
      `INSERT INTO money_entry (id, charge_id, kind, rail, external_reference, amount_minor, occurred_at, actor_id)
       VALUES ($1,$2,'RECEIPT','DUITNOW',$3,900,$4,$5)`,
      [randomUUID(), order.charge.id, randomUUID(), clock.now(), f.session.accountId],
    );
    await api.query("UPDATE charge SET state = 'PAID', version = version + 1 WHERE id = $1", [order.charge.id]);
    await api.query("UPDATE standard_order SET status = 'ACCEPTED', version = version + 1 WHERE id = $1", [order.id]);
    await api.query("UPDATE variant SET name = 'New box', flavour = 'New flavour', unit_minor = 500 WHERE id = $1", [f.variant]);
    await api.query("UPDATE product SET name = 'New product', status = 'ARCHIVED' WHERE id = $1", [f.product]);
    f.setTerms("fixture-v2", "Changed terms");
    f.setPickup("Another pickup point");
    const historical = await (await send("GET", `orders/${order.id}`, undefined, { Cookie: ownCookie })).json();
    for (const key of ["number", "items", "contactName", "phone", "notificationEmail", "requestedHandoffAt",
      "pickupDisplay", "subtotalMinor", "feeMinor", "totalMinor", "termsVersion", "termsText"]) {
      assert.deepEqual(historical[key], order[key], key);
    }
    assert.deepEqual([historical.status, historical.charge.paidMinor, historical.charge.qrUrl], ["ACCEPTED", 900, null]);
    assert.equal((await send("PUT", `orders/${order.id}`, { contactName: "Edit" }, headers)).status, 404);
    assert.equal((await f.order.submitOrder(f.session, body, command())).id, order.id);
  });

  await context.test("SC-26: fee and Cash wait without charge, hold or cart consumption; customer delivery holds", async () => {
    const f = await fixture();
    const delivery = { fulfilment: "MERCHANT_LALAMOVE", address };
    const provisional = await f.review(delivery);
    assert.deepEqual([provisional.subtotalMinor, provisional.feeMinor, provisional.totalMinor, provisional.pickupDisplay],
      [900, null, null, null]);
    assert.deepEqual(provisional.address, address);
    await assert.rejects(f.order.submitOrder(f.session, f.submission(provisional, { ...delivery, paymentMethod: "CASH" }), command()),
      { code: "VALIDATION" });
    const fee = await f.order.submitOrder(f.session, f.submission(provisional, delivery), command());
    const cash = await f.order.submitOrder(f.session, f.submission(await f.review(), { paymentMethod: "CASH" }), command());
    assert.deepEqual([fee.status, cash.status], ["AWAITING_FEE", "AWAITING_CASH"]);
    for (const waiting of [fee, cash]) {
      assert.deepEqual([waiting.proofDueAt, waiting.charge, waiting.promisedHandoffAt], [null, null, null]);
      const counts = await api.query(
        `SELECT (SELECT count(*)::int FROM capacity_allocation WHERE order_id = $1) AS allocations,
                (SELECT count(*)::int FROM durable_work WHERE resource_id = $1) AS work`, [waiting.id],
      );
      assert.deepEqual(counts.rows, [{ allocations: 0, work: 0 }]);
    }
    assert.deepEqual((await api.query("SELECT allocated_units, version FROM capacity_day WHERE service_date = $1", [f.date])).rows,
      [{ allocated_units: 0, version: "3" }]);
    assert.equal((await cart.get(f.session)).lines[0].quantity, 3);

    const ownDelivery = { fulfilment: "CUSTOMER_LALAMOVE", address };
    const review = await f.review(ownDelivery);
    assert.match(review.instructions, /pay Lalamove separately/);
    assert.equal(review.totalMinor, 900);
    const order = await f.order.submitOrder(f.session, f.submission(review, ownDelivery), command());
    assert.deepEqual([order.status, order.feeMinor, order.charge?.expectedMinor], ["PENDING_PROOF", 0, 900]);
  });

  await context.test("SC-27: changes to request, catalogue, terms, cart, or capacity invalidate review", async () => {
    const f = await fixture();
    const review = await f.review({ fulfilment: "MERCHANT_LALAMOVE", address });
    const base = f.submission(review, { fulfilment: "MERCHANT_LALAMOVE", address });
    for (const changes of [
      { contactName: "Different name" }, { phone: "Different phone" }, { notificationEmail: "other@example.test" },
      { address: { ...address, note: "Different gate" } }, { items: [{ variantId: f.variant, quantity: 1 }] },
      { requestedHandoffAt: `${f.date}T13:30:00+08:00` }, { fulfilment: "CUSTOMER_LALAMOVE" }, { cartVersion: 3 },
    ]) await assert.rejects(f.order.submitOrder(f.session, { ...base, ...changes }, command()), { code: "REVIEW_STALE" });
    f.setTerms("fixture-v1", "Changed text under the same version");
    await assert.rejects(f.order.submitOrder(f.session, base, command()), { code: "TERMS_CHANGED" });
    f.setTerms("fixture-v2", "New terms version");
    await assert.rejects(f.order.submitOrder(f.session, base, command()), { code: "TERMS_CHANGED" });
    const pickup = f.submission(await f.review());
    f.setPickup("Changed pickup point");
    await assert.rejects(f.order.submitOrder(f.session, pickup, command()), { code: "REVIEW_STALE" });

    const current = f.submission(await f.review());
    await api.query("UPDATE variant SET flavour = 'Vanilla' WHERE id = $1", [f.variant]);
    await assert.rejects(f.order.submitOrder(f.session, current, command()), { code: "REVIEW_STALE" });
    const repriced = f.submission(await f.review());
    await api.query("UPDATE variant SET unit_minor = 500 WHERE id = $1", [f.variant]);
    await assert.rejects(f.order.submitOrder(f.session, repriced, command()), { code: "REVIEW_STALE" });
    const closed = f.submission(await f.review());
    await api.query("UPDATE capacity_day SET closed = true, version = version + 1 WHERE service_date = $1", [f.date]);
    await assert.rejects(f.order.submitOrder(f.session, closed, command()), { code: "CAPACITY_UNAVAILABLE" });
    const ineligible = await f.review();
    assert.equal(ineligible.eligible, false);
    assert.deepEqual(ineligible.paymentMethods, []);
    await api.query("UPDATE capacity_day SET closed = false, version = version + 1 WHERE service_date = $1", [f.date]);
    await assert.rejects(f.order.submitOrder(f.session, f.submission(ineligible), command()), { code: "REVIEW_STALE" });

    const staleCart = f.submission(await f.review());
    await cart.setQuantity(f.session, { variantId: f.variant, quantity: 2, expectedVersion: "2", ...command() });
    await assert.rejects(f.order.submitOrder(f.session, staleCart, command()), { code: "REVIEW_STALE" });
    assert.deepEqual(await effects(staleCart.reviewId, f.session.accountId), { orders: 0, receipts: 0, status: "OPEN" });
  });

  await context.test("SC-28: submit and abandon serialize in both directions", async () => {
    async function waitForContenders(expected: number) {
      for (let i = 0; i < 200; i++) {
        const { rows: [row] } = await api.query<{ waiting: number }>(
          `SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND query LIKE $1`,
          ["%FROM checkout_review WHERE account_id = $1 AND id = $2 FOR UPDATE%"],
        );
        if (row.waiting >= expected) return;
        await delay(5);
      }
      assert.fail("Checkout contenders did not reach the row lock");
    }
    for (const submitFirst of [true, false]) {
      const f = await fixture();
      const review = await f.review();
      const body = f.submission(review);
      assert.equal((await f.order.getCheckoutOutcome(f.session, review.reviewId)).state, "OPEN");
      const blocker = await api.connect();
      const attempts: Promise<unknown>[] = [];
      const submit = () => f.order.submitOrder(f.session, body, command());
      const abandon = () => f.order.abandonOrResolveCheckout(f.session, review.reviewId, command());
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM checkout_review WHERE id = $1 FOR UPDATE", [review.reviewId]);
        attempts.push(submitFirst ? submit() : abandon());
        await waitForContenders(1);
        attempts.push(submitFirst ? abandon() : assert.rejects(submit(), { code: "REVIEW_STALE" }));
        await waitForContenders(2);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await Promise.allSettled(attempts);
      }
      const [winner] = await Promise.all(attempts);
      const result = await f.order.getCheckoutOutcome(f.session, review.reviewId);
      if (submitFirst) {
        assert.ok(winner && typeof winner === "object" && "id" in winner);
        assert.equal(result.state, "SUBMITTED");
        assert.equal(result.orderId, winner.id);
        assert.deepEqual(await attempts[1], result);
      } else {
        assert.equal(result.state, "ABANDONED");
        assert.equal(result.orderId, null);
        assert.deepEqual(winner, result);
        await assert.rejects(submit(), { code: "REVIEW_STALE" });
      }
      assert.deepEqual(await effects(review.reviewId, f.session.accountId), {
        orders: Number(submitFirst), receipts: Number(submitFirst), status: result.state,
      });
    }
  });

  await context.test("competing checkout reviews cannot oversell the last units", async () => {
    const first = await fixture(2);
    const second = await fixture(2, first.date);
    const inputs = await Promise.all([first.review(), second.review()]);
    assert.ok(inputs.every((review) => review.eligible));
    const outcomes = await Promise.allSettled([first, second].map((f, i) => f.order.submitOrder(f.session, f.submission(inputs[i]), command())));
    assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    const failed = outcomes.find((result) => result.status === "rejected");
    assert.equal(failed?.reason.code, "CAPACITY_UNAVAILABLE");
    const { rows: [effects] } = await api.query(
      `SELECT count(*)::int AS orders, count(c.id)::int AS charges, count(w.id)::int AS work
         FROM standard_order o LEFT JOIN charge c ON c.order_id = o.id LEFT JOIN durable_work w ON w.resource_id = o.id
        WHERE o.service_date = $1`, [first.date],
    );
    assert.deepEqual(effects, { orders: 1, charges: 1, work: 1 });
  });

  await context.test("review expires at its exact cutoff and abandonment persists the terminal state", async () => {
    const f = await fixture();
    const review = await f.review();
    clock.advance(reviewTtlMs);
    const expired = { state: "EXPIRED", orderId: null, updatedAt: review.expiresAt };
    assert.deepEqual(await f.order.getCheckoutOutcome(f.session, review.reviewId), expired);
    assert.deepEqual(await f.order.abandonOrResolveCheckout(f.session, review.reviewId, command()), expired);
    await assert.rejects(f.order.submitOrder(f.session, f.submission(review), command()), { code: "REVIEW_STALE" });
    assert.deepEqual(await effects(review.reviewId, f.session.accountId), { orders: 0, receipts: 0, status: "EXPIRED" });
  });
});
