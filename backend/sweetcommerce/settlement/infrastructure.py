from datetime import datetime
from uuid import uuid4

from psycopg.types.json import Jsonb

from ..capacity.order import bump_capacity_impact, release_capacity
from ..clock import iso
from ..db import one, rows
from ..order.infrastructure import missing
from ..work.queue import enqueue_work as enqueue_work
from ..work.queue import milestone
from .domain import ACTIVE_CHARGE, ACTIVE_ORDER, TOP_UP_WINDOW, charge_view, invalid_transition


def lock_charge(conn, charge_id):
    link = one(conn, "SELECT * FROM charge WHERE id = %s", (charge_id,))
    if link is None:
        raise missing()
    if link.get("event_id") is not None:
        order = one(conn, "SELECT * FROM event_application WHERE id = %s FOR UPDATE", (link["event_id"],))
    else:
        order = one(conn, "SELECT * FROM standard_order WHERE id = %s FOR UPDATE", (link["order_id"],))
    charge = one(conn, "SELECT * FROM charge WHERE id = %s FOR UPDATE", (charge_id,))
    if order is None or charge is None:
        raise missing()
    return order, charge


def proof_record(conn, charge_id, proof_id, *, lock=False):
    query = "SELECT * FROM payment_proof WHERE id = %s AND charge_id = %s"
    proof = one(conn, query + (" FOR UPDATE" if lock else ""), (proof_id, charge_id))
    if proof is None:
        raise missing()
    return proof


def case_record(conn, charge_id, case_id, *, lock=False):
    query = "SELECT * FROM settlement_case WHERE id = %s AND charge_id = %s"
    case = one(conn, query + (" FOR UPDATE" if lock else ""), (case_id, charge_id))
    if case is None:
        raise missing()
    return case


def add_case(conn, charge_id, kind, now, *, proof_id=None, notes=None):
    return one(conn, """
        INSERT INTO settlement_case (id, charge_id, proof_id, kind, status, notes, opened_at)
        VALUES (%s,%s,%s,%s,'OPEN',%s,%s) RETURNING *
    """, (uuid4(), charge_id, proof_id, kind, notes, now))


def ensure_case(conn, charge_id, kind, now, *, proof_id=None, notes=None):
    found = one(conn, """
        SELECT * FROM settlement_case
        WHERE charge_id = %s AND kind = %s AND status = 'OPEN'
          AND (kind = 'AMOUNT_MISMATCH' OR proof_id IS NOT DISTINCT FROM %s::uuid)
        ORDER BY opened_at LIMIT 1
    """, (charge_id, kind, proof_id))
    return found or add_case(conn, charge_id, kind, now, proof_id=proof_id, notes=notes)


def money_totals(conn, charge_id):
    from ..refunds.infrastructure import money_totals as refund_totals

    return refund_totals(conn, charge_id)


def pending_timely_proof(conn, charge, *, proof_id=None, cutoff=None):
    due = cutoff or charge["top_up_due_at"] or charge["due_at"]
    if due is None:
        return False
    return one(conn, """
        SELECT EXISTS(SELECT 1 FROM payment_proof WHERE charge_id = %(charge)s
          AND state = 'REVIEW' AND review_disposition = 'TIMELY' AND received_at < %(due)s
          AND (%(since)s::timestamptz IS NULL OR received_at >= %(since)s)
          AND (%(proof)s::uuid IS NULL OR id = %(proof)s)) AS pending
    """, {"charge": charge["id"], "due": due, "since": charge["top_up_requested_at"], "proof": proof_id})["pending"]


