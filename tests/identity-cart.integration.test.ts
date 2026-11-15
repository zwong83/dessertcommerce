import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createCart } from "./legacy-backend/cart/service";
import { cartRoutes } from "./legacy-backend/cart/routes";
import { ApiProblem, problemResponse } from "./legacy-backend/http/problem";
import { identityRoutes } from "./legacy-backend/identity/routes";
import { createIdentity } from "./legacy-backend/identity/service";
import { startTestPostgres } from "./postgres-harness";

const origin = "http://127.0.0.1:3000";

test("identity and cart through approved HTTP handlers and PostgreSQL 16", async (context) => {
  const database = await startTestPostgres();
  context.after(() => database.close());
  const admin = randomUUID();
  const variant = randomUUID();
  const product = randomUUID();
  await database.api.query("INSERT INTO account (id,role,phone_e164,recovery_email) VALUES ($1,'ADMIN',$2,$3)", [admin, "+60100000101", "owner@example.test"]);
  await database.api.query("INSERT INTO product (id,name,category,status) VALUES ($1,'Tart','Mini','LISTED')", [product]);
  await database.api.query(
    "INSERT INTO variant (id,product_id,name,flavour,available,unit_minor,prep_minutes) VALUES ($1,$2,'Small','Chocolate',true,450,0)",
    [variant, product],
  );
  const identity = createIdentity({
    pool: database.api, secret: Buffer.alloc(32, 7), delivery: database.otp,
    now: database.clock.now, newCode: database.otp.newCode, sessionTtlMs: 3_600_000, globalSendLimit: 30,
  });
  const auth = identityRoutes(identity, origin);
  const cart = cartRoutes(createCart(database.api), identity, origin);

  async function send(path: string, method = "GET", body?: object, supplied: HeadersInit = {}) {
    const headers = new Headers({ Origin: origin });
    new Headers(supplied).forEach((value, key) => headers.set(key, value));
    if (body) headers.set("Content-Type", "application/json");
    const request = new Request(origin + "/api/v1/" + path, { method, headers, body: body && JSON.stringify(body) });
    try {
      const result = await auth(request, path) ?? await cart(request, path);
      if (!result) throw new Error("Expected an implemented route.");
      return result;
    } catch (error) {
      return problemResponse(error, randomUUID());
    }
  }

  await context.test("customer challenge is private, role-bound and usable once", async () => {
    const response = await send("auth/otp/challenges", "POST", { phone: "+60100001234" });
    assert.equal(response.status, 201);
    const challenge = await response.json();
    assert.deepEqual(Object.keys(challenge).sort(), ["challengeId", "expiresAt", "resendAt"]);
    const stored = await database.api.query("SELECT verifier, customer_destination_cipher FROM otp_challenge WHERE id = $1", [challenge.challengeId]);
    assert.equal(stored.rows[0].customer_destination_cipher.includes("+60100001234"), false);
    assert.equal(stored.rows[0].verifier.includes("123456"), false);

    const input = { challengeId: challenge.challengeId, code: "123456" };
    assert.equal((await send("admin/auth/sign-in", "POST", input)).status, 422);
    const race = await Promise.all([send("auth/otp/verify", "POST", input), send("auth/otp/verify", "POST", input)]);
    assert.deepEqual(race.map((result) => result.status).sort(), [200, 422]);
    const success = race.find((result) => result.ok)!;
    const session = await success.json();
    assert.equal(session.role, "CUSTOMER");
    const rawCookie = success.headers.get("set-cookie")!;
    assert.match(rawCookie, /^__Host-sc-session=/);
    assert.match(rawCookie, /HttpOnly; Secure; SameSite=Lax/);
    const Cookie = rawCookie.split(";")[0];

    const probe = await send("session", "GET", undefined, { Cookie });
    assert.deepEqual(await probe.json(), session);
    assert.equal((await send("cart")).status, 401);
    const mutationHeaders = { Cookie, "X-CSRF-Token": session.csrfToken, "If-Match": '"1"', "Idempotency-Key": randomUUID() };
    assert.equal((await send("cart/items/" + variant, "PUT", { quantity: 2 }, { ...mutationHeaders, "X-CSRF-Token": "wrong" })).status, 403);
    assert.equal((await send("cart/items/" + variant, "PUT", { quantity: 2 }, { ...mutationHeaders, Origin: "http://127.0.0.1:4000" })).status, 403);
    const update = await send("cart/items/" + variant, "PUT", { quantity: 2 }, mutationHeaders);
    assert.equal(update.status, 200);
    const updated = await update.json();
    assert.equal(updated.referenceSubtotalMinor, 900);
    assert.equal(updated.version, 2);
    assert.deepEqual(await (await send("cart/items/" + variant, "PUT", { quantity: 2 }, mutationHeaders)).json(), updated);
    assert.equal((await send("cart/items/" + variant, "PUT", { quantity: 3 }, mutationHeaders)).status, 409);
    assert.equal((await send("cart/items/" + variant, "PUT", { quantity: 3 }, { ...mutationHeaders, "Idempotency-Key": randomUUID() })).status, 409);

    const second = await identity.start("CUSTOMER", "+60100001234");
    const device = await identity.verify("CUSTOMER", second.challengeId, "123456");
    assert.equal(device.session.accountId, session.accountId);
    assert.deepEqual(await (await send("cart", "GET", undefined, { Cookie: "__Host-sc-session=" + device.token })).json(), updated);

    const foreign = await identity.start("CUSTOMER", "+60100001238");
    const other = await identity.verify("CUSTOMER", foreign.challengeId, "123456");
    const otherCart = await send("cart", "GET", undefined, { Cookie: "__Host-sc-session=" + other.token });
    assert.deepEqual(await otherCart.json(), { version: 1, lines: [], referenceSubtotalMinor: 0 });
    const originalLine = await database.api.query("SELECT id FROM cart_line WHERE account_id = $1", [session.accountId]);
    const keyFor = (version: number) => ({
      ...mutationHeaders, "If-Match": '"' + version + '"', "Idempotency-Key": randomUUID(),
    });
    assert.equal((await send("cart/items/" + variant, "PUT", { quantity: -1 }, keyFor(2))).status, 422);
    assert.equal((await send("cart/items/" + variant, "PUT", { quantity: 0 }, keyFor(2))).status, 200);
    assert.equal((await send("cart/items/" + variant, "PUT", { quantity: 1 }, keyFor(3))).status, 200);
    const replacement = await database.api.query("SELECT id FROM cart_line WHERE account_id = $1", [session.accountId]);
    assert.notEqual(originalLine.rows[0].id, replacement.rows[0].id);
    await database.api.query("UPDATE variant SET available = false WHERE id = $1", [variant]);
    assert.equal((await send("cart/items/" + variant, "PUT", { quantity: 2 }, keyFor(4))).status, 422);

    assert.equal((await send("session/logout", "POST", undefined, { Cookie, "X-CSRF-Token": session.csrfToken })).status, 204);
    assert.equal((await send("session", "GET", undefined, { Cookie })).status, 401);
    const final = await database.api.query("SELECT customer_destination_cipher FROM otp_challenge WHERE id = $1", [challenge.challengeId]);
    assert.equal(final.rows[0].customer_destination_cipher, null);
    assert.equal((await database.api.query("SELECT count(*)::int AS allocations FROM capacity_allocation")).rows[0].allocations, 0);
  });

  await context.test("expiry, attempts, throttling and provider failure issue no session", async () => {
    const challenge = await identity.start("CUSTOMER", "+60100001235");
    database.clock.advance(300_000);
    await assert.rejects(identity.verify("CUSTOMER", challenge.challengeId, "123456"), (error) => error instanceof ApiProblem && error.status === 422);
    const attempts = await identity.start("CUSTOMER", "+60100001236");
    for (let attempt = 0; attempt < 5; attempt++) {
      await assert.rejects(identity.verify("CUSTOMER", attempts.challengeId, "111111"), (error) => error instanceof ApiProblem && error.status === 422);
    }
    await assert.rejects(identity.verify("CUSTOMER", attempts.challengeId, "123456"));
    await identity.start("CUSTOMER", "+60100001236");
    await identity.start("CUSTOMER", "+60100001236");
    await assert.rejects(identity.start("CUSTOMER", "+60100001236"), (error) => error instanceof ApiProblem && error.status === 429);

    const failed = createIdentity({
      pool: database.api, secret: Buffer.alloc(32, 7),
      now: database.clock.now, newCode: database.otp.newCode, sessionTtlMs: 3_600_000, globalSendLimit: 30,
      delivery: { async deliver() { throw new Error("synthetic timeout"); } },
    });
    await assert.rejects(failed.start("CUSTOMER", "+60100001237"), (error) => error instanceof ApiProblem && error.status === 503);
    const counts = await database.api.query("SELECT count(*)::int AS dead FROM otp_challenge WHERE used_at IS NOT NULL AND customer_destination_cipher IS NULL");
    assert.ok(counts.rows[0].dead >= 4);
  });

  await context.test("admin recovery invalidates old sessions and pre-recovery codes", async () => {
    const login = await identity.start("ADMIN", "+60100000101");
    const original = await identity.verify("ADMIN", login.challengeId, "123456");
    const stale = await identity.start("ADMIN", "+60100000101");
    const unknown = await identity.start("ADMIN", "stranger@example.test");
    await assert.rejects(identity.verify("ADMIN", unknown.challengeId, "123456"));
    const recovery = await identity.start("ADMIN", "owner@example.test", "RECOVERY");
    const after = await identity.verify("ADMIN", recovery.challengeId, "123456");
    assert.equal(after.session.accountId, admin);
    await assert.rejects(identity.getSession(original.token));
    await assert.rejects(identity.verify("ADMIN", stale.challengeId, "123456"));
    assert.equal((await send("cart", "GET", undefined, { Cookie: "__Host-sc-session=" + after.token })).status, 403);
  });
});
