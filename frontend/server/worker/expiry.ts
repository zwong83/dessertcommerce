import { randomUUID } from "node:crypto";
import { type Queryable, type TransactionPool, withTransaction } from "../db";
import { releaseCapacity } from "../capacity";

interface WorkRow {
  id: string;
  resource_id: string;
  kind: "STANDARD_PROOF_EXPIRY" | "STANDARD_TOP_UP_EXPIRY";
  payload_version: number;
  payload: { deadline?: string; chargeId?: string };
}

interface Claim extends WorkRow {
  token: string;
}

interface OrderRow {
  id: string;
  status: string;
  date: string;
  proof_due_at: Date | null;
}

interface ChargeRow {
  id: string;
  state: string;
  due_at: Date | null;
  top_up_requested_at: Date | null;
  top_up_due_at: Date | null;
}

export async function claimExpiry(pool: TransactionPool): Promise<Claim | null> {
  return withTransaction(pool, async (tx) => {
    const token = randomUUID();
    const { rows: [work] } = await tx.query<WorkRow>(
      `WITH candidate AS (
         SELECT id FROM durable_work
          WHERE kind IN ('STANDARD_PROOF_EXPIRY','STANDARD_TOP_UP_EXPIRY')
            AND ((work_state = 'READY' AND not_before <= clock_timestamp())
              OR (work_state = 'LEASED' AND lease_until <= clock_timestamp()))
          ORDER BY not_before, id FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE durable_work AS work SET work_state = 'LEASED', lease_token = $1,
         lease_until = clock_timestamp() + interval '30 seconds', attempt_count = attempt_count + 1
       FROM candidate WHERE work.id = candidate.id
       RETURNING work.id, work.resource_id, work.kind, work.payload_version, work.payload`,
      [token],
    );
    return work ? { ...work, token } : null;
  });
}

async function settleJob(tx: Queryable, claim: Claim, state: "SUCCEEDED" | "DEAD", reason?: string) {
  await tx.query(
    "UPDATE durable_work SET work_state = $3, lease_token = NULL, lease_until = NULL, last_safe_error = $4 WHERE id = $1 AND lease_token = $2",
    [claim.id, claim.token, state, reason ?? null],
  );
}

function deadlineFrom(payload: WorkRow["payload"]) {
  return typeof payload?.deadline === "string" ? Date.parse(payload.deadline) : NaN;
}

export async function applyExpiry(pool: TransactionPool, claim: Claim) {
  return withTransaction(pool, async (tx) => {
    const { rows: [work] } = await tx.query<WorkRow>(
      `SELECT id, resource_id, kind, payload_version, payload FROM durable_work
        WHERE id = $1 AND lease_token = $2 AND work_state = 'LEASED' AND lease_until > clock_timestamp() FOR UPDATE`,
      [claim.id, claim.token],
    );
    if (!work) return "stale-lease";
    const expected = deadlineFrom(work.payload);
    if (work.payload_version !== 1 || !Number.isFinite(expected)) {
      await settleJob(tx, claim, "DEAD", "INVALID_EXPIRY_PAYLOAD");
      return "invalid";
    }

    const { rows: [order] } = await tx.query<OrderRow>(
      "SELECT id, status, service_date::text AS date, proof_due_at FROM standard_order WHERE id = $1 FOR UPDATE",
      [work.resource_id],
    );
    const { rows: [charge] } = await tx.query<ChargeRow>(
      "SELECT id,state,due_at,top_up_requested_at,top_up_due_at FROM charge WHERE order_id = $1 AND category = 'STANDARD' FOR UPDATE",
      [work.resource_id],
    );
    const topUp = work.kind === "STANDARD_TOP_UP_EXPIRY";
    const deadline = topUp ? charge?.top_up_due_at : order?.proof_due_at;
    const activeOrder = order && ["PENDING_PROOF", "PAYMENT_REVIEW", "EXCEPTION"].includes(order.status);
    const activeCharge = charge && ["OPEN", "PROOF_REVIEW", "DISPUTED"].includes(charge.state);

    if (!order || !charge || !activeOrder || !activeCharge || !deadline || deadline.getTime() !== expected
        || (!topUp && (charge.top_up_due_at || charge.due_at?.getTime() !== expected))
        || (work.payload.chargeId && work.payload.chargeId !== charge.id)) {
      await settleJob(tx, claim, "SUCCEEDED");
      return "obsolete";
    }

    const { rows: [time] } = await tx.query<{ due: boolean }>(
      "SELECT clock_timestamp() >= $1::timestamptz AS due", [deadline],
    );
    if (!time.due) {
      await tx.query(
        "UPDATE durable_work SET work_state = 'READY', not_before = $3, lease_until = NULL, lease_token = NULL WHERE id = $1 AND lease_token = $2",
        [claim.id, claim.token, deadline],
      );
      return "deferred";
    }
    const { rows: [review] } = await tx.query<{ pending: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM payment_proof
        WHERE charge_id = $1 AND state = 'REVIEW' AND review_disposition = 'TIMELY'
          AND received_at < $2 AND ($3::timestamptz IS NULL OR received_at >= $3)) AS pending`,
      [charge.id, deadline, topUp ? charge.top_up_requested_at : null],
    );
    if (review.pending) {
      await settleJob(tx, claim, "SUCCEEDED");
      return "preserved";
    }

    const released = await releaseCapacity(tx, order.id, order.date);
    if (!released) {
      await tx.query("UPDATE capacity_day SET version = version + 1 WHERE service_date = $1", [order.date]);
    }
    await tx.query("UPDATE standard_order SET status = 'EXPIRED', version = version + 1, updated_at = clock_timestamp() WHERE id = $1", [order.id]);
    await tx.query("UPDATE charge SET state = 'EXPIRED', version = version + 1 WHERE id = $1", [charge.id]);
    await tx.query(
      `INSERT INTO audit_event (id, feature, resource_id, action, occurred_at, request_id)
       VALUES ($1,'settlement',$2,'PROOF_EXPIRED',clock_timestamp(),$3)`,
      [randomUUID(), order.id, claim.id],
    );
    await settleJob(tx, claim, "SUCCEEDED");
    return "expired";
  });
}

export async function pollExpiry(pool: TransactionPool) {
  const claim = await claimExpiry(pool);
  if (claim) return applyExpiry(pool, claim);
}
