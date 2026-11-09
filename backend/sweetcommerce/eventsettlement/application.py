from datetime import timedelta
from uuid import uuid4

from ..capacity.infrastructure import lock_capacity_dates
from ..db import one
from ..events.domain import local_day
from ..problems import Problem, validation
from ..settlement import infrastructure as store
from ..settlement.domain import ACTIVE_CHARGE, invalid_transition, proof_view
from ..worker.infrastructure import timely_review_exists

DEPOSIT_STATES = ("AWAITING_DEPOSIT", "DEPOSIT_REVIEW")
BALANCE_STATES = ("BOOKED", "BALANCE_GRACE")
GRACE = timedelta(hours=24)


def payment_cutoff(event, charge):
    if charge["category"] == "EVENT_BALANCE":
        return event["effective_balance_grace_ends_at"] or event["effective_balance_due_at"]
    return charge["due_at"]


def deposit_quote(conn, event, charge):
    return one(conn, """
        SELECT id, status, deposit_due_at, balance_due_at, balance_minor,
               event_start_at, event_end_at, setup_ready_at
        FROM event_quote WHERE id = %s AND event_id = %s
    """, (charge["quote_id"], event["id"]))


def _collectible(conn, event, charge):
    if charge["state"] not in ACTIVE_CHARGE:
        return False
    category = charge["category"]
    if category == "EVENT_DEPOSIT" and event["status"] in DEPOSIT_STATES:
        return one(conn, """
            SELECT 1 FROM event_quote q JOIN resource_window w ON w.quote_id = q.id
            WHERE q.id = %s AND q.event_id = %s AND q.status = 'CUSTOMER_ACCEPTED' AND w.status = 'HELD'
        """, (charge["quote_id"], event["id"])) is not None
    if category == "EVENT_BALANCE":
        return (
            event["status"] in BALANCE_STATES and payment_cutoff(event, charge) is not None
            and one(conn, "SELECT 1 FROM event_quote WHERE id = %s AND event_id = %s AND status = 'CONFIRMED'",
                    (charge["quote_id"], event["id"])) is not None
        )
    return category == "EVENT_EXTRA" and event["status"] == "ADDITIONAL_BILL"


def proof_disposition(conn, event, charge, now):
    cutoff = payment_cutoff(event, charge)
    if cutoff is not None and now < cutoff and _collectible(conn, event, charge):
        return "TIMELY"
    return "RECONCILIATION_ONLY"


def set_event_status(conn, event, state, now):
    conn.execute("""
        UPDATE event_application SET status = %s, version = version + 1, updated_at = %s WHERE id = %s
    """, (state, now, event["id"]))


def mark_proof_review(conn, event, charge, now):
    """Called only after registration of a new timely proof."""
    if charge["state"] == "OPEN":
        store.update_charge(conn, charge["id"], "PROOF_REVIEW")
    else:
        conn.execute("UPDATE charge SET version = version + 1 WHERE id = %s", (charge["id"],))
    if charge["category"] == "EVENT_DEPOSIT" and event["status"] == "AWAITING_DEPOSIT":
        set_event_status(conn, event, "DEPOSIT_REVIEW", now)


def _lock_held_window_dates(conn, quote_id):
    from ..events.infrastructure import resource_dates

    window = one(conn, """
        SELECT starts_at, ends_at FROM resource_window WHERE quote_id = %s AND status = 'HELD'
    """, (quote_id,))
    if window is None:
        return []
    days = list(resource_dates(window["starts_at"], window["ends_at"]))
    lock_capacity_dates(conn, days)
    return days


def _change_held_window(conn, quote_id, state, *, days=None):
    if days is None:
        days = _lock_held_window_dates(conn, quote_id)
    if not days:
        return False
    changed = conn.execute("""
        UPDATE resource_window SET status = %s WHERE quote_id = %s AND status = 'HELD'
    """, (state, quote_id)).rowcount
    if changed:
        conn.execute("UPDATE capacity_day SET version = version + 1 WHERE service_date = ANY(%s::date[])", (days,))
    return bool(changed)


