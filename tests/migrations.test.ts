import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { QueryResultRow } from "pg";
import { type Queryable, withTransaction } from "../frontend/server/db";
import { migrate } from "../frontend/server/db/migrate";
import { startTestPostgres } from "./postgres-harness";

const expectedTables = [
  "account", "audit_event", "capacity_allocation", "capacity_day", "capacity_product_limit",
  "cart", "cart_line", "charge", "checkout_review", "command_receipt", "delivery_fee_offer",
  "durable_work", "full_refund_obligation", "money_entry", "notice_attempt", "notice_followup",
  "operating_policy", "order_recovery_agreement", "otp_challenge", "payment_proof", "product",
  "product_gallery", "product_media", "refund_intent", "schema_migration", "session",
  "settlement_case", "standard_order", "standard_order_line", "variant",
].sort();

const readOrder = `
  SELECT o.order_number, o.status, o.total_minor, a.quantity, a.state AS allocation_state,
         m.amount_minor AS receipt_minor, f.amount_minor AS refund_due_minor, r.status AS refund_state,
         p.object_key, c.top_up_outstanding_minor, w.work_state
  FROM standard_order o
  JOIN charge c ON c.order_id = o.id
  JOIN capacity_allocation a ON a.order_id = o.id
  JOIN money_entry m ON m.charge_id = c.id AND m.kind = 'RECEIPT'
  JOIN full_refund_obligation f ON f.receipt_id = m.id
  JOIN refund_intent r ON r.receipt_id = m.id
  JOIN payment_proof p ON p.charge_id = c.id
  JOIN durable_work w ON w.resource_id = c.id AND w.kind = 'STANDARD_TOP_UP_EXPIRY'
  WHERE o.id = $1
`;

async function seed(tx: Queryable, now: Date) {
  const customer = randomUUID();
  const admin = randomUUID();
  const product = randomUUID();
  const review = randomUUID();
  const order = randomUUID();
  const charge = randomUUID();
  const proof = randomUUID();
  const receipt = randomUUID();
  const refund = randomUUID();
  const work = randomUUID();
  const notice = randomUUID();
  const challenge = randomUUID();
  const day = "2030-01-02";
  const due = new Date(now.getTime() + 30 * 60 * 1_000);
  const proofKey = "private/synthetic-proof";
  const digest = Buffer.from("synthetic-digest");
  const cipher = Buffer.from("synthetic-cipher");
  await tx.query(`
    INSERT INTO account (id, role, phone_e164, recovery_email)
    VALUES ($1, 'CUSTOMER', '+60100000001', NULL), ($2, 'ADMIN', NULL, 'merchant@example.invalid')
  `, [customer, admin]);
  await tx.query(`
    INSERT INTO otp_challenge
      (id, role, destination_fingerprint, verifier, customer_destination_cipher, created_at, expires_at)
    VALUES ($1, 'CUSTOMER', $2, $2, $3, $4, $4::timestamptz + interval '5 minutes')
  `, [challenge, digest, cipher, now]);
  await tx.query("INSERT INTO product (id, name, status) VALUES ($1, 'Synthetic dessert', 'LISTED')", [product]);
  await tx.query(`
    INSERT INTO checkout_review
      (id, account_id, cart_version, review_digest, terms_version, review_snapshot, expires_at, status, consumed_at, updated_at)
    VALUES ($1, $2, 1, $3, 'v1', '{}', $4, 'SUBMITTED', $5, $5)
  `, [review, customer, digest, due, now]);
  await tx.query(`
    INSERT INTO standard_order
      (id, order_number, account_id, checkout_review_id, status, fulfilment, payment_method,
       service_date, requested_handoff_at, fulfilment_snapshot, subtotal_minor, fee_minor, terms_version, created_at, updated_at)
    VALUES ($1, 'SYN-1', $2, $3, 'PAYMENT_REVIEW', 'PICKUP', 'DUITNOW',
            $4, $4::date + time '08:00', '{}', 1200, 0, 'v1', $5, $5)
  `, [order, customer, review, day, now]);
  await tx.query(`
    INSERT INTO capacity_day (service_date, closed, max_units, allocated_units) VALUES ($1, false, 3, 2)
  `, [day]);
  await tx.query(`
    INSERT INTO capacity_allocation (order_id, service_date, product_id, quantity, state, generation)
    VALUES ($1, $2, $3, 2, 'HELD', 1)
  `, [order, day, product]);
  await tx.query(`
    INSERT INTO charge
      (id, order_id, category, state, expected_minor, created_at, top_up_requested_at, top_up_due_at, top_up_outstanding_minor)
    VALUES ($1, $2, 'STANDARD', 'PROOF_REVIEW', 1200, $3, $3, $4, 400)
  `, [charge, order, now, due]);
  await tx.query(`
    INSERT INTO payment_proof
      (id, charge_id, object_key, content_digest, byte_count, media_type, state, review_disposition, received_at)
    VALUES ($1, $2, $3, $4, 1, 'image/png', 'REVIEW', 'TIMELY', $5)
  `, [proof, charge, proofKey, digest, now]);
  await tx.query(`
    INSERT INTO money_entry (id, charge_id, kind, rail, external_reference, amount_minor, occurred_at, actor_id)
    VALUES ($1, $2, 'RECEIPT', 'DUITNOW', 'synthetic-bank-ref', 800, $3, $4)
  `, [receipt, charge, now, admin]);
  await tx.query(`
    INSERT INTO full_refund_obligation (receipt_id, amount_minor, reason, recorded_at, actor_id)
    VALUES ($1, 800, 'MERCHANT_UNABLE', $2, $3)
  `, [receipt, now, admin]);
  await tx.query(`
    INSERT INTO refund_intent (id, receipt_id, amount_minor, status, requested_by, reason, created_at, updated_at)
    VALUES ($1, $2, 200, 'UNCERTAIN', $3, 'Synthetic reconciliation', $4, $4)
  `, [refund, receipt, admin, now]);
  await tx.query(`
    INSERT INTO durable_work (id, event_key, kind, resource_id, work_state, not_before, created_at, payload)
    VALUES ($1, 'synthetic-expiry', 'STANDARD_TOP_UP_EXPIRY', $3, 'READY', $4, $5, '{}'),
           ($2, 'synthetic-notice', 'NOTICE', $3, 'READY', $5, $5, '{"outstandingMinor":400}')
  `, [work, notice, charge, due, now]);
  await tx.query(`
    INSERT INTO audit_event (id, actor_id, feature, resource_id, action, occurred_at, request_id)
    VALUES ($1, $2, 'settlement', $3, 'verify_receipt', $4, 'synthetic-request')
  `, [randomUUID(), admin, charge, now]);
  return { admin, product, order, charge, receipt, refund, notice, challenge, day, proofKey, digest, cipher };
}

