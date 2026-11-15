import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { applyExpiry, claimExpiry, pollExpiry } from "./legacy-backend/worker/expiry";
import { startTestPostgres } from "./postgres-harness";

test("proof expiry workers enforce the current lease and preserve timely reviews", async (context) => {
  const db = await startTestPostgres();
  context.after(() => db.close());
  const account = randomUUID();
  const product = randomUUID();
  const date = "2030-01-01";
  const now = new Date();
  const cutoff = new Date(now.getTime() - 30_000);
  await db.api.query("INSERT INTO account (id,role,phone_e164) VALUES ($1,'CUSTOMER',$2)", [account, "+60000000003"]);
  await db.api.query("INSERT INTO product (id,name,category,status) VALUES ($1,'Sample','Sample','LISTED')", [product]);
  await db.api.query("INSERT INTO capacity_day (service_date,closed,max_units,allocated_units) VALUES ($1,false,10,2)", [date]);

  async function seed(pendingProof: boolean) {
    const order = randomUUID();
    const review = randomUUID();
    const charge = randomUUID();
    const work = randomUUID();
    await db.api.query(
      "INSERT INTO checkout_review (id,account_id,cart_version,review_digest,terms_version,review_snapshot,expires_at,updated_at) VALUES ($1,$2,1,$3,'1','{}',$4,$4)",
      [review, account, Buffer.alloc(32), cutoff],
    );
    await db.api.query(
      `INSERT INTO standard_order (id,order_number,account_id,checkout_review_id,status,fulfilment,payment_method,service_date,
         requested_handoff_at,fulfilment_snapshot,subtotal_minor,fee_minor,terms_version,proof_due_at,created_at,updated_at)
       VALUES ($1,$1::uuid::text,$2,$3,$4,'PICKUP','DUITNOW',$5,$6,'{}',450,0,'1',$7,$7,$7)`,
      [order, account, review, pendingProof ? "PAYMENT_REVIEW" : "PENDING_PROOF", date, "2030-01-01T04:00:00Z", cutoff],
    );
    await db.api.query(
      "INSERT INTO charge (id,order_id,category,state,expected_minor,due_at,created_at) VALUES ($1,$2,'STANDARD',$3,450,$4,$4)",
      [charge, order, pendingProof ? "PROOF_REVIEW" : "OPEN", cutoff],
    );
    await db.api.query(
      "INSERT INTO capacity_allocation (order_id,service_date,product_id,quantity,state,generation) VALUES ($1,$2,$3,1,'HELD',1)",
      [order, date, product],
    );
    if (pendingProof) {
      await db.api.query(
        `INSERT INTO payment_proof (id,charge_id,object_key,content_digest,byte_count,media_type,state,review_disposition,received_at)
         VALUES ($1,$2,$3,$4,8,'image/png','REVIEW','TIMELY',$5)`,
        [randomUUID(), charge, randomUUID(), Buffer.alloc(32), new Date(cutoff.getTime() - 1)],
      );
    }
    await db.api.query(
      `INSERT INTO durable_work (id,event_key,kind,resource_id,work_state,not_before,payload,created_at)
       VALUES ($1,$1::uuid::text,'STANDARD_PROOF_EXPIRY',$2,'READY',$3,$4,$3)`,
      [work, order, cutoff, { deadline: cutoff.toISOString(), chargeId: charge }],
    );
    return { order, work };
  }

  const due = await seed(false);
  const firstLease = await claimExpiry(db.worker);
  assert.equal(firstLease?.id, due.work);
  await db.worker.query("UPDATE durable_work SET lease_until = clock_timestamp() - interval '1 second' WHERE id = $1", [due.work]);
  const newLease = await claimExpiry(db.worker);
  assert.equal(newLease?.id, due.work);
  assert.notEqual(newLease?.token, firstLease?.token);
  assert.equal(await applyExpiry(db.worker, firstLease!), "stale-lease");
  assert.equal(await applyExpiry(db.worker, newLease!), "expired");
  assert.equal(await applyExpiry(db.worker, newLease!), "stale-lease");
  assert.equal((await db.api.query("SELECT status FROM standard_order WHERE id = $1", [due.order])).rows[0].status, "EXPIRED");

  const waiting = await seed(true);
  const outcomes = await Promise.all([pollExpiry(db.worker), pollExpiry(db.worker)]);
  assert.deepEqual(outcomes.filter(Boolean), ["preserved"]);
  assert.equal((await db.api.query("SELECT status FROM standard_order WHERE id = $1", [waiting.order])).rows[0].status, "PAYMENT_REVIEW");
  assert.equal((await db.api.query("SELECT allocated_units FROM capacity_day WHERE service_date = $1", [date])).rows[0].allocated_units, 1);
  assert.equal((await db.api.query("SELECT count(*)::int AS count FROM audit_event WHERE action = 'PROOF_EXPIRED'")).rows[0].count, 1);
});