def finish_unbooked(conn, event, quote, charge, state, now):
    """Transition the current unused quote. Caller holds the parent and any deposit charge locks."""
    _change_held_window(conn, quote["id"], "RELEASED")
    conn.execute("UPDATE event_quote SET status = %s WHERE id = %s", (state, quote["id"]))
    set_event_status(conn, event, state, now)
    if charge is not None:
        conn.execute("UPDATE charge SET state = %s, version = version + 1 WHERE id = %s", (state, charge["id"]))
        return {**charge, "state": state, "version": charge["version"] + 1}
    return None


def expire_if_unprotected(conn, event, charge, now):
    if (charge["category"] != "EVENT_DEPOSIT" or charge["state"] not in ACTIVE_CHARGE
            or event["status"] not in DEPOSIT_STATES):
        return charge
    quote = deposit_quote(conn, event, charge)
    if (quote is None or quote["status"] != "CUSTOMER_ACCEPTED" or now < quote["deposit_due_at"]
            or timely_review_exists(conn, charge["id"], quote["deposit_due_at"], None)):
        return charge
    return finish_unbooked(conn, event, quote, charge, "EXPIRED", now)


def reject_deposit(conn, event, charge, admin, now, reason, context):
    if charge["category"] != "EVENT_DEPOSIT" or not _collectible(conn, event, charge):
        raise invalid_transition("There is no active deposit to reject.")
    quote = deposit_quote(conn, event, charge)
    if now >= quote["deposit_due_at"] and not timely_review_exists(conn, charge["id"], quote["deposit_due_at"], None):
        raise invalid_transition("The deposit review window has ended.")
    money = store.money_totals(conn, charge["id"])
    if money["paid"] > money["refunded"]:
        store.ensure_case(conn, charge["id"], "TRANSFER_UNMATCHED", now, notes=reason)
    charge = finish_unbooked(conn, event, quote, charge, "CANCELLED", now)
    conn.execute("UPDATE event_application SET disposition_reason = %s WHERE id = %s", (reason, event["id"]))
    store.record_audit(conn, admin, event["id"], "DEPOSIT_REJECTED", context, {"state": "CANCELLED"})
    notice(conn, event, "EVENT_CANCELLED", charge["id"], now, {"chargeId": str(charge["id"])})
    return charge


def resolve_infeasible_deposit(conn, event, charge, admin, now, reason, context):
    """Guard case closure after a verified refund. Reschedule closes its case in Event."""
    if charge["category"] != "EVENT_DEPOSIT" or event["status"] not in ("EXCEPTION", "CANCELLED"):
        raise invalid_transition("Complete the agreed event disposition before resolving this case.")
    money = one(conn, """
        SELECT COUNT(*) FILTER (WHERE c.id = %(charge)s AND m.kind = 'RECEIPT') AS deposit_receipts,
            COALESCE(SUM(CASE WHEN m.kind = 'RECEIPT' THEN m.amount_minor ELSE -m.amount_minor END), 0) AS net
        FROM money_entry m JOIN charge c ON c.id = m.charge_id WHERE c.event_id = %(event)s
    """, {"charge": charge["id"], "event": event["id"]})
    if not money["deposit_receipts"] or money["net"] != 0:
        raise invalid_transition("Verify the refund of all event funds before resolving this case.")
    if event["status"] == "CANCELLED":
        return
    quote = deposit_quote(conn, event, charge)
    if quote is None or quote["status"] != "CUSTOMER_ACCEPTED":
        raise invalid_transition("Refresh the event before resolving this case.")
    finish_unbooked(conn, event, quote, None, "CANCELLED", now)
    conn.execute("UPDATE event_application SET disposition_reason = %s WHERE id = %s", (reason, event["id"]))
    conn.execute("""
        UPDATE charge SET state = 'CANCELLED', version = version + 1
        WHERE event_id = %s AND state IN ('OPEN','PROOF_REVIEW','DISPUTED')
    """, (event["id"],))
    store.record_audit(conn, admin, event["id"], "INFEASIBLE_DEPOSIT_REFUNDED", context, {"state": "CANCELLED"})
    notice(conn, event, "EVENT_CANCELLED", charge["id"], now, {"chargeId": str(charge["id"])})


