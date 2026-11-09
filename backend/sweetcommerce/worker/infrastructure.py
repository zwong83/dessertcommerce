from datetime import datetime
from uuid import uuid4

from ..db import one
from ..work.queue import milestone
from .domain import Claim


def claim_work(conn) -> Claim | None:
    token = uuid4()
    work = one(
        conn,
        """WITH candidate AS (
             SELECT id FROM durable_work
              WHERE kind IN ('STANDARD_PROOF_EXPIRY','STANDARD_TOP_UP_EXPIRY','EVENT_QUOTE_EXPIRY','EVENT_BALANCE_DUE')
                AND ((work_state = 'READY' AND not_before <= clock_timestamp())
                  OR (work_state = 'LEASED' AND lease_until <= clock_timestamp()))
              ORDER BY not_before, id FOR UPDATE SKIP LOCKED LIMIT 1
           )
           UPDATE durable_work AS work SET work_state = 'LEASED', lease_token = %s,
             lease_until = clock_timestamp() + interval '30 seconds', attempt_count = attempt_count + 1
           FROM candidate WHERE work.id = candidate.id
           RETURNING work.id, work.resource_id, work.kind, work.payload_version, work.payload""",
        (token,),
    )
    return Claim(**work, token=token) if work is not None else None


def lock_work(conn, claim: Claim) -> dict | None:
    return one(
        conn,
        """SELECT id, resource_id, kind, payload_version, payload FROM durable_work
            WHERE id = %s AND lease_token = %s AND work_state = 'LEASED' AND lease_until > clock_timestamp()
              FOR UPDATE""",
        (claim.id, claim.token),
    )


def settle_work(conn, claim: Claim, state: str, reason: str | None = None) -> None:
    conn.execute(
        """UPDATE durable_work SET work_state = %s, lease_token = NULL, lease_until = NULL, last_safe_error = %s
            WHERE id = %s AND lease_token = %s""",
        (state, reason, claim.id, claim.token),
    )


def defer_work(conn, claim: Claim, deadline: datetime) -> None:
    conn.execute(
        """UPDATE durable_work SET work_state = 'READY', not_before = %s, lease_until = NULL, lease_token = NULL
            WHERE id = %s AND lease_token = %s""",
        (deadline, claim.id, claim.token),
    )


def lock_order_and_charge(conn, resource_id) -> tuple[dict | None, dict | None]:
    order = one(
        conn,
        "SELECT id, status, service_date::text AS date, proof_due_at FROM standard_order WHERE id = %s FOR UPDATE",
        (resource_id,),
    )
    charge = one(
        conn,
        """SELECT id, state, due_at, top_up_requested_at, top_up_due_at
             FROM charge WHERE order_id = %s AND category = 'STANDARD' FOR UPDATE""",
        (resource_id,),
    )
    return order, charge


def deadline_reached(conn, deadline: datetime) -> bool:
    return one(conn, "SELECT clock_timestamp() >= %s::timestamptz AS due", (deadline,))["due"]


def timely_review_exists(conn, charge_id, deadline: datetime, window_start: datetime | None) -> bool:
    return one(
        conn,
        """SELECT EXISTS (SELECT 1 FROM payment_proof
            WHERE charge_id = %s AND state = 'REVIEW' AND review_disposition = 'TIMELY'
              AND received_at < %s AND (%s::timestamptz IS NULL OR received_at >= %s::timestamptz)) AS pending""",
        (charge_id, deadline, window_start, window_start),
    )["pending"]


def record_expiry(conn, claim: Claim, order: dict, charge: dict, released: int) -> None:
    now = one(conn, "SELECT clock_timestamp() AS now")["now"]
    milestone(conn, order["id"], "STANDARD_EXPIRED", charge["id"], now)
    if not released:
        conn.execute("UPDATE capacity_day SET version = version + 1 WHERE service_date = %s", (order["date"],))
    conn.execute(
        """UPDATE standard_order SET status = 'EXPIRED', version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s""",
        (order["id"],),
    )
    conn.execute("UPDATE charge SET state = 'EXPIRED', version = version + 1 WHERE id = %s", (charge["id"],))
    conn.execute(
        """INSERT INTO audit_event (id, feature, resource_id, action, occurred_at, request_id)
           VALUES (%s,'settlement',%s,'PROOF_EXPIRED',clock_timestamp(),%s)""",
        (uuid4(), order["id"], str(claim.id)),
    )
