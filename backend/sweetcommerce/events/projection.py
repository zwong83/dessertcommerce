from ..db import one, rows
from ..settlement import infrastructure as settlement
from . import infrastructure as store
from .domain import ACTIVE_EVENT, BOOKING_STATES, DAY, PRE_TRANSFER, wire


OUTCOMES = {
    "CANCELLED": "The event was cancelled.",
    "DECLINED": "The event request was declined.",
    "EXPIRED": "The event offer expired.",
    "EXCEPTION": "The merchant is reviewing your event arrangements or payment.",
}


def quote_schedule(quote):
    return {
        "eventStartAt": wire(quote["event_start_at"]), "eventEndAt": wire(quote["event_end_at"]),
        "setupReadyAt": wire(quote["setup_ready_at"]), "teardownAt": wire(quote["teardown_at"]),
    }


def quote_view(quote):
    snapshot = quote["quote_snapshot"]
    return {
        "id": str(quote["id"]), "version": quote["version"], "status": quote["status"],
        "totalMinor": quote["total_minor"], "depositMinor": quote["deposit_minor"], "balanceMinor": quote["balance_minor"],
        "issuedAt": wire(quote["issued_at"]), "depositDueAt": wire(quote["deposit_due_at"]),
        "balanceDueAt": wire(quote["balance_due_at"]), "balanceGraceEndsAt": wire(quote["balance_due_at"] + DAY),
        "termsVersion": quote["terms_version"], "termsText": snapshot["termsText"],
        "packageSummary": snapshot["packageSummary"], "serviceSummary": snapshot["serviceSummary"],
        "equipment": snapshot["equipment"], "extraChargeTerms": snapshot["extraChargeTerms"],
        "schedule": quote_schedule(quote),
    }


def equipment_complete(quote, equipment):
    return len(equipment) == len(quote["quote_snapshot"]["equipment"]) and all(item["checked_at"] for item in equipment)


def actions(conn, event, quote, charges, equipment, now, *, admin):
    status = event["status"]
    if status not in ACTIVE_EVENT:
        if admin and status == "EXPIRED" and not charges:
            return ["ISSUE_QUOTE"]
        return []
    result = []
    if status in PRE_TRANSFER and not store.payment_evidence(conn, [item["id"] for item in charges], any_proof=True):
        result.append("CANCEL")
    if not admin:
        if status == "QUOTED" and quote["status"] == "OFFERED" and now < quote["deposit_due_at"]:
            result.append("ACCEPT_QUOTE")
        return result
    if status in ("APPLIED", "QUOTED"):
        result.extend(("ISSUE_QUOTE", "DECLINE", "PROPOSE_ALTERNATE_DATE"))
    if status in BOOKING_STATES and event["actual_setup_at"] is None and not equipment and any(
        charge["category"] == "EVENT_BALANCE" for charge in charges
    ):
        result.append("RESCHEDULE")
    if status not in ("APPLIED", "QUOTED") and "CANCEL" not in result:
        result.append("CANCEL")
    if status == "PROCEEDING":
        expected = len(quote["quote_snapshot"]["equipment"])
        if not equipment and expected and event["actual_end_at"] is None:
            result.append("RECORD_EQUIPMENT_OUT")
        if event["actual_setup_at"] is None:
            result.append("RECORD_SETUP")
        elif event["actual_end_at"] is None and len(equipment) == expected:
            result.append("RECORD_ACTUAL_END")
        elif event["actual_end_at"] is not None:
            result.append("RECORD_TEARDOWN")
    if status == "EQUIPMENT_CHECK":
        if equipment_complete(quote, equipment):
            result.extend(("COMPLETE", "ISSUE_EXTRAS"))
        else:
            result.append("RECORD_EQUIPMENT_CHECK")
    if status == "ADDITIONAL_BILL" and any(
        charge["category"] == "EVENT_EXTRA" and charge["state"] == "PAID" for charge in charges
    ):
        result.append("COMPLETE")
    return result


def event_view(conn, event, now, qr_url, *, admin=False, merchant=False):
    event_id = event["id"]
    quote = store.current_quote(conn, event_id)
    changes = store.current_reschedule(conn, event_id) if quote else None
    charges = store.charges_for_event(conn, event_id)
    equipment = store.equipment_ledger(conn, event_id) if admin and quote else []
    quote_data = quote_view(quote) if quote else None
    effective = changes["schedule_snapshot"] if changes else None
    if effective is None and quote and event["booked_at"] is not None:
        effective = quote_schedule(quote)
    result = {
        "id": str(event_id), "number": event["event_number"], "version": event["version"], "status": event["status"],
        "request": event["request_snapshot"], "quote": quote_data,
        "charges": [
            settlement.project_charge(conn, item, now, qr_url=qr_url, admin=admin, event=event) for item in charges
        ],
        "allowedActions": actions(conn, event, quote, charges, equipment, now, admin=admin),
        "actualSetupAt": wire(event["actual_setup_at"]), "actualEndAt": wire(event["actual_end_at"]),
        "actualTeardownAt": wire(event["actual_teardown_at"]),
        "effectiveBalanceDueAt": wire(event["effective_balance_due_at"]),
        "effectiveBalanceGraceEndsAt": wire(event["effective_balance_grace_ends_at"]),
        "balanceDeadlineRevision": event["balance_deadline_revision"],
        "alternativeSchedule": event["alternative_schedule"], "effectiveSchedule": effective,
        "safeOutcome": OUTCOMES.get(event["status"]),
        "extraInvoices": [{
            "chargeId": str(item["id"]), "dueAt": wire(item["due_at"]), "lines": item["bill_snapshot"]["lines"],
        } for item in charges if item["category"] == "EVENT_EXTRA"],
    }
    if merchant:
        result.update(merchant_details(conn, event_id, quote, changes, equipment))
    return result


def merchant_details(conn, event_id, quote, changes, equipment):
    plan = None
    if quote:
        window = one(conn, "SELECT * FROM resource_window WHERE quote_id = %s", (quote["id"],))
        if window:
            start, end = window["starts_at"], window["ends_at"]
            if changes:
                start, end = changes["resource_starts_at"], changes["resource_ends_at"]
            plan = {
                "resourceWindow": {"startAt": wire(start), "endAt": wire(end)},
                "staffCount": window["planned_staff"], "assessmentNotes": window["assessment_note"],
            }
    history = rows(conn, """
        SELECT action, occurred_at, reason_code FROM audit_event
        WHERE resource_id = %s OR resource_id IN (SELECT id FROM charge WHERE event_id = %s)
        ORDER BY occurred_at DESC, id DESC LIMIT 30
    """, (event_id, event_id))
    return {
        "merchantPlan": plan,
        "equipmentLedger": [{
            "equipmentId": str(item["equipment_id"]), "taken": item["taken"], "takenAt": wire(item["taken_at"]),
            "returned": item["returned"], "damaged": item["damaged"], "lost": item["lost"],
            "checkedAt": wire(item["checked_at"]),
        } for item in equipment],
        "recentHistory": [{
            "action": item["action"], "at": wire(item["occurred_at"]), "safeReason": item["reason_code"],
        } for item in history],
    }