def notice(conn, event, milestone, source, now, data, *, role="CUSTOMER"):
    event_id = event["id"]
    store.enqueue_work(conn, f"{milestone}:{event_id}:{source}:{role}", "NOTICE", event_id, now, now,
                       {"milestone": milestone, "eventId": str(event_id), "recipientRole": role, **data})


def enqueue_balance_work(conn, event, now):
    due = event["effective_balance_due_at"]
    if due is None:
        return
    charge = one(conn, """
        SELECT id FROM charge WHERE event_id = %s AND category = 'EVENT_BALANCE'
            AND state IN ('OPEN','PROOF_REVIEW','DISPUTED')
    """, (event["id"],))
    if charge is None:
        return
    cutoff = event["effective_balance_grace_ends_at"] or due
    revision = event["balance_deadline_revision"]
    jobs = [("CUTOFF", cutoff)]
    if due < cutoff:
        jobs.insert(0, ("DUE", due))
    for phase, at in jobs:
        store.enqueue_work(conn, f"EVENT_BALANCE_DUE:{event['id']}:{revision}:{phase}", "EVENT_BALANCE_DUE",
                           event["id"], at, now, {"chargeId": str(charge["id"]), "deadline": at.isoformat(),
                                                "revision": revision, "phase": phase})


def request_supplement(conn, event, charge, proof, admin, now, customer_reason, context):
    cutoff = payment_cutoff(event, charge)
    money = store.money_totals(conn, charge["id"])
    net = money["paid"] - money["refunded"]
    outstanding = charge["expected_minor"] - net
    if (charge["category"] not in ("EVENT_DEPOSIT", "EVENT_BALANCE") or not _collectible(conn, event, charge)
            or cutoff is None or now >= cutoff or not 0 < outstanding < charge["expected_minor"]
            or _eligible_net(conn, charge["id"]) != net):
        raise invalid_transition("A verified shortfall within the existing payment window is required.")
    case = one(conn, """
        SELECT id FROM settlement_case WHERE charge_id = %s AND kind = 'AMOUNT_MISMATCH' AND status = 'OPEN'
    """, (charge["id"],))
    if case is None:
        raise invalid_transition("Select a verified shortfall in an open settlement case.")
    revision = event["balance_deadline_revision"] if charge["category"] == "EVENT_BALANCE" else 1
    source = f"{case['id']}:{revision}:{outstanding}"
    notice(conn, event, "EVENT_SUPPLEMENT_REQUESTED", source, now,
           {"chargeId": str(charge["id"]), "caseId": str(case["id"]), "revision": revision,
            "deadline": cutoff.isoformat(), "outstandingMinor": outstanding, "customerReason": customer_reason})
    store.record_audit(conn, admin, charge["id"], "EVENT_SUPPLEMENT_REQUESTED", context,
                       {"caseId": str(case["id"]), "outstandingMinor": outstanding})
    return proof_view(proof)


def _eligible_net(conn, charge_id):
    return one(conn, """
        SELECT COALESCE(SUM(m.amount_minor - COALESCE((
            SELECT SUM(amount_minor) FROM refund_intent WHERE receipt_id = m.id AND status = 'POSTED'
        ), 0)), 0) AS net
        FROM money_entry m JOIN event_eligible_receipt e ON e.receipt_id = m.id
        WHERE m.charge_id = %s
    """, (charge_id,))["net"]


def _link_eligible_receipt(conn, charge_id, proof_id, external_reference):
    linked = conn.execute("""
        INSERT INTO event_eligible_receipt (receipt_id, proof_id)
        SELECT m.id, p.id FROM money_entry m JOIN payment_proof p ON p.charge_id = m.charge_id
        WHERE p.id = %s AND m.charge_id = %s AND m.rail = 'DUITNOW'
            AND m.kind = 'RECEIPT' AND m.external_reference = %s
    """, (proof_id, charge_id, external_reference))
    if linked.rowcount != 1:
        raise RuntimeError("Could not link the verified event receipt to its proof")


