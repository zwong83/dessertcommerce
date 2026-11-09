from datetime import datetime, timedelta
from uuid import UUID, uuid4

from ..db import one
from ..settlement.domain import ACTIVE_CHARGE
from ..worker import infrastructure as store
from .application import BALANCE_STATES, DEPOSIT_STATES, finish_unbooked, notice, payment_cutoff, set_event_status

EVENT_WORK_KINDS = ("EVENT_QUOTE_EXPIRY", "EVENT_BALANCE_DUE")


def _payload(work):
    payload = work["payload"]
    if work["payload_version"] != 1 or not isinstance(payload, dict):
        return None
    expiry = work["kind"] == "EVENT_QUOTE_EXPIRY"
    try:
        deadline = datetime.fromisoformat(payload["deadline"])
        target = UUID(payload["quoteId" if expiry else "chargeId"])
    except (KeyError, ValueError, TypeError, AttributeError):
        return None
    if deadline.tzinfo is None:
        return None
    if not expiry and (type(payload.get("revision")) is not int or payload["revision"] < 1
                       or payload.get("phase") not in ("DUE", "CUTOFF")):
        return None
    return deadline, target


def _complete(conn, claim, result):
    store.settle_work(conn, claim, "SUCCEEDED")
    return result


def _expiry(conn, claim, event, quote_id, expected):
    quote = one(conn, """
        SELECT id, status, deposit_due_at FROM event_quote WHERE event_id = %s AND id = %s
    """, (event["id"], quote_id))
    if quote is None or quote["deposit_due_at"] != expected:
        return _complete(conn, claim, "obsolete")
    charge = None
    if event["status"] in DEPOSIT_STATES and quote["status"] == "CUSTOMER_ACCEPTED":
        charge = one(conn, """
            SELECT id, state, version FROM charge WHERE event_id = %s AND quote_id = %s
              AND category = 'EVENT_DEPOSIT' FOR UPDATE
        """, (event["id"], quote_id))
        if charge is None or charge["state"] not in ACTIVE_CHARGE:
            return _complete(conn, claim, "obsolete")
    elif event["status"] != "QUOTED" or quote["status"] != "OFFERED":
        return _complete(conn, claim, "obsolete")

    now = one(conn, "SELECT clock_timestamp() AS now")["now"]
    if now < expected:
        store.defer_work(conn, claim, expected)
        return "deferred"
    if charge is not None and store.timely_review_exists(conn, charge["id"], expected, None):
        store.defer_work(conn, claim, now + timedelta(minutes=15))
        return "preserved"

    finish_unbooked(conn, event, quote, charge, "EXPIRED", now)
    _audit(conn, claim, event, "EVENT_QUOTE_EXPIRED", now)
    return _complete(conn, claim, "expired")


def _audit(conn, claim, event, action, now):
    conn.execute("""
        INSERT INTO audit_event (id, feature, resource_id, action, occurred_at, request_id)
        VALUES (%s,'EVENT',%s,%s,%s,%s)
    """, (uuid4(), event["id"], action, now, str(claim.id)))


def _balance(conn, claim, event, charge_id, expected, payload):
    if event["status"] not in BALANCE_STATES or event["balance_deadline_revision"] != payload["revision"]:
        return _complete(conn, claim, "obsolete")
    charge = one(conn, """
        SELECT id, state, category FROM charge WHERE id = %s AND event_id = %s AND category = 'EVENT_BALANCE'
        FOR UPDATE
    """, (charge_id, event["id"]))
    if charge is None or charge["state"] not in ACTIVE_CHARGE:
        return _complete(conn, claim, "obsolete")

    cutoff = payment_cutoff(event, charge)
    due = event["effective_balance_due_at"]
    cutoff_work = payload["phase"] == "CUTOFF"
    active_at = cutoff if cutoff_work else due
    if active_at is None or active_at != expected or (not cutoff_work and due == cutoff):
        return _complete(conn, claim, "obsolete")
    now = one(conn, "SELECT clock_timestamp() AS now")["now"]
    if now < active_at:
        store.defer_work(conn, claim, active_at)
        return "deferred"
    if not cutoff_work and now >= cutoff:
        return _complete(conn, claim, "obsolete")
    if store.timely_review_exists(conn, charge["id"], cutoff, None):
        if cutoff_work:
            store.defer_work(conn, claim, now + timedelta(minutes=15))
            return "preserved"
        return _complete(conn, claim, "preserved")

    if event["status"] == "BOOKED":
        set_event_status(conn, event, "BALANCE_GRACE", now)
    revision = payload["revision"]
    data = {"chargeId": str(charge_id), "deadline": active_at.isoformat(), "cutoff": cutoff.isoformat(),
            "revision": revision, "phase": payload["phase"]}
    milestone = "EVENT_BALANCE_OVERDUE" if cutoff_work else "EVENT_BALANCE_DUE"
    notice(conn, event, milestone, revision, now, data)
    if cutoff_work:
        notice(conn, event, "MERCHANT_EVENT_BALANCE_FOLLOWUP", revision, now, data, role="ADMIN")
        _audit(conn, claim, event, "EVENT_BALANCE_OVERDUE", now)
    return _complete(conn, claim, "flagged" if cutoff_work else "reminded")


def apply_event_work(conn, claim, work):
    """Process an event work row already locked by the shared lease fence."""
    parsed = _payload(work)
    if parsed is None:
        store.settle_work(conn, claim, "DEAD", "INVALID_EVENT_WORK_PAYLOAD")
        return "invalid"
    expected, target = parsed
    event = one(conn, """
        SELECT id, status, effective_balance_due_at, effective_balance_grace_ends_at, balance_deadline_revision
        FROM event_application WHERE id = %s FOR UPDATE
    """, (work["resource_id"],))
    if event is None:
        return _complete(conn, claim, "obsolete")
    if work["kind"] == "EVENT_QUOTE_EXPIRY":
        return _expiry(conn, claim, event, target, expected)
    return _balance(conn, claim, event, target, expected, work["payload"])