def project_charge(conn, charge, now, *, qr_url=None, admin=False, event=None):
    cutoff = None
    if charge.get("event_id") is not None and charge["category"] == "EVENT_BALANCE":
        if event is None:
            event = one(conn, """SELECT effective_balance_due_at, effective_balance_grace_ends_at
                FROM event_application WHERE id = %s""", (charge["event_id"],))
        if event:
            cutoff = event["effective_balance_grace_ends_at"] or event["effective_balance_due_at"]
    return charge_view(
        charge, money_totals(conn, charge["id"]), now, pending=pending_timely_proof(conn, charge, cutoff=cutoff),
        qr_url=qr_url, admin=admin, cutoff=cutoff,
    )


def append_receipt(conn, charge_id, actor, details, now, case_id=None):
    row = one(conn, """
        INSERT INTO money_entry
            (id,charge_id,kind,rail,external_reference,amount_minor,occurred_at,actor_id,reason,settlement_case_id,recorded_at)
        VALUES (%s,%s,'RECEIPT','DUITNOW',%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (rail,kind,external_reference) DO NOTHING RETURNING id
    """, (uuid4(), charge_id, details["externalReference"], details["amountMinor"],
          details["receivedAt"], actor, details.get("reason"), case_id, now))
    if row is None:
        raise invalid_transition("That bank movement has already been recorded.")


def update_charge(conn, charge_id, state):
    return one(conn, "UPDATE charge SET state = %s, version = version + 1 WHERE id = %s RETURNING *", (state, charge_id))


def update_order(conn, order, state, now):
    conn.execute(
        "UPDATE standard_order SET status = %s, version = version + 1, updated_at = %s WHERE id = %s",
        (state, now, order["id"]),
    )
    bump_capacity_impact(conn, [order["service_date"]])


def expire_if_unprotected(conn, order, charge, now: datetime):
    due = charge["top_up_due_at"] or charge["due_at"]
    if (
        charge["category"] == "STANDARD" and order["status"] in ACTIVE_ORDER and charge["state"] in ACTIVE_CHARGE
        and due is not None and now >= due and not pending_timely_proof(conn, charge)
    ):
        release_capacity(conn, order["id"], order["service_date"])
        milestone(conn, order["id"], "STANDARD_EXPIRED", charge["id"], now)
        update_order(conn, order, "EXPIRED", now)
        return update_charge(conn, charge["id"], "EXPIRED")
    return charge


def record_review(conn, proof, actor, state, now):
    return one(conn, """
        UPDATE payment_proof SET state = %s, reviewed_at = %s, reviewed_by = %s
        WHERE id = %s AND state = 'REVIEW' RETURNING *
    """, (state, now, actor, proof["id"]))


def issue_top_up(conn, order, charge, outstanding, now, customer_reason):
    issued_at = now
    due = issued_at + TOP_UP_WINDOW
    charge = one(conn, """
        UPDATE charge SET top_up_requested_at = %s, top_up_due_at = %s, top_up_outstanding_minor = %s,
            state = 'DISPUTED', version = version + 1 WHERE id = %s RETURNING *
    """, (issued_at, due, outstanding, charge["id"]))
    resource = order["id"]
    enqueue_work(conn, f"STANDARD_TOP_UP_EXPIRY:{resource}:1", "STANDARD_TOP_UP_EXPIRY", resource, due, issued_at,
                 {"deadline": due.isoformat(), "chargeId": str(charge["id"])})
    enqueue_work(conn, f"STANDARD_TOP_UP_NOTICE:{resource}:1", "NOTICE", resource, issued_at, issued_at,
                 {"milestone": "STANDARD_TOP_UP", "chargeId": str(charge["id"]), "deadline": iso(due),
                  "outstandingMinor": outstanding, "customerMessage": customer_reason})
    return charge


def record_audit(conn, actor, resource, action, context, change):
    conn.execute("""
        INSERT INTO audit_event (id,actor_id,feature,resource_id,action,occurred_at,request_id,safe_change)
        VALUES (%s,%s,'SETTLEMENT',%s,%s,clock_timestamp(),%s,%s)
    """, (uuid4(), actor, resource, action, context.request_id, Jsonb(change)))