def _deposit_plan(conn, event, charge, details, now):
    quote = deposit_quote(conn, event, charge)
    late = now > quote["balance_due_at"]
    decision = details.get("lateDepositDecision")
    if late and decision is None:
        raise Problem("DEPOSIT_DISPOSITION_REQUIRED", 409, "Choose a disposition for the late deposit verification.")
    if not late:
        return quote, quote["balance_due_at"], quote["balance_due_at"] + GRACE, None
    if decision["disposition"] == "RESCHEDULE_OR_REFUND":
        return quote, None, None, decision
    if now >= quote["event_start_at"]:
        raise invalid_transition("The quoted event start has passed. Choose reschedule or refund.")
    return quote, now + GRACE, None, decision


def _confirm_deposit(conn, event, charge, plan, proof, now, days):
    quote, due, grace, decision = plan
    balance_id = uuid4()
    conn.execute("""
        INSERT INTO charge (id, event_id, quote_id, category, state, expected_minor, due_at, created_at)
        VALUES (%s,%s,%s,'EVENT_BALANCE','OPEN',%s,%s,%s)
    """, (balance_id, event["id"], quote["id"], quote["balance_minor"], due, now))
    notice(conn, event, "EVENT_DEPOSIT_VERIFIED", charge["id"], now, {"chargeId": str(charge["id"])})
    if due is None:
        store.ensure_case(conn, charge["id"], "EVENT_FULFILMENT_INFEASIBLE", now,
                          proof_id=proof["id"], notes=decision["reason"])
        set_event_status(conn, event, "EXCEPTION", now)
        return

    if not _change_held_window(conn, quote["id"], "BOOKED", days=days):
        raise invalid_transition("The quote no longer has a held resource window.")
    conn.execute("UPDATE event_quote SET status = 'CONFIRMED' WHERE id = %s", (quote["id"],))
    effective = one(conn, """
        UPDATE event_application SET status = 'BOOKED', booked_at = COALESCE(booked_at, %s),
            event_date = %s, start_at = %s, expected_end_at = %s, setup_ready_at = %s,
            effective_balance_due_at = %s, effective_balance_grace_ends_at = %s,
            balance_deadline_revision = balance_deadline_revision + %s, version = version + 1, updated_at = %s
        WHERE id = %s RETURNING *
    """, (now, local_day(quote["event_start_at"]), quote["event_start_at"], quote["event_end_at"],
          quote["setup_ready_at"], due, grace, int(decision is not None), now, event["id"]))
    enqueue_balance_work(conn, effective, now)
    notice(conn, event, "EVENT_BOOKING_CONFIRMED", quote["id"], now, {"quoteId": str(quote["id"])})
    notice(conn, event, "EVENT_ARRANGEMENTS", quote["id"], now, {"quoteId": str(quote["id"])})


def _complete_extra(conn, event, charge, now):
    incomplete = one(conn, """
        SELECT EXISTS(SELECT 1 FROM equipment_check WHERE event_id = %s AND checked_at IS NULL) AS equipment,
               EXISTS(SELECT 1 FROM charge WHERE event_id = %s AND category = 'EVENT_EXTRA'
                       AND state <> 'PAID') AS charges
    """, (event["id"], event["id"]))
    notice(conn, event, "EVENT_EXTRA_VERIFIED", charge["id"], now, {"chargeId": str(charge["id"])})
    if event["actual_teardown_at"] is not None and not incomplete["equipment"] and not incomplete["charges"]:
        set_event_status(conn, event, "COMPLETED", now)
        notice(conn, event, "EVENT_COMPLETED", event["id"], now, {})


