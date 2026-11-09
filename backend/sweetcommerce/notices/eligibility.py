from ..db import one
from ..eventsettlement.application import _collectible, payment_cutoff
from ..settlement.domain import ACTIVE_CHARGE, ACTIVE_ORDER
from ..worker.infrastructure import timely_review_exists
from . import infrastructure as store
from .domain import identifier, instant

_QUOTE_NOTICES = ("EVENT_QUOTE_ISSUED", "EVENT_QUOTE_EXPIRY_REMINDER")
_BALANCE_NOTICES = ("EVENT_BALANCE_DUE", "EVENT_BALANCE_OVERDUE", "MERCHANT_EVENT_BALANCE_FOLLOWUP")


def _same_deadline(expected, actual):
    if expected is None or actual is None:
        return False
    # Some producers serialize the deadline at millisecond precision.
    return expected == actual or expected == actual.replace(microsecond=actual.microsecond // 1000 * 1000)


def _quote_current(conn, event, name, data, now):
    quote = one(conn, """
        SELECT id,status,deposit_due_at FROM event_quote WHERE event_id=%s AND id=%s
    """, (event["id"], identifier(data.get("quoteId"))))
    if quote is None or now >= quote["deposit_due_at"]:
        return False
    if name == "EVENT_QUOTE_ISSUED":
        return event["status"] == "QUOTED" and quote["status"] == "OFFERED"
    if not _same_deadline(instant(data.get("deadline")), quote["deposit_due_at"]):
        return False
    if event["status"] == "QUOTED":
        return quote["status"] == "OFFERED"
    if event["status"] not in ("AWAITING_DEPOSIT", "DEPOSIT_REVIEW") or quote["status"] != "CUSTOMER_ACCEPTED":
        return False
    charge = one(conn, """
        SELECT id,state FROM charge WHERE event_id=%s AND quote_id=%s AND category='EVENT_DEPOSIT'
    """, (event["id"], quote["id"]))
    return (charge is not None and charge["state"] in ACTIVE_CHARGE
            and not timely_review_exists(conn, charge["id"], quote["deposit_due_at"], None))


def _current_amount(conn, work, data, charge):
    requested = data.get("outstandingMinor")
    if type(requested) is not int or requested <= 0:
        return None
    facts = store.payment_facts(conn, work, charge["id"])
    if facts and requested == facts["outstanding_minor"] and requested < facts["expected_minor"]:
        return facts
    return None


def _top_up_current(conn, work, data):
    order = one(conn, "SELECT status FROM standard_order WHERE id=%s FOR SHARE", (work["resource_id"],))
    if order is None or order["status"] not in ACTIVE_ORDER:
        return False
    charge = one(conn, """
        SELECT id,state,top_up_due_at,top_up_requested_at FROM charge
        WHERE order_id=%s AND id=%s AND category='STANDARD' FOR SHARE
    """, (work["resource_id"], identifier(data.get("chargeId"))))
    if charge is None or charge["state"] not in ACTIVE_CHARGE:
        return False
    cutoff = charge["top_up_due_at"]
    now = one(conn, "SELECT clock_timestamp() AS now")["now"]
    return (_same_deadline(instant(data.get("deadline")), cutoff) and now < cutoff
            and not timely_review_exists(conn, charge["id"], cutoff, charge["top_up_requested_at"])
            and one(conn, "SELECT 1 FROM capacity_allocation WHERE order_id=%s AND state='HELD' LIMIT 1",
                    (work["resource_id"],)) is not None
            and _current_amount(conn, work, data, charge) is not None)


def _event_payment_current(conn, work, event, name, data, now):
    charge = one(conn, """
        SELECT id,quote_id,category,state,due_at FROM charge WHERE event_id=%s AND id=%s FOR SHARE
    """, (event["id"], identifier(data.get("chargeId"))))
    if charge is None or not _collectible(conn, event, charge):
        return False
    cutoff = payment_cutoff(event, charge)
    if cutoff is None:
        return False
    balance = charge["category"] == "EVENT_BALANCE"
    revision = event["balance_deadline_revision"] if balance else 1
    if type(data.get("revision")) is not int or data["revision"] != revision:
        return False
    if timely_review_exists(conn, charge["id"], cutoff, None):
        return False
    expected = instant(data.get("deadline"))
    if name == "EVENT_SUPPLEMENT_REQUESTED":
        if (charge["category"] not in ("EVENT_DEPOSIT", "EVENT_BALANCE") or now >= cutoff
                or not _same_deadline(expected, cutoff)):
            return False
        case_id = identifier(data.get("caseId"))
        facts = _current_amount(conn, work, data, charge) if case_id else None
        return facts is not None and facts["case_id"] == case_id
    if not balance or not _same_deadline(instant(data.get("cutoff")), cutoff):
        return False
    if data.get("phase") == "DUE":
        due = event["effective_balance_due_at"]
        return _same_deadline(expected, due) and due <= now < cutoff
    return data.get("phase") == "CUTOFF" and _same_deadline(expected, cutoff) and now >= cutoff


def current(conn, work, name, data):
    if name == "STANDARD_TOP_UP":
        return _top_up_current(conn, work, data)
    if name not in (*_QUOTE_NOTICES, *_BALANCE_NOTICES, "EVENT_SUPPLEMENT_REQUESTED"):
        return True
    event = one(conn, """
        SELECT id,status,effective_balance_due_at,effective_balance_grace_ends_at,balance_deadline_revision
        FROM event_application WHERE id=%s FOR SHARE
    """, (work["resource_id"],))
    if event is None:
        return False
    now = one(conn, "SELECT clock_timestamp() AS now")["now"]
    if name in _QUOTE_NOTICES:
        return _quote_current(conn, event, name, data, now)
    return _event_payment_current(conn, work, event, name, data, now)