test("SC-68 standard-ordering migration on PostgreSQL 16", async (t) => {
  const db = await startTestPostgres({ applyMigrations: false });
  t.after(db.close);
  const { migration, api, worker, server, storage, clock } = db;
  const now = clock.now();
  t.diagnostic(`Server version ${server.version}, listener ${server.listen}, no Unix sockets`);

  // Fail after DDL and before writing the journal, using the real database transaction.
  await assert.rejects(migrate({
    async connect() {
      const client = await migration.connect();
      return {
        async query<Row extends QueryResultRow>(sql: string, values?: unknown[]) {
          if (sql.startsWith("INSERT INTO schema_migration")) throw new Error("synthetic journal failure");
          return client.query<Row>(sql, values);
        },
        release: (destroy?: boolean) => client.release(destroy),
      };
    },
  }), /synthetic journal failure/);
  const interrupted = await migration.query("SELECT to_regnamespace('sweetcommerce') AS schema");
  assert.deepEqual(interrupted.rows, [{ schema: null }]);
  const concurrent = await Promise.all([migrate(migration), migrate(migration)]);
  assert.deepEqual(concurrent.flat(), [1]);

  await t.test("bootstraps once under concurrent runners and verifies the increment 1 shape", async () => {
    assert.deepEqual(await migrate(migration), []);
    const history = await migration.query("SELECT version, length(sha256) AS digest_length FROM schema_migration");
    assert.deepEqual(history.rows, [{ version: 1, digest_length: 64 }]);
    const tables = await migration.query("SELECT tablename FROM pg_tables WHERE schemaname = 'sweetcommerce'");
    assert.deepEqual(tables.rows.map(({ tablename }) => tablename).sort(), expectedTables);
    const columns = await migration.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'sweetcommerce' AND table_name = 'charge'");
    const names = new Set(columns.rows.map(({ column_name }) => column_name));
    for (const column of ["event_id", "quote_id", "bill_snapshot"]) assert.equal(names.has(column), false);
  });

  const ids = await withTransaction(api, (tx) => seed(tx, now));
  await storage.put(ids.proofKey, Buffer.from([1]));

  await t.test("enforces stable keys, OTP binding, standard modes, and financial/work constraints", async () => {
    const binding = await api.query("SELECT customer_destination_cipher FROM otp_challenge WHERE id = $1", [ids.challenge]);
    assert.equal(binding.rows[0].customer_destination_cipher.equals(ids.cipher), true);
    await assert.rejects(api.query("UPDATE otp_challenge SET customer_destination_cipher = NULL WHERE id = $1", [ids.challenge]), { code: "23514" });
    await api.query("UPDATE otp_challenge SET used_at = $2, customer_destination_cipher = NULL WHERE id = $1", [ids.challenge, now]);
    await assert.rejects(api.query("INSERT INTO account (id, role, phone_e164) VALUES ($1, 'CUSTOMER', '+60100000001')", [randomUUID()]), { code: "23505" });
    await assert.rejects(api.query("INSERT INTO account (id, role, recovery_email) VALUES ($1, 'ADMIN', 'other@example.invalid')", [randomUUID()]), { code: "23505" });

    await assert.rejects(api.query(`
      INSERT INTO standard_order
        (id, order_number, account_id, checkout_review_id, status, fulfilment, payment_method,
         service_date, requested_handoff_at, fulfilment_snapshot, subtotal_minor, fee_minor, terms_version, created_at, updated_at)
      SELECT $1, 'SYN-2', account_id, checkout_review_id, status, fulfilment, payment_method,
             service_date, requested_handoff_at, fulfilment_snapshot, subtotal_minor, fee_minor, terms_version, created_at, updated_at
      FROM standard_order WHERE id = $2
    `, [randomUUID(), ids.order]), { code: "23505" });
    await assert.rejects(api.query("UPDATE standard_order SET fulfilment = 'MERCHANT_LALAMOVE', payment_method = 'CASH' WHERE id = $1", [ids.order]), { code: "23514" });
    await assert.rejects(api.query("UPDATE capacity_day SET allocated_units = 4 WHERE service_date = $1", [ids.day]), { code: "23514" });
    await assert.rejects(api.query(`
      INSERT INTO capacity_allocation (order_id, service_date, product_id, quantity, state, generation)
      VALUES ($1, $2, $3, 1, 'COMMITTED', 2)
    `, [ids.order, ids.day, ids.product]), { code: "23505" });
    await assert.rejects(api.query(`
      INSERT INTO charge (id, order_id, category, state, expected_minor, created_at)
      VALUES ($1, $2, 'STANDARD', 'OPEN', 100, $3)
    `, [randomUUID(), randomUUID(), now]), { code: "23503" });
    await assert.rejects(api.query("UPDATE charge SET category = 'EVENT_DEPOSIT' WHERE id = $1", [ids.charge]), { code: "23514" });
    await assert.rejects(api.query("UPDATE charge SET top_up_due_at = $2 WHERE id = $1", [ids.charge, now]), { code: "23514" });
    await assert.rejects(api.query("UPDATE charge SET top_up_outstanding_minor = NULL WHERE id = $1", [ids.charge]), { code: "23514" });
    await assert.rejects(api.query(`
      INSERT INTO payment_proof
        (id, charge_id, object_key, content_digest, byte_count, media_type, state, review_disposition, received_at)
      VALUES ($1, $2, 'private/synthetic-duplicate', $3, 1, 'image/png', 'REVIEW', 'TIMELY', $4)
    `, [randomUUID(), ids.charge, ids.digest, now]), { code: "23505" });
    await assert.rejects(api.query(`
      INSERT INTO money_entry (id, charge_id, kind, rail, external_reference, amount_minor, occurred_at, actor_id)
      VALUES ($1, $2, 'RECEIPT', 'DUITNOW', 'synthetic-bank-ref', 800, $3, $4)
    `, [randomUUID(), ids.charge, now, ids.admin]), { code: "23505" });
    await assert.rejects(api.query(`
      INSERT INTO full_refund_obligation (receipt_id, amount_minor, reason, recorded_at, actor_id)
      VALUES ($1, 800, 'MERCHANT_UNABLE', $2, $3)
    `, [ids.receipt, now, ids.admin]), { code: "23505" });
    await assert.rejects(api.query("UPDATE refund_intent SET status = 'POSTED' WHERE id = $1", [ids.refund]), { code: "23514" });
    await assert.rejects(api.query("UPDATE refund_intent SET refund_entry_id = $2 WHERE id = $1", [ids.refund, ids.receipt]), { code: "23514" });
    for (const [kind, sqlState] of [["EVENT_BALANCE_DUE", "23514"], ["STANDARD_PROOF_EXPIRY", "23505"]]) {
      await assert.rejects(api.query(`
        INSERT INTO durable_work (id, event_key, kind, resource_id, work_state, not_before, created_at)
        VALUES ($1, 'synthetic-expiry', $2, $3, 'READY', $4, $4)
      `, [randomUUID(), kind, ids.charge, now]), { code: sqlState });
    }
  });

  await t.test("separates migration, API and worker grants and preserves append-only records", async () => {
    const roles = await migration.query(`
      SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls,
             pg_has_role(rolname, 'sweetcommerce_migration', 'MEMBER') AS migration_member
      FROM pg_roles WHERE rolname IN ('sweetcommerce_api', 'sweetcommerce_worker') ORDER BY rolname
    `);
    assert.deepEqual(roles.rows, ["sweetcommerce_api", "sweetcommerce_worker"].map((rolname) => ({
      rolname, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false,
      rolbypassrls: false, migration_member: false,
    })));

    for (const runtime of [api, worker]) {
      await assert.rejects(runtime.query("SELECT * FROM schema_migration"), { code: "42501" });
      await assert.rejects(runtime.query("CREATE TABLE sweetcommerce.forbidden (id integer)"), { code: "42501" });
      await assert.rejects(runtime.query("CREATE TEMP TABLE forbidden (id integer)"), { code: "42501" });
      await assert.rejects(runtime.query("SET ROLE sweetcommerce_migration"), { code: "42501" });
      for (const table of ["money_entry", "audit_event", "full_refund_obligation", "command_receipt"]) {
        await assert.rejects(runtime.query(`DELETE FROM ${table}`), { code: "42501" });
        await assert.rejects(runtime.query(`TRUNCATE ${table}`), { code: "42501" });
      }
      await assert.rejects(runtime.query("UPDATE money_entry SET amount_minor = 1"), { code: "42501" });
      await assert.rejects(runtime.query("UPDATE audit_event SET request_id = 'forbidden'"), { code: "42501" });
    }
    await assert.rejects(migrate(api), /require PostgreSQL 16 and the sweetcommerce_migration role/);
    await assert.rejects(api.query("UPDATE durable_work SET work_state = 'DEAD'"), { code: "42501" });
    await assert.rejects(api.query("UPDATE payment_proof SET object_key = 'forbidden'"), { code: "42501" });
    for (const table of ["account", "otp_challenge", "session", "money_entry", "refund_intent"]) {
      await assert.rejects(worker.query(`SELECT * FROM ${table}`), { code: "42501" });
    }
    await assert.rejects(worker.query("SELECT object_key FROM payment_proof"), { code: "42501" });
    await assert.rejects(worker.query("SELECT fulfilment_snapshot FROM standard_order"), { code: "42501" });
    await assert.rejects(worker.query("INSERT INTO money_entry DEFAULT VALUES"), { code: "42501" });
    await assert.rejects(worker.query("INSERT INTO audit_event (actor_id) VALUES ($1)", [ids.admin]), { code: "42501" });
    await assert.rejects(worker.query("UPDATE durable_work SET payload = '{}'"), { code: "42501" });

    const lease = randomUUID();
    await withTransaction(worker, async (tx) => {
      const claimed = await tx.query("SELECT id FROM durable_work WHERE id = $1 FOR UPDATE SKIP LOCKED", [ids.notice]);
      assert.equal(claimed.rowCount, 1);
      await tx.query("UPDATE durable_work SET work_state = 'LEASED', lease_token = $2, lease_until = $3 WHERE id = $1", [
        ids.notice, lease, now,
      ]);
      const parent = await tx.query("SELECT id, status FROM standard_order WHERE id = $1 FOR UPDATE", [ids.order]);
      assert.equal(parent.rows[0].status, "PAYMENT_REVIEW");
      const charge = await tx.query("SELECT id, state FROM charge WHERE id = $1 FOR UPDATE", [ids.charge]);
      assert.equal(charge.rows[0].state, "PROOF_REVIEW");
      await tx.query(`
        INSERT INTO notice_attempt (work_id, attempt_no, attempted_at, channel, outcome)
        VALUES ($1, 1, $2, 'SYNTHETIC', 'UNKNOWN')
      `, [ids.notice, now]);
      await tx.query(`
        INSERT INTO audit_event (id, feature, resource_id, action, occurred_at, request_id)
        VALUES ($1, 'work', $2, 'synthetic_attempt', $3, 'synthetic-worker')
      `, [randomUUID(), ids.notice, now]);
    });
    const attempt = await api.query("SELECT outcome FROM notice_attempt WHERE work_id = $1", [ids.notice]);
    assert.deepEqual(attempt.rows, [{ outcome: "UNKNOWN" }]);
  });

  await t.test("serializes receipt locks without granting ledger updates", async () => {
    const lock = "SELECT sweetcommerce.lock_receipt($1, $2) AS id";
    const args = [ids.charge, ids.receipt];
    await assert.rejects(worker.query(lock, args), { code: "42501" });
    const unrelated = await api.query(lock, [randomUUID(), ids.receipt]);
    assert.deepEqual(unrelated.rows, [{ id: null }]);

    await withTransaction(api, async (tx) => {
      const receipt = await tx.query(lock, args);
      assert.deepEqual(receipt.rows, [{ id: ids.receipt }]);
      await assert.rejects(withTransaction(api, async (other) => {
        await other.query("SET LOCAL lock_timeout = '100ms'");
        await other.query(lock, args);
      }), { code: "55P03" });
    });
    const released = await api.query(lock, args);
    assert.deepEqual(released.rows, [{ id: ids.receipt }]);
  });

  await t.test("rolls back failed transactions, including a caught database error", async () => {
    await assert.rejects(withTransaction(api, async (tx) => {
      await tx.query("UPDATE standard_order SET status = 'CANCELLED' WHERE id = $1", [ids.order]);
      throw new Error("synthetic failure");
    }), /synthetic failure/);

    await assert.rejects(withTransaction(api, async (tx) => {
      await tx.query("UPDATE standard_order SET status = 'CANCELLED' WHERE id = $1", [ids.order]);
      await assert.rejects(tx.query("SELECT 1 / 0"), { code: "22012" });
    }), /did not commit/);

    const order = await api.query("SELECT status FROM standard_order WHERE id = $1", [ids.order]);
    assert.deepEqual(order.rows, [{ status: "PAYMENT_REVIEW" }]);
  });

  await t.test("earlier app reader survives an additive schema change and app rollback", async () => {
    const earlier = await api.query(readOrder, [ids.order]);
    assert.deepEqual(earlier.rows, [{
      order_number: "SYN-1", status: "PAYMENT_REVIEW", total_minor: "1200", quantity: 2,
      allocation_state: "HELD", receipt_minor: "800", refund_due_minor: "800", refund_state: "UNCERTAIN",
      object_key: ids.proofKey, top_up_outstanding_minor: "400", work_state: "READY",
    }]);
    // Rehearsal-only additive change, with no second migration in the shipped manifest.
    await migration.query("ALTER TABLE standard_order ADD COLUMN app_upgrade_probe text");
    const upgraded = await api.query("SELECT app_upgrade_probe FROM standard_order WHERE id = $1", [ids.order]);
    assert.deepEqual(upgraded.rows, [{ app_upgrade_probe: null }]);
    await api.query("UPDATE standard_order SET app_upgrade_probe = 'new-app' WHERE id = $1", [ids.order]);

    const rolledBackApp = await api.query(readOrder, [ids.order]);
    assert.deepEqual(rolledBackApp.rows, earlier.rows);
    assert.deepEqual(await storage.read(rolledBackApp.rows[0].object_key), Buffer.from([1]));
    assert.deepEqual(await migrate(migration), []);
  });

  await t.test("fails closed on altered migration history", async () => {
    await migration.query("UPDATE schema_migration SET sha256 = 'synthetic-mismatch' WHERE version = 1");
    await assert.rejects(migrate(migration), /Migration history differs at version 1/);
    const preserved = await api.query(readOrder, [ids.order]);
    assert.equal(preserved.rowCount, 1);
  });
});