def confirm_receipt(conn, event, charge, admin, details, now, context, *, clock=None):
    """Handle a scoped, version-checked event receipt inside the shared command transaction."""
    charge_id = charge["id"]
    proof = store.proof_record(conn, charge_id, details["proofId"], lock=True) if "proofId" in details else None
    case = store.case_record(conn, charge_id, details["settlementCaseId"], lock=True) if "settlementCaseId" in details else None
    mode = details["postingMode"]
    cutoff = payment_cutoff(event, charge)
    if proof is not None and proof["state"] != "REVIEW":
        raise invalid_transition("Refresh the proof before posting a movement.")
    if case is not None and case["status"] != "OPEN":
        raise invalid_transition("Refresh the settlement case.")
    if mode == "SUPPLEMENT" and (charge["category"] not in ("EVENT_DEPOSIT", "EVENT_BALANCE")
                                  or case is None or case["kind"] != "AMOUNT_MISMATCH"):
        raise invalid_transition("Select the open event shortfall case.")
    if "lateDepositDecision" in details and charge["category"] != "EVENT_DEPOSIT":
        raise validation("A late deposit disposition belongs to an event deposit.")

    eligible = (mode != "RECONCILIATION" and _collectible(conn, event, charge) and cutoff is not None
                and proof is not None and proof["review_disposition"] == "TIMELY" and proof["received_at"] < cutoff)
    if mode == "NORMAL" and charge["state"] not in ACTIVE_CHARGE:
        raise invalid_transition("Use reconciliation for funds received outside the active charge.")
    money = store.money_totals(conn, charge_id)
    current_net = money["paid"] - money["refunded"]
    net = current_net + details["amountMinor"]
    expected = charge["expected_minor"]
    if eligible and mode == "NORMAL" and current_net > 0 and charge["category"] != "EVENT_EXTRA":
        raise invalid_transition("Post additional funds against the open event shortfall case.")
    if eligible and mode == "SUPPLEMENT" and not 0 < current_net < expected:
        raise invalid_transition("The charge no longer has a verified shortfall.")
    exact = eligible and net == expected and _eligible_net(conn, charge_id) + details["amountMinor"] == expected
    plan = None
    days = None
    if exact and charge["category"] == "EVENT_DEPOSIT":
        days = _lock_held_window_dates(conn, charge["quote_id"])
        if clock is not None:
            now = clock(conn)
        plan = _deposit_plan(conn, event, charge, details, now)
        if plan[3] is not None:
            details = {**details, "reason": plan[3]["reason"]}

    if eligible and not exact and case is None:
        case = store.ensure_case(conn, charge_id, "AMOUNT_MISMATCH", now, proof_id=proof["id"])
    if not eligible and case is None:
        kind = "LATE_PROOF" if cutoff is not None and now >= cutoff else "TRANSFER_UNMATCHED"
        case = store.ensure_case(conn, charge_id, kind, now, proof_id=proof["id"] if proof else None)
    store.append_receipt(conn, charge_id, admin, details, now, case["id"] if case else None)
    if event["status"] == "CANCELLED" and one(conn, """
        SELECT 1 FROM audit_event WHERE resource_id = %s AND feature = 'EVENT'
          AND action = 'CANCEL' AND reason_code = 'MERCHANT_UNABLE' LIMIT 1
    """, (event["id"],)):
        from ..refunds.infrastructure import create_full_refund_obligations

        create_full_refund_obligations(conn, charge_id, admin, "MERCHANT_UNABLE")
    if proof is not None:
        store.record_review(conn, proof, admin, "ACCEPTED", now)
    if eligible:
        _link_eligible_receipt(conn, charge_id, proof["id"], details["externalReference"])
    if exact:
        charge = store.update_charge(conn, charge_id, "PAID")
        if plan is not None:
            _confirm_deposit(conn, event, charge, plan, proof, now, days)
        elif charge["category"] == "EVENT_BALANCE":
            set_event_status(conn, event, "PROCEEDING", now)
        else:
            _complete_extra(conn, event, charge, now)
        conn.execute("""
            UPDATE settlement_case SET status = 'RESOLVED', resolved_at = %s, resolved_by = %s
            WHERE charge_id = %s AND kind = 'AMOUNT_MISMATCH' AND status = 'OPEN'
        """, (now, admin, charge_id))
    elif charge["state"] in ACTIVE_CHARGE:
        charge = store.update_charge(conn, charge_id, "DISPUTED")
        charge = expire_if_unprotected(conn, event, charge, now)
    store.record_audit(conn, admin, charge_id, "RECEIPT_VERIFIED", context, {"state": charge["state"]})
    return store.project_charge(conn, charge, now, admin=True, event=event)
