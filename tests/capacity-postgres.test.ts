import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import type { Pool } from "pg";
import {
  allocateCapacity, bumpCapacityImpact, capacityRoutes, commitHeldCapacity, createCapacity, markCapacityUsed, reallocateCapacity, releaseCapacity,
} from "../src/server/capacity";
import { withTransaction as transaction, type Queryable } from "../src/server/db";
import { sessionCookieName } from "../src/server/http/request";
import { createIdentity } from "../src/server/identity/service";
import { startTestPostgres } from "./postgres-harness";

const admin = { accountId: randomUUID(), role: "ADMIN" } as const;
const customer = { accountId: randomUUID(), role: "CUSTOMER" } as const;
const cake = { id: randomUUID(), variantId: randomUUID() };
const tart = { id: randomUUID(), variantId: randomUUID() };
const context = () => ({ idempotencyKey: randomUUID(), requestId: randomUUID() });
const handoff = (date: string) => `${date}T21:00:00+08:00`;
type Edit = Parameters<ReturnType<typeof createCapacity>["previewCapacityImpact"]>[1];

async function createOrder(
  tx: Queryable,
  date: string,
  status: string,
  fulfilment = "PICKUP",
  products = [cake],
  pending = false,
): Promise<string> {
  const review = randomUUID();
  const id = randomUUID();
  if (pending) await bumpCapacityImpact(tx, [date]);
  await tx.query(
    `INSERT INTO checkout_review
      (id, account_id, cart_version, review_digest, terms_version, review_snapshot, expires_at, updated_at)
     VALUES ($1,$2,1,'demo','v1','{}',now() + interval '30 minutes',now())`,
    [review, customer.accountId],
  );
  await tx.query(
    `INSERT INTO standard_order
       (id, order_number, account_id, checkout_review_id, status, fulfilment, payment_method, service_date,
        requested_handoff_at, promised_handoff_at, fulfilment_snapshot, subtotal_minor, fee_minor,
        terms_version, created_at, updated_at)
     VALUES ($1,$1::uuid::text,$2,$3,$4,$5,$6,$7,$8::timestamptz,CASE WHEN $4 = 'ACCEPTED' THEN $8::timestamptz ELSE NULL END,
             '{}',100,0,'v1',clock_timestamp(),clock_timestamp())`,
    [id, customer.accountId, review, status, fulfilment, status === "AWAITING_CASH" ? "CASH" : "DUITNOW", date, handoff(date)],
  );
  for (const product of products) {
    await tx.query(
      `INSERT INTO standard_order_line (order_id, variant_id, product_id, quantity, unit_minor, display_snapshot)
       VALUES ($1,$2,$3,1,100,'{}')`,
      [id, product.variantId, product.id],
    );
  }
  return id;
}

function forOrder<T>(pool: Pool, id: string, run: (tx: Queryable) => Promise<T>): Promise<T> {
  return transaction(pool, async (tx) => {
    await tx.query("SELECT id FROM standard_order WHERE id = $1 FOR UPDATE", [id]);
    return run(tx);
  });
}

