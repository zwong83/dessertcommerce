import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import type { components, operations } from "../frontend/contracts/commercial-v1";
import { createCart } from "../tests/legacy-backend/cart/service";
import { createIdentity } from "../tests/legacy-backend/identity/service";
import { createOrderService } from "../tests/legacy-backend/order";
import { databaseUrl, freeLoopbackPort, startTestPostgres } from "../tests/postgres-harness";
import { startPython, waitForExit } from "./python-runtime";

type Order = components["schemas"]["Order"];
type Event = components["schemas"]["Event"];
type Charge = components["schemas"]["Charge"];
type Proof = components["schemas"]["Proof"];
type ChargeReview = operations["getChargeForReview"]["responses"][200]["content"]["application/json"];

async function expectStatus(response: Response, expected: number, step: string) {
  if (response.status === expected) return;
  const problem = response.headers.get("content-type")?.startsWith("application/problem+json")
    ? await response.json().catch(() => null) : null;
  const code = typeof problem?.code === "string" && /^[A-Z_]{1,50}$/.test(problem.code) ? ` (${problem.code})` : "";
  assert.equal(response.status, expected, `${step}: expected HTTP ${expected}, received ${response.status}${code}`);
}

async function expectJson<T>(response: Response, status: number, step: string): Promise<T> {
  await expectStatus(response, status, step);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/, step);
  return response.json();
}

async function expectProtectedRedirect(response: Response, target: string, protectedMarkers: string[], step: string) {
  const html = await response.text();
  if (response.status === 200) {
    // A loading boundary can flush before Next.js resolves the session and inserts this redirect.
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/, step);
    const redirect = html.match(/<meta\b(?=[^>]*\sid="__next-page-redirect")(?=[^>]*\shttp-equiv="refresh")(?=[^>]*\scontent="[01];url=([^"<>\s]+)")[^>]*>/);
    assert.equal(redirect?.[1], target, step);
  } else {
    await expectStatus(response, 307, step);
    assert.equal(response.headers.get("location"), target, step);
  }
  for (const marker of protectedMarkers) {
    assert.ok(!html.includes(marker), `${step}: protected content appeared in the response`);
  }
}

function writeHeaders(version?: number) {
  return {
    "Idempotency-Key": randomUUID(),
    ...(version === undefined ? {} : { "If-Match": `"${version}"` }),
  };
}