test("capacity on PostgreSQL 16 with application and worker roles", async (t) => {
  const pg = await startTestPostgres();
  t.after(() => pg.close());
  let now = "2030-01-01T10:00:00Z";
  const clock = () => now;
  const capacity = createCapacity({ pool: pg.api, impactKey: randomBytes(32), clock });
  await pg.api.query(
    `INSERT INTO account (id,role,phone_e164,recovery_email)
     VALUES ($1,'ADMIN',NULL,'merchant@example.test'),($2,'CUSTOMER','+60123456789',NULL)`,
    [admin.accountId, customer.accountId],
  );
  for (const product of [cake, tart]) {
    await pg.api.query("INSERT INTO product (id,name,category,status) VALUES ($1,'Dessert','Desserts','LISTED')", [product.id]);
    await pg.api.query(
      "INSERT INTO variant (id,product_id,name,flavour,available,unit_minor,prep_minutes) VALUES ($1,$2,'Regular','Plain',true,100,180)",
      [product.variantId, product.id],
    );
  }
  const day = (date: string, dayLimit: number, productLimit = dayLimit): Edit => ({
    date, dayLimit, closed: false, productLimits: [{ productId: cake.id, limit: productLimit }], expectedVersion: 0,
  });
  const preview = (edit: Edit, page?: { limit?: number; cursor?: string }) => capacity.previewCapacityImpact(admin, edit, context(), page);
  const confirm = (edit: Edit, impactToken: string, command = context()) => capacity.configureCapacity(admin, { ...edit, impactToken }, command);
  async function configure(edit: Edit) {
    return confirm(edit, (await preview(edit)).impactToken);
  }
  const calendar = async (date: string) => (await capacity.getCapacityCalendar(admin, { from: date, to: date })).days[0];

  await t.test("SC-16–18 cutoff revalidation, eligible alternatives and no advisory allocation", async () => {
    const date = "2030-01-01";
    await configure(day(date, 1));
    await configure(day("2030-01-02", 1));
    const input = { items: [{ variantId: cake.variantId, quantity: 1 }], requestedHandoffAt: handoff(date), fulfilment: "PICKUP" } as const;
    const request = { ...input, items: [...input.items] };
    assert.equal((await capacity.evaluateAvailability(customer, request)).eligible, true);
    assert.equal((await calendar(date)).allocatedUnits, 0);
    const late = "2030-01-01T10:00:00.000001Z";
    now = late;
    const advisory = await capacity.evaluateAvailability(customer, request);
    assert.equal(advisory.eligible, false);
    assert.equal(advisory.alternatives[0], "2030-01-01T22:00:00.000Z");

    const id = await transaction(pg.api, (tx) => createOrder(tx, date, "ACCEPTED"));
    await assert.rejects(forOrder(pg.api, id, (tx) => allocateCapacity(tx, { orderId: id, handoffAt: handoff(date), state: "COMMITTED" }, clock)),
      { code: "CAPACITY_UNAVAILABLE" });
    assert.equal((await calendar(date)).allocatedUnits, 0);
    now = "2030-01-01T10:00:00Z";
    await forOrder(pg.api, id, (tx) => allocateCapacity(tx, { orderId: id, handoffAt: handoff(date), state: "COMMITTED" }, clock));
    assert.equal((await capacity.evaluateAvailability(customer, request)).eligible, false);
  });

  for (const dailyLimit of [2, 10]) {
    await t.test(`SC-19 races fulfilment modes against the last ${dailyLimit === 2 ? "daily and product" : "product"} units`, async () => {
      const date = dailyLimit === 2 ? "2030-01-03" : "2030-01-04";
      await configure(day(date, dailyLimit, 1));
      const ids = await Promise.all(["PICKUP", "CUSTOMER_LALAMOVE"].map((mode) =>
        transaction(pg.api, (tx) => createOrder(tx, date, "PENDING_PROOF", mode, [cake, tart]))));
      let ready = 0;
      let go!: () => void;
      const barrier = new Promise<void>((resolve) => { go = resolve; });
      const outcomes = await Promise.allSettled(ids.map((orderId) => forOrder(pg.api, orderId, async (tx) => {
        if (++ready === 2) go();
        await barrier;
        return allocateCapacity(tx, { orderId, handoffAt: handoff(date), state: "HELD" }, clock);
      })));
      assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
      const loser = outcomes.find((outcome) => outcome.status === "rejected");
      assert.equal(loser?.reason.code, "CAPACITY_UNAVAILABLE");
      assert.equal((await calendar(date)).allocatedUnits, 2);
      const { rows } = await pg.api.query(
        "SELECT order_id, count(*)::integer AS products FROM capacity_allocation WHERE service_date = $1 GROUP BY order_id",
        [date],
      );
      assert.deepEqual(rows, [{ order_id: ids[outcomes.findIndex((outcome) => outcome.status === "fulfilled")], products: 2 }]);
    });
  }

  await t.test("SC-20 releases unused units once under worker grants and retains used units", async () => {
    const date = "2030-01-05";
    await configure(day(date, 2));
    const ids = await Promise.all([1, 2].map(() => transaction(pg.api, (tx) => createOrder(tx, date, "PENDING_PROOF"))));
    for (const id of ids) {
      await forOrder(pg.api, id, (tx) => allocateCapacity(tx, { orderId: id, handoffAt: handoff(date), state: "HELD" }, clock));
    }
    const [expired, preparing] = ids;
    assert.equal(await forOrder(pg.api, preparing, (tx) => commitHeldCapacity(tx, preparing, date)), 1);
    assert.equal(await forOrder(pg.api, preparing, (tx) => markCapacityUsed(tx, preparing, date)), 1);
    const beforeRelease = (await calendar(date)).version;
    assert.equal(await forOrder(pg.worker, expired, async (tx) => {
      await tx.query("UPDATE standard_order SET status = 'EXPIRED' WHERE id = $1", [expired]);
      return releaseCapacity(tx, expired, date);
    }), 1);
    const revision = (await calendar(date)).version;
    assert.equal(revision, beforeRelease + 1);
    assert.equal(await forOrder(pg.worker, expired, (tx) => releaseCapacity(tx, expired, date)), 0);
    assert.equal(await forOrder(pg.api, preparing, (tx) => releaseCapacity(tx, preparing, date)), 0);
    const final = await calendar(date);
    assert.equal(final.version, revision);
    assert.equal(final.allocatedUnits, 1);
    assert.equal(final.productLimits[0].allocatedUnits, 1);
  });

  await t.test("SC-21 counts earlier used generations on exact-fit remakes and preserves failed swaps", async () => {
    const date = "2030-01-06";
    await configure(day(date, 3, 2));
    const orderId = await transaction(pg.api, (tx) => createOrder(tx, date, "ACCEPTED"));
    const input = { orderId, handoffAt: handoff(date), state: "COMMITTED" } as const;
    await forOrder(pg.api, orderId, (tx) => allocateCapacity(tx, input, clock));
    await forOrder(pg.api, orderId, (tx) => markCapacityUsed(tx, orderId, date));
    await forOrder(pg.api, orderId, (tx) => reallocateCapacity(tx, { ...input, previousDate: date }, clock));
    await forOrder(pg.api, orderId, (tx) => markCapacityUsed(tx, orderId, date));
    await assert.rejects(forOrder(pg.api, orderId, (tx) => reallocateCapacity(tx, { ...input, previousDate: date }, clock)),
      { code: "CAPACITY_UNAVAILABLE" });
    const { rows } = await pg.api.query("SELECT generation, state FROM capacity_allocation WHERE order_id = $1 ORDER BY generation", [orderId]);
    assert.deepEqual(rows, [{ generation: 1, state: "USED" }, { generation: 2, state: "USED" }]);
    assert.equal((await calendar(date)).allocatedUnits, 2);

    const otherDate = "2030-01-07";
    await configure(day(otherDate, 1));
    const active = await transaction(pg.api, (tx) => createOrder(tx, otherDate, "ACCEPTED"));
    await forOrder(pg.api, active, (tx) => allocateCapacity(tx, { ...input, orderId: active, handoffAt: handoff(otherDate) }, clock));
    // Catch the domain failure inside the transaction. Nothing in the old allocation should have changed.
    await forOrder(pg.api, active, (tx) => assert.rejects(reallocateCapacity(tx, { ...input, orderId: active, previousDate: otherDate }, clock),
      { code: "CAPACITY_UNAVAILABLE" }));
    assert.equal((await calendar(otherDate)).allocatedUnits, 1);
  });

  await t.test("SC-22–23 protects existing orders and rejects stale and below-used impact reviews", async () => {
    const date = "2030-01-08";
    await configure(day(date, 3));
    const orderId = await transaction(pg.api, (tx) => createOrder(tx, date, "ACCEPTED"));
    await forOrder(pg.api, orderId, async (tx) => {
      await allocateCapacity(tx, { orderId, handoffAt: handoff(date), state: "COMMITTED" }, clock);
      await markCapacityUsed(tx, orderId, date);
    });
    const revision = async () => (await calendar(date)).version;
    let closure = { ...day(date, 3), closed: true, expectedVersion: await revision() };
    const beforeCash = await preview(closure);
    assert.equal(beforeCash.occupiedUnits, 1);
    assert.equal(beforeCash.usedUnits, 1);
    assert.deepEqual(beforeCash.items.map((item) => [item.orderId, item.kind]), [[orderId, "EXISTING_COMMITMENT"]]);
    const cash = await transaction(pg.api, (tx) => createOrder(tx, date, "AWAITING_CASH", "PICKUP", [cake], true));
    await assert.rejects(confirm(closure, beforeCash.impactToken), { code: "VERSION_CONFLICT" });

    closure = { ...closure, expectedVersion: await revision() };
    const beforeFee = await preview(closure);
    const fee = await transaction(pg.api, (tx) => createOrder(tx, date, "AWAITING_FEE", "MERCHANT_LALAMOVE", [cake], true));
    await assert.rejects(confirm(closure, beforeFee.impactToken), { code: "VERSION_CONFLICT" });
    const expectedVersion = await revision();
    for (const edit of [
      { ...day(date, 0, 3), expectedVersion },
      { ...day(date, 3, 0), expectedVersion },
    ]) {
      const blocked = await preview(edit);
      assert.equal(blocked.canSave, false);
      await assert.rejects(confirm(edit, blocked.impactToken), { code: "CAPACITY_UNAVAILABLE" });
    }

    closure = { ...closure, expectedVersion };
    const first = await preview(closure, { limit: 1 });
    assert.equal(first.affectedCount, 3);
    assert.equal(first.items[0].orderId, orderId);
    assert.ok(first.nextCursor);
    const next = await preview(closure, { cursor: first.nextCursor, limit: 2 });
    assert.deepEqual(next.items.map((item) => [item.orderId, item.kind]), [[cash, "PENDING_RECHECK"], [fee, "PENDING_RECHECK"]]);
    assert.equal(next.nextCursor, null);

    await assert.rejects(confirm({ ...closure, dayLimit: 4 }, first.impactToken), { code: "VERSION_CONFLICT" });
    const key = context();
    const closed = await confirm(closure, first.impactToken, key);
    assert.deepEqual(await confirm(closure, first.impactToken, key), closed);
    assert.equal((await calendar(date)).closed, true);
    assert.equal((await calendar(date)).allocatedUnits, 1);
    const { rows } = await pg.api.query("SELECT status, promised_handoff_at FROM standard_order WHERE id = $1", [orderId]);
    assert.equal(rows[0].status, "ACCEPTED");
    assert.equal(rows[0].promised_handoff_at.toISOString(), "2030-01-08T13:00:00.000Z");
    await assert.rejects(forOrder(pg.api, cash, (tx) => allocateCapacity(tx, { orderId: cash, handoffAt: handoff(date), state: "COMMITTED" }, clock)),
      { code: "CAPACITY_UNAVAILABLE" });
  });

  await t.test("weekly updates are versioned and expired previews need fresh review", async () => {
    const policy = await capacity.getOperatingPolicy(admin);
    assert.equal(policy.version, 1);
    const edit = { openWeekdays: ["MON", "TUE"] as ("MON" | "TUE")[], opensAt: "08:00", closesAt: "20:00" };
    const key = context();
    const updated = await capacity.updateOperatingPolicy(admin, edit, '"1"', key);
    assert.equal(updated.version, 2);
    assert.equal(updated.sameDaySubmitCutoff, "18:00");
    assert.deepEqual(await capacity.updateOperatingPolicy(admin, edit, '"1"', key), updated);
    await assert.rejects(capacity.updateOperatingPolicy(admin, edit, '"1"', context()), { code: "VERSION_CONFLICT" });
    await assert.rejects(capacity.getOperatingPolicy(customer), { code: "FORBIDDEN" });
    await assert.rejects(capacity.getOperatingPolicy(null), { code: "UNAUTHENTICATED" });
    const candidate = day("2030-01-09", 1);
    const impact = await preview(candidate);
    now = impact.expiresAt;
    await assert.rejects(confirm(candidate, impact.impactToken), { code: "VERSION_CONFLICT" });
    assert.equal(await calendar(candidate.date), undefined);
  });

  await t.test("HTTP adapter dispatches all six operations with real sessions and CSRF", async () => {
    const origin = "http://127.0.0.1:3000";
    const identity = createIdentity({
      pool: pg.api, secret: randomBytes(32), delivery: pg.otp, newCode: pg.otp.newCode,
      now: pg.clock.now, globalSendLimit: 10, sessionTtlMs: 30 * 60_000,
    });
    const handle = capacityRoutes(capacity, identity, origin);
    async function signIn(role: "ADMIN" | "CUSTOMER", destination: string) {
      const challenge = await identity.start(role, destination);
      return identity.verify(role, challenge.challengeId, pg.otp.newCode());
    }
    const adminAuth = await signIn("ADMIN", "merchant@example.test");
    const customerAuth = await signIn("CUSTOMER", "+60123456789");
    type Auth = typeof adminAuth;
    function call(method: string, target: string, auth?: Auth, body?: unknown, headers?: HeadersInit, requestId = randomUUID()) {
      const fields = new Headers({
        origin, "content-type": "application/json", "idempotency-key": randomUUID(),
      });
      if (auth) {
        fields.set("cookie", `${sessionCookieName}=${auth.token}`);
        fields.set("x-csrf-token", auth.session.csrfToken);
      }
      new Headers(headers).forEach((value, key) => fields.set(key, value));
      return handle(new Request(`${origin}/api/v1/${target}`, { method, headers: fields, body: JSON.stringify(body) }),
        target.split("?")[0], requestId);
    }

    assert.equal(await call("GET", "cart"), undefined);
    assert.equal(await call("GET", "availability"), undefined);
    await assert.rejects(call("GET", "admin/operating-policy"), { code: "UNAUTHENTICATED", status: 401 });
    await assert.rejects(call("GET", "admin/operating-policy", customerAuth), { code: "FORBIDDEN", status: 403 });
    const read = await call("GET", "admin/operating-policy", adminAuth);
    assert.equal(read?.status, 200);
    assert.equal((await read.json()).version, 2);
    const policy = { openWeekdays: ["TUE", "WED"], opensAt: "06:00", closesAt: "22:00" };
    await assert.rejects(call("PUT", "admin/operating-policy", adminAuth, policy, { origin: "http://localhost:3000" }),
      { code: "ORIGIN_DENIED", status: 403 });
    await assert.rejects(call("PUT", "admin/operating-policy", adminAuth, policy, { "x-csrf-token": "" }),
      { code: "FORBIDDEN", status: 403 });
    const updated = await call("PUT", "admin/operating-policy", adminAuth, policy, { "if-match": '"2"' });
    assert.equal((await updated?.json()).version, 3);

    const edit = day("2030-01-09", 1);
    await assert.rejects(call("POST", "admin/capacity/preview", adminAuth, { ...edit, productLimits: [null] }),
      { code: "VALIDATION", status: 422 });
    const impact = await call("POST", "admin/capacity/preview?limit=1", adminAuth, edit);
    const { impactToken, canSave } = await impact?.json();
    assert.equal(canSave, true);
    const requestId = randomUUID();
    const saved = await call("PUT", "admin/capacity", adminAuth, { ...edit, impactToken }, undefined, requestId);
    assert.deepEqual(await saved?.json(), { date: edit.date, version: 1 });
    const { rows } = await pg.api.query("SELECT action FROM audit_event WHERE request_id = $1", [requestId]);
    assert.deepEqual(rows, [{ action: "CONFIGURE_CAPACITY" }]);
    const projected = await call("GET", `admin/capacity-calendar?from=${edit.date}&to=${edit.date}`, adminAuth);
    assert.equal((await projected?.json()).days[0].allocatedUnits, 0);

    const request = { items: [{ variantId: cake.variantId, quantity: 1 }], fulfilment: "PICKUP", requestedHandoffAt: handoff(edit.date) };
    await assert.rejects(call("POST", "availability", adminAuth, request), { code: "FORBIDDEN", status: 403 });
    await assert.rejects(call("POST", "availability", customerAuth, { ...request, items: [null] }),
      { code: "VALIDATION", status: 422 });
    const result = await call("POST", "availability", customerAuth, request);
    assert.equal((await result?.json()).eligible, true);
  });
});