async function verifyBridge() {
  const db = await startTestPostgres();
  const children: ReturnType<typeof spawn>[] = [];
  const exits: Promise<number>[] = [];
  function watch(name: string, child: ReturnType<typeof spawn>) {
    children.push(child);
    const exit = waitForExit(child);
    exits.push(exit);
    return exit.then((code) => { throw new Error(`${name} exited before the bridge finished (code ${code}).`); });
  }
  try {
    const migration = startPython("sweetcommerce.migrate", [], {
      ...process.env, SWEETCOMMERCE_MIGRATION_DATABASE_URL: databaseUrl(db.migration),
    });
    assert.equal(await waitForExit(migration), 0, "Python accepts the existing TypeScript migration ledger.");
    const webPort = await freeLoopbackPort();
    const apiPort = await freeLoopbackPort();
    const origin = "http://127.0.0.1:" + webPort;
    const apiOrigin = "http://127.0.0.1:" + apiPort;
    const secret = randomBytes(32);
    const code = "123456";
    const terms = { version: "bridge-v1", text: "Bridge test terms." };
    const pickup = "Bridge pickup";
    const product = randomUUID();
    const variant = randomUUID();
    const now = Date.now();
    const dayMs = 24 * 60 * 60_000;
    const myt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "short" });
    const day = myt.format(new Date(now + 2 * dayMs));
    const eventDay = myt.format(new Date(now + 10 * dayMs));
    const balanceDay = myt.format(new Date(now + 7 * dayMs));
    const fixture = { pool: db.api, secret, delivery: db.otp, newCode: () => code, sessionTtlMs: 600_000, globalSendLimit: 30 };
    const identity = createIdentity(fixture);
    const challenge = await identity.start("CUSTOMER", "+60000000002");
    const { token, session } = await identity.verify("CUSTOMER", challenge.challengeId, code);
    await db.api.query("INSERT INTO account (id,role,phone_e164) VALUES ($1,'CUSTOMER',$2)", [randomUUID(), "+60000000003"]);
    const unverified = await identity.start("CUSTOMER", "+60000000003");
    await db.api.query("INSERT INTO account (id,role,phone_e164) VALUES ($1,'ADMIN',$2)", [randomUUID(), "+60000000001"]);
    await db.api.query("INSERT INTO product (id,name,category,status) VALUES ($1,'Bridge chocolate tart','Tarts','LISTED')", [product]);
    await db.api.query(`
      INSERT INTO variant (id,product_id,name,flavour,available,unit_minor,prep_minutes)
      VALUES ($1,$2,'Mini','Chocolate',true,450,30)
    `, [variant, product]);
    await db.api.query("INSERT INTO operating_policy (open_weekdays,opens_at,closes_at) VALUES (ARRAY[1,2,3,4,5,6,7]::smallint[],'06:00','22:00')");
    await db.api.query("INSERT INTO capacity_day (service_date,closed,max_units) VALUES ($1,false,30)", [day]);
    const cartKey = randomUUID();
    const oldCart = await createCart(db.api).setQuantity(session, {
      expectedVersion: "1", variantId: variant, quantity: 2, idempotencyKey: cartKey,
    });
    const checkout = {
      items: [{ variantId: variant, quantity: 1 }], requestedHandoffAt: day + "T12:30:00+08:00",
      fulfilment: "PICKUP", cartVersion: 2, contactName: "Bridge customer", phone: "+60000000002",
    };
    const oldReview = await createOrderService({
      pool: db.api, terms: () => terms, pickupDisplay: () => pickup, reviewTtlMs: 600_000,
    }).reviewCheckout(session, checkout);

    const oldClock = () => new Date(Date.now() - 31 * 60_000);
    const oldOrderService = createOrderService({
      pool: db.api, terms: () => terms, pickupDisplay: () => pickup, reviewTtlMs: 600_000, clock: oldClock,
    });
    const dueReview = await oldOrderService.reviewCheckout(session, checkout);
    const dueOrder = await oldOrderService.submitOrder(session, {
      ...checkout, reviewId: dueReview.reviewId, termsVersion: terms.version, paymentMethod: "DUITNOW",
    }, { idempotencyKey: randomUUID(), requestId: randomUUID() });
    assert.equal(dueOrder.status, "PENDING_PROOF");

    const apiExited = watch("FastAPI", startPython("sweetcommerce", [], {
      ...process.env, NODE_ENV: "development", SWEETCOMMERCE_ENV: "development",
      SWEETCOMMERCE_API_PORT: String(apiPort), DATABASE_URL: databaseUrl(db.api),
      SWEETCOMMERCE_ORIGIN: origin, SWEETCOMMERCE_IDENTITY_KEY: secret.toString("base64url"),
      SWEETCOMMERCE_OTP_MODE: "synthetic", SWEETCOMMERCE_SYNTHETIC_OTP: code,
      SWEETCOMMERCE_TERMS_VERSION: terms.version, SWEETCOMMERCE_TERMS_TEXT: terms.text,
      SWEETCOMMERCE_PICKUP_DISPLAY: pickup,
    }));
    const workerExited = watch("Python Worker", startPython("sweetcommerce.worker", [], {
      ...process.env, SWEETCOMMERCE_WORKER_DATABASE_URL: databaseUrl(db.worker), SWEETCOMMERCE_WORKER_MODE: "timers",
    }));
    const webExited = watch("Next.js", spawn(process.execPath, [
      fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)),
      "start", "frontend", "--hostname", "127.0.0.1", "--port", String(webPort),
    ], {
      stdio: "inherit",
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", SWEETCOMMERCE_API_ORIGIN: apiOrigin },
    }));

    async function journey() {
      const headers = { Cookie: "__Host-sc-session=" + token, Origin: origin, "X-CSRF-Token": session.csrfToken };
      const web = (path: string, init?: RequestInit) => fetch(origin + path, {
        redirect: "manual", signal: AbortSignal.timeout(20_000), ...init,
      });
      for (let attempt = 0; ; attempt++) {
        const response = await web("/api/v1/session", { headers }).catch(() => null);
        if (response?.ok) {
          assert.deepEqual(await response.json(), session);
          break;
        }
        if (attempt >= 80) throw new Error("Next.js and FastAPI did not become ready.");
        await delay(250);
      }

      const request = async (method: string, path: string, data: unknown, extra?: Record<string, string>, actor = headers) => {
        return web("/api/v1" + path, {
          method,
          headers: { ...actor, "Content-Type": "application/json", ...extra },
          body: data === undefined ? undefined : JSON.stringify(data),
        });
      };
      for (let attempt = 0; ; attempt++) {
        const prior = await web("/api/v1/orders/" + dueOrder.id, { headers });
        const priorOrder = await expectJson<Order>(prior, 200, "Read the pre-cutover order queued for proof expiry");
        if (priorOrder.status === "EXPIRED") break;
        if (attempt >= 20) throw new Error("Python Worker did not process the pre-cutover proof expiry.");
        await delay(250);
      }
      const released = await db.api.query("SELECT state FROM capacity_allocation WHERE order_id = $1", [dueOrder.id]);
      assert.deepEqual(released.rows, [{ state: "RELEASED" }]);

      const other = await request("POST", "/auth/otp/verify", { challengeId: unverified.challengeId, code });
      await expectStatus(other, 200, "Verify the pre-cutover OTP challenge");
      assert.match(other.headers.get("set-cookie") ?? "", /^__Host-sc-session=.+; Path=\/; HttpOnly; Secure; SameSite=Lax/);
      assert.equal(other.headers.get("cache-control"), "no-store");
      const wrongOrigin = await request("PUT", "/cart/items/" + variant, { quantity: 2 }, { Origin: "https://foreign.example" });
      await expectStatus(wrongOrigin, 403, "Deny cart updates from the wrong origin");
      assert.equal((await wrongOrigin.json()).requestId, wrongOrigin.headers.get("x-request-id"));

      const cart = await request("PUT", "/cart/items/" + variant, { quantity: 2 }, {
        "Idempotency-Key": cartKey, "If-Match": '"1"',
      });
      await expectStatus(cart, 200, "Replay the pre-cutover cart update");
      assert.deepEqual(await cart.json(), oldCart);
      assert.ok((await (await web("/shop", { headers })).text()).includes("Bridge chocolate tart"), "Storefront renders the FastAPI catalogue");
      assert.ok((await (await web("/cart", { headers })).text()).includes("Your cart"), "Cart renders for the migrated session");
      await expectProtectedRedirect(await web("/merchant", { headers }), "/merchant/login", [
        "You are signed in with the dedicated merchant account.", "Merchant operations",
      ], "Redirect the customer away from the merchant workspace");

      const order = await expectJson<Order>(await request("POST", "/orders", {
        ...checkout, reviewId: oldReview.reviewId, termsVersion: terms.version, paymentMethod: "DUITNOW",
      }, writeHeaders()), 201, "Submit the pre-cutover checkout review");
      assert.equal(order.status, "PENDING_PROOF");
      assert.equal(order.totalMinor, 450);
      assert.ok((await (await web("/orders/" + order.id, { headers })).text()).includes("Bridge test terms"), "Owned order renders the original terms snapshot");

      const adminStart = await request("POST", "/admin/auth/challenges", { verifiedContact: "+60000000001" });
      await expectStatus(adminStart, 201, "Start the synthetic merchant OTP challenge");
      const adminLogin = await request("POST", "/admin/auth/sign-in", { challengeId: (await adminStart.json()).challengeId, code });
      await expectStatus(adminLogin, 200, "Verify the synthetic merchant OTP challenge");
      const admin = {
        Origin: origin,
        Cookie: adminLogin.headers.get("set-cookie")!.split(";", 1)[0],
        "X-CSRF-Token": (await adminLogin.json()).csrfToken,
      };
      const draft = await request("POST", "/admin/products", { name: "Binary fixture" }, { "Idempotency-Key": randomUUID() }, admin);
      await expectStatus(draft, 201, "Create the merchant product draft");
      const draftId = (await draft.json()).id;
      const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fac0cb" } }).png().toBuffer();
      const upload = await web("/api/v1/admin/products/" + draftId + "/media", {
        method: "POST", body: Uint8Array.from(png),
        headers: { ...admin, "Content-Type": "application/octet-stream", "X-File-Media-Type": "image/png", "Idempotency-Key": randomUUID() },
      });
      await expectStatus(upload, 201, "Upload synthetic product media");
      const photo = await web("/api/v1/admin/products/" + draftId + "/media/" + (await upload.json()).id, { headers: admin });
      await expectStatus(photo, 200, "Read synthetic product media");
      assert.equal(photo.headers.get("content-type"), "image/png");
      assert.equal(photo.headers.get("x-content-type-options"), "nosniff");
      assert.equal((await sharp(Buffer.from(await photo.arrayBuffer())).metadata()).width, 2);
      process.stdout.write("Pre-cutover migration, session, OTP, cart replay, checkout review, queued expiry, and binary catalogue media passed.\n");

      async function submitProof(charge: Charge, step: string) {
        const proof = await expectJson<Proof>(await web(`/api/v1/charges/${charge.id}/proof`, {
          method: "POST", body: Uint8Array.from(png),
          headers: { ...headers, ...writeHeaders(), "Content-Type": "application/octet-stream", "X-File-Media-Type": "image/png" },
        }), 201, `${step} proof upload`);
        assert.equal(proof.chargeId, charge.id, step);
        assert.equal(proof.state, "REVIEW", step);
        assert.equal(proof.reviewDisposition, "TIMELY", step);
        return proof;
      }

      async function confirmReceipt(charge: Charge, proof: Proof, step: string) {
        assert.equal(charge.state, "PROOF_REVIEW", step);
        assert.equal(charge.paidMinor, 0, step);
        const chargePath = `/admin/charges/${charge.id}`;
        const receipt: components["schemas"]["ReceiptCommand"] = {
          externalReference: `synthetic-bridge-${randomUUID()}`,
          amountMinor: charge.expectedMinor,
          receivedAt: proof.receivedAt,
          expectedVersion: charge.version,
          proofId: proof.id,
          postingMode: "NORMAL",
        };
        const receiptHeaders = writeHeaders();
        const postReceipt = () => request("POST", chargePath + "/receipts", receipt, receiptHeaders, admin);
        const paid = await expectJson<Charge>(await postReceipt(), 200, `${step} merchant receipt`);
        assert.equal(paid.id, charge.id, step);
        assert.equal(paid.state, "PAID", step);
        assert.equal(paid.paidMinor, charge.expectedMinor, step);
        assert.equal(paid.outstandingMinor, 0, step);
        assert.deepEqual(await expectJson<Charge>(await postReceipt(), 200, `${step} receipt replay`), paid, step);
        const review = await expectJson<ChargeReview>(
          await request("GET", chargePath, undefined, undefined, admin), 200, `${step} merchant charge review`,
        );
        assert.deepEqual(review.recentReceipts.map((entry) => entry.amountMinor), [charge.expectedMinor], step);
        assert.deepEqual(review.proofs.map(({ id, state }) => ({ id, state })), [{ id: proof.id, state: "ACCEPTED" }], step);
      }

      const orderPath = `/orders/${order.id}`;
      const readOrder = async () => expectJson<Order>(await request("GET", orderPath, undefined), 200, "Read the customer pickup order");
      assert.equal(order.fulfilment, "PICKUP");
      assert.equal(order.paymentMethod, "DUITNOW");
      assert.equal(order.charge?.category, "STANDARD");
      assert.equal(order.charge.expectedMinor, 450);
      assert.equal(order.charge.state, "OPEN");
      const standardProof = await submitProof(order.charge, "Standard pickup");
      const proofContentPath = `/api/v1/admin/proofs/${standardProof.id}/content`;
      await expectStatus(await web(proofContentPath, { headers }), 403, "Deny customer access to merchant proof content");
      const proofContent = await web(proofContentPath, { headers: admin });
      await expectStatus(proofContent, 200, "Download merchant proof attachment");
      assert.equal(proofContent.headers.get("content-type"), "application/octet-stream");
      assert.equal(proofContent.headers.get("cache-control"), "private, no-store");
      assert.equal(proofContent.headers.get("content-disposition"), `attachment; filename="payment-proof-${standardProof.id}.png"`);
      assert.equal(proofContent.headers.get("x-content-type-options"), "nosniff");
      assert.ok(Buffer.from(await proofContent.arrayBuffer()).equals(png), "Merchant downloads the original synthetic proof bytes");
      const reviewingOrder = await readOrder();
      assert.equal(reviewingOrder.status, "PAYMENT_REVIEW");
      assert.equal(reviewingOrder.charge?.id, order.charge.id);
      await confirmReceipt(reviewingOrder.charge, standardProof, "Standard pickup");

      let currentOrder = await readOrder();
      assert.equal(currentOrder.status, "ACCEPTED");
      assert.equal(currentOrder.charge?.state, "PAID");
      const allocation = () => db.api.query("SELECT state FROM capacity_allocation WHERE order_id = $1", [order.id]);
      assert.deepEqual((await allocation()).rows, [{ state: "COMMITTED" }], "Receipt commits the pickup capacity hold");
      const actions = [
        ["START_PREPARATION", "PREPARING"], ["MARK_READY", "READY"],
        ["HANDOFF", "HANDED_OFF"], ["COMPLETE", "COMPLETED"],
      ] as const;
      for (const [action, status] of actions) {
        const body: operations["changeStandardOrder"]["requestBody"]["content"]["application/json"] = { action };
        const previousVersion = currentOrder.version;
        currentOrder = await expectJson<Order>(await request(
          "POST", `/admin${orderPath}/actions`, body, writeHeaders(previousVersion), admin,
        ), 200, `Standard pickup ${action}`);
        assert.equal(currentOrder.status, status, action);
        assert.ok(currentOrder.version > previousVersion, action);
      }
      const completed = await readOrder();
      assert.equal(completed.status, "COMPLETED");
      assert.ok(completed.readyAt && completed.handoffAt && Date.parse(completed.readyAt) <= Date.parse(completed.handoffAt));
      assert.deepEqual((await allocation()).rows, [{ state: "USED" }], "Pickup completion retains consumed production capacity");
      process.stdout.write("Standard DuitNow pickup passed proof review, private proof download, receipt replay, and fulfilment through completion.\n");

      const eventRequest: components["schemas"]["EventRequest"] = {
        eventDate: eventDay,
        startAt: eventDay + "T13:00:00+08:00",
        expectedEndAt: eventDay + "T15:00:00+08:00",
        setupReadyAt: eventDay + "T12:30:00+08:00",
        venue: { line1: "Synthetic event venue", city: "Test City", postcode: "00000", region: "Test Region" },
        guestCount: 25, budgetMinor: 12_000, occasion: "Celebration", theme: "Pink",
        specialRequirements: "Table setup and teardown", contactName: checkout.contactName, phone: checkout.phone,
      };
      const applied = await expectJson<Event>(await request("POST", "/events", eventRequest, writeHeaders()), 201, "Submit dessert-table request");
      assert.equal(applied.status, "APPLIED");
      assert.equal(applied.request.eventDate, eventDay);
      assert.equal(applied.quote, null);
      assert.deepEqual(applied.charges, []);
      const eventPath = `/events/${applied.id}`;
      const readEvent = async () => expectJson<Event>(await request("GET", eventPath, undefined), 200, "Read the customer dessert-table event");

      const quoteRequest: operations["issueEventQuote"]["requestBody"]["content"]["application/json"] = {
        totalMinor: 10_001,
        depositDueAt: new Date(now + dayMs).toISOString(),
        balanceDueAt: balanceDay + "T13:00:00+08:00",
        resourceWindow: { startAt: eventDay + "T12:00:00+08:00", endAt: eventDay + "T16:30:00+08:00" },
        packageSummary: "Dessert table for 25 guests",
        equipment: [{ name: "Cake stand", quantity: 3 }],
        extraChargeTerms: "Itemized extras require agreement.",
        termsVersion: terms.version,
        resourceAssessment: { staffCount: 2, notes: "Synthetic merchant-only assessment" },
        schedule: {
          eventStartAt: eventRequest.startAt, eventEndAt: eventRequest.expectedEndAt,
          setupReadyAt: eventRequest.setupReadyAt, teardownAt: eventDay + "T16:00:00+08:00",
        },
        serviceSummary: "Dessert delivery, setup and teardown",
      };
      const issued = await expectJson<Event>(await request(
        "POST", `/admin${eventPath}/quotes`, quoteRequest, writeHeaders(applied.version), admin,
      ), 200, "Issue the merchant dessert-table quote");
      assert.equal(issued.status, "QUOTED");
      const offered = await readEvent();
      assert.equal(offered.status, "QUOTED");
      const quote = offered.quote;
      assert.ok(quote, "The customer can read the offered quote");
      assert.equal(quote.status, "OFFERED");
      assert.deepEqual([quote.totalMinor, quote.depositMinor, quote.balanceMinor], [10_001, 5_001, 5_000]);
      assert.equal(quote.termsVersion, terms.version);
      assert.ok(quote.termsText.includes(terms.text));
      assert.ok(!("merchantPlan" in offered), "Customer quote excludes merchant planning details");
      const acceptance: operations["acceptEventQuote"]["requestBody"]["content"]["application/json"] = {
        quoteId: quote.id, quoteVersion: quote.version, termsVersion: quote.termsVersion,
      };
      const awaiting = await expectJson<Event>(await request(
        "POST", eventPath + "/accept-quote", acceptance, writeHeaders(offered.version),
      ), 200, "Accept the dessert-table quote");
      assert.equal(awaiting.status, "AWAITING_DEPOSIT");
      assert.equal(awaiting.quote?.status, "CUSTOMER_ACCEPTED");
      assert.equal(awaiting.charges.length, 1);
      const [deposit] = awaiting.charges;
      assert.equal(deposit.category, "EVENT_DEPOSIT");
      assert.equal(deposit.state, "OPEN");
      assert.equal(deposit.expectedMinor, 5_001);
      const eventProof = await submitProof(deposit, "Dessert-table deposit");
      const reviewingEvent = await readEvent();
      assert.equal(reviewingEvent.status, "DEPOSIT_REVIEW");
      const reviewingDeposit = reviewingEvent.charges.find(({ id }) => id === deposit.id);
      assert.ok(reviewingDeposit, "The event exposes its deposit under review");
      const chargePage = await web("/merchant/charges/" + deposit.id + "?" + new URLSearchParams({ event: applied.id }), { headers: admin });
      assert.equal(chargePage.status, 200, "Merchant can open the dessert-table deposit review");
      const chargePageHtml = await chargePage.text();
      assert.ok(chargePageHtml.includes("Review deposit") && chargePageHtml.includes("Verified receipts"),
        "Merchant deposit review renders the protected payment controls");
      await confirmReceipt(reviewingDeposit, eventProof, "Dessert-table deposit");

      const booked = await readEvent();
      assert.equal(booked.status, "BOOKED");
      assert.equal(booked.quote?.status, "CONFIRMED");
      assert.equal(booked.charges.length, 2);
      assert.equal(booked.charges.find(({ id }) => id === deposit.id)?.state, "PAID");
      const balance = booked.charges.find(({ category }) => category === "EVENT_BALANCE");
      assert.equal(balance?.state, "OPEN");
      assert.equal(balance.expectedMinor, 5_000);
      assert.equal(Date.parse(balance.dueAt ?? ""), Date.parse(quoteRequest.balanceDueAt));
      const resource = await db.api.query("SELECT status FROM resource_window WHERE quote_id = $1", [quote.id]);
      assert.deepEqual(resource.rows, [{ status: "BOOKED" }]);
      const eventPage = await web(eventPath, { headers });
      assert.equal(eventPage.status, 200);
      const invoicePath = "/api/v1" + eventPath + "/invoices/booking/pdf";
      const eventHtml = await eventPage.text();
      assert.ok(eventHtml.includes(invoicePath) && eventHtml.includes("Download ") && eventHtml.includes("booking invoice"),
        "The customer's event page renders an issued PDF download link");
      const invoice = await web(invoicePath, { headers });
      await expectStatus(invoice, 200, "Download the issued invoice through the web relay");
      assert.match(invoice.headers.get("content-disposition") ?? "", /^attachment; filename="GD-INV-\d+\.pdf"$/);
      assert.equal(invoice.headers.get("content-type"), "application/pdf");
      assert.equal(Buffer.from(await invoice.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
      await expectStatus(await web(invoicePath), 401, "Reject an unauthenticated PDF download");
      process.stdout.write("Dessert-table event passed request, merchant quote, customer acceptance, deposit review, receipt replay, and booking with an open balance.\n");

      const loggedOut = await request("POST", "/session/logout", undefined);
      await expectStatus(loggedOut, 204, "Log out the migrated customer session");
      assert.match(loggedOut.headers.get("set-cookie") ?? "", /Max-Age=0/);
      await expectStatus(await web("/api/v1/session", { headers }), 401, "Reject the revoked customer session");
      await expectProtectedRedirect(await web("/cart", { headers }), "/login", [
        "Bridge chocolate tart", "Review checkout", variant,
      ], "Redirect the logged-out customer away from their cart");
    }
    await Promise.race([journey(), apiExited, workerExited, webExited]);
    process.stdout.write("FastAPI web bridge passed both journeys and customer logout.\n");
  } finally {
    for (const child of children) child.kill("SIGTERM");
    await Promise.allSettled(exits);
    await db.close();
  }
}

verifyBridge().catch((error) => {
  process.stderr.write(String(error) + "\n");
  process.exitCode = 1;
});
