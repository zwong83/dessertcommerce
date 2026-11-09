from datetime import datetime

from ..db import iso, rows
from ..order.infrastructure import missing
from .domain import ACTIVE, UNACCEPTED
from .infrastructure import at, has_current_arrival, latest_recovery, status_before_incident

_CUSTOMER_OUTCOMES = {
    "AWAITING_FEE": "Wait for the merchant’s delivery offer.",
    "AWAITING_CASH": "Wait for the merchant to accept your Cash pickup.",
    "PENDING_PROOF": "Pay the agreed amount and submit your transfer proof before the deadline.",
    "PAYMENT_REVIEW": "The merchant is reviewing your payment.",
    "ACCEPTED": "Your order is accepted. Check the promised handoff time.",
    "PREPARING": "The merchant is preparing your order.",
    "READY": "Your order is ready for the agreed handoff.",
    "HANDED_OFF": "The merchant has recorded the handoff.",
    "EXCEPTION": "Contact the merchant about your order.",
    "EXPIRED": "The payment window has expired.",
    "CANCELLED": "Your order is cancelled.",
    "REJECTED": "The merchant could not accept your order.",
    "NO_SHOW": "Pickup was recorded as uncollected.",
    "COMPLETED": "Your order is complete.",
}


def read_orders(conn, order_ids: list, now: datetime, qr_url: str | None, whatsapp_url: str | None, *,
                owner_id: str | None = None, admin: bool = False) -> list[dict]:
    if not order_ids:
        return []
    selected = rows(
        conn,
        """SELECT o.*, f.serviceable AS offer_serviceable, f.offered_handoff_at, f.fee_minor AS offer_fee,
                  f.terms_version AS offer_terms, f.terms_snapshot AS offer_snapshot,
                  ARRAY(SELECT l.display_snapshot FROM standard_order_line l WHERE l.order_id = o.id
                        ORDER BY l.variant_id) AS items
             FROM standard_order o
             LEFT JOIN delivery_fee_offer f ON f.order_id = o.id AND f.revision = o.fee_version
            WHERE o.id = ANY(%(ids)s::uuid[]) AND (%(owner)s::uuid IS NULL OR o.account_id = %(owner)s)
            ORDER BY o.created_at DESC, o.id DESC""",
        {"ids": order_ids, "owner": owner_id},
    )
    by_order = {order["id"]: [] for order in selected}
    for charge in _charges(conn, list(by_order)):
        by_order[charge["order_id"]].append(charge)
    history = None
    if admin:
        history = rows(
            conn,
            """SELECT action, occurred_at, COALESCE(safe_change->>'merchantReason', reason_code) AS reason_code
                 FROM audit_event WHERE resource_id = %s AND feature IN ('ORDER', 'settlement', 'SETTLEMENT')
                ORDER BY occurred_at DESC, id DESC LIMIT 30""",
            (order_ids[0],),
        )
    return [
        _order(conn, order, by_order[order["id"]], now, qr_url, whatsapp_url, history)
        for order in selected
    ]


def order_detail(conn, order_id, now: datetime, qr_url: str | None, whatsapp_url: str | None, *,
                 owner_id: str | None = None, admin: bool = False) -> dict:
    result = read_orders(conn, [order_id], now, qr_url, whatsapp_url, owner_id=owner_id, admin=admin)
    if not result:
        raise missing()
    return result[0]


def _charges(conn, order_ids: list) -> list[dict]:
    return rows(
        conn,
        """SELECT c.*, money.paid, money.refunded, refunds.required, refunds.reserved,
                  proofs.recorded AS proof_recorded, proofs.reviewing, proofs.top_up_reviewing, cases.open AS open_case
             FROM charge c
             CROSS JOIN LATERAL (
                SELECT COALESCE(SUM(amount_minor) FILTER (WHERE kind = 'RECEIPT'), 0) AS paid,
                       COALESCE(SUM(amount_minor) FILTER (WHERE kind = 'REFUND'), 0) AS refunded
                  FROM money_entry WHERE charge_id = c.id
             ) money
             CROSS JOIN LATERAL (
                SELECT COALESCE(SUM(LEAST(obligation.amount_minor, m.amount_minor - intents.paid))
                         FILTER (WHERE obligation.receipt_id IS NOT NULL), 0) AS required,
                       COALESCE(SUM(intents.reserved), 0) AS reserved
                  FROM money_entry m LEFT JOIN full_refund_obligation obligation ON obligation.receipt_id = m.id
                  CROSS JOIN LATERAL (
                      SELECT COALESCE(SUM(amount_minor) FILTER (WHERE status = 'POSTED'), 0) AS paid,
                             COALESCE(SUM(amount_minor) FILTER (WHERE status IN ('RESERVED', 'UNCERTAIN')), 0) AS reserved
                        FROM refund_intent WHERE receipt_id = m.id
                  ) intents
                 WHERE m.charge_id = c.id AND m.kind = 'RECEIPT'
             ) refunds
             CROSS JOIN LATERAL (
                SELECT COUNT(*) > 0 AS recorded, COUNT(*) FILTER (WHERE state = 'REVIEW') > 0 AS reviewing,
                       COUNT(*) FILTER (
                         WHERE state = 'REVIEW' AND review_disposition = 'TIMELY'
                           AND received_at >= c.top_up_requested_at AND received_at < c.top_up_due_at
                       ) > 0 AS top_up_reviewing
                  FROM payment_proof WHERE charge_id = c.id
             ) proofs
             CROSS JOIN LATERAL (
                SELECT EXISTS (SELECT 1 FROM settlement_case WHERE charge_id = c.id AND status = 'OPEN') AS open
             ) cases
            WHERE c.order_id = ANY(%s::uuid[]) ORDER BY c.created_at, c.id""",
        (order_ids,),
    )


def _charge(charge: dict, order: dict, now: datetime, qr_url: str | None, *, admin: bool = False) -> dict:
    top_up = None
    outstanding = max(0, int(charge["expected_minor"] - charge["paid"] + charge["refunded"]))
    if (
        charge["top_up_due_at"] is not None and outstanding > 0
        and order["status"] in ("PENDING_PROOF", "PAYMENT_REVIEW", "EXCEPTION") and order["accepted_at"] is None
        and charge["state"] in ("OPEN", "PROOF_REVIEW", "DISPUTED")
        and (charge["top_up_reviewing"] or now < charge["top_up_due_at"])
    ):
        top_up = {
            "outstandingMinor": charge["top_up_outstanding_minor"],
            "requestedAt": iso(charge["top_up_requested_at"]), "dueAt": iso(charge["top_up_due_at"]),
            "status": "UNDER_REVIEW" if charge["top_up_reviewing"] else "AWAITING_PROOF",
        }
    adjustment = charge["category"] == "STANDARD_ADJUSTMENT"
    show_transfer = (
        order["payment_method"] == "DUITNOW"
        and (
            (adjustment and order["status"] in ACTIVE | {"COMPLETED"}
             and charge["state"] in ("OPEN", "DISPUTED") and outstanding > 0 and not charge["reviewing"])
            or (top_up is not None and top_up["status"] == "AWAITING_PROOF")
            or (
                charge["top_up_due_at"] is None and order["status"] == "PENDING_PROOF" and charge["state"] == "OPEN"
                and charge["due_at"] is not None and now < charge["due_at"]
            )
        )
    )
    actions = []
    available = max(0, int(charge["paid"] - charge["refunded"] - charge["reserved"]))
    if admin and order["payment_method"] == "DUITNOW":
        if charge["state"] in ("OPEN", "PROOF_REVIEW", "DISPUTED"):
            actions.append("CONFIRM_RECEIPT")
        if charge["reviewing"]:
            actions.append("REVIEW_PROOF")
        actions.append("OPEN_SETTLEMENT_CASE")
    if admin and available:
        actions.append("RESERVE_REFUND")
    if not admin and order["payment_method"] == "DUITNOW" and (
        charge["state"] in ("OPEN", "PROOF_REVIEW", "DISPUTED", "EXPIRED", "CANCELLED")
    ):
        actions.append("UPLOAD_PROOF")
    return {
        "id": str(charge["id"]), "category": charge["category"], "expectedMinor": charge["expected_minor"],
        "paidMinor": int(charge["paid"]), "refundedMinor": int(charge["refunded"]), "state": charge["state"],
        "dueAt": at(charge["due_at"]), "version": charge["version"], "qrUrl": qr_url if show_transfer else None,
        "refundableMinor": available,
        "reviewStatus": "UNDER_REVIEW" if charge["reviewing"] else "RECONCILIATION" if charge["open_case"] else None,
        "outstandingMinor": outstanding, "requiredRefundMinor": max(0, int(charge["required"])), "topUp": top_up,
        "allowedActions": actions,
    }


def adjustment_detail(conn, order: dict, charge_id: str, now: datetime, qr_url: str | None) -> dict:
    for charge in _charges(conn, [order["id"]]):
        if str(charge["id"]) == charge_id:
            return _charge(charge, order, now, qr_url)
    raise missing()


def contact_merchant(whatsapp_url: str | None, *, max_length: int = 500) -> str:
    message = "If you sent or may have sent a transfer, contact the merchant on WhatsApp."
    if whatsapp_url:
        with_link = f"{message[:-1]} at {whatsapp_url}"
        if len(with_link) <= max_length:
            return with_link
    return message


def _order(conn, order: dict, charges: list[dict], now: datetime, qr_url: str | None, whatsapp_url: str | None,
           history: list[dict] | None) -> dict:
    status = order["status"]
    fee_offer = None
    if order["offer_serviceable"] is not None:
        offer_fee = order["offer_fee"]
        fee_offer = {
            "revision": order["fee_version"], "serviceable": order["offer_serviceable"],
            "offeredHandoffAt": at(order["offered_handoff_at"]), "feeMinor": offer_fee,
            "totalMinor": order["subtotal_minor"] + offer_fee if offer_fee is not None else None,
            "termsVersion": order["offer_terms"], "termsText": order["offer_snapshot"]["termsText"],
            "safeReason": None if order["offer_serviceable"] else "This delivery offer is unavailable.",
        }
    projected = [_charge(charge, order, now, qr_url, admin=history is not None) for charge in charges]
    standard = next((charge for charge in projected if charge["category"] == "STANDARD"), None)
    blocked = any(charge["proof_recorded"] or charge["paid"] or charge["open_case"] for charge in charges)
    actions = []
    outcome = _CUSTOMER_OUTCOMES[status]
    if status in UNACCEPTED and order["accepted_at"] is None:
        if blocked or status in ("PAYMENT_REVIEW", "EXCEPTION"):
            actions.append("CONTACT_MERCHANT")
        else:
            actions.append("CANCEL")
        if blocked:
            outcome = f"{outcome} {contact_merchant(whatsapp_url, max_length=500 - len(outcome) - 1)}"
    if status == "AWAITING_FEE" and fee_offer is not None:
        outcome = "Review the merchant’s delivery fee and handoff time."
        if fee_offer["serviceable"]:
            actions.append("CONFIRM_DELIVERY_FEE")
        else:
            actions.append("CONTACT_MERCHANT")
            outcome = fee_offer["safeReason"]
    if status == "EXCEPTION" and "CONTACT_MERCHANT" not in actions:
        actions.append("CONTACT_MERCHANT")
    if status == "PENDING_PROOF" and order["proof_due_at"] is not None and now >= order["proof_due_at"] and not blocked:
        outcome = "The payment window has ended."
    if standard and standard["topUp"]:
        outcome = (
            "The merchant is reviewing your top-up proof."
            if standard["topUp"]["status"] == "UNDER_REVIEW" else
            "Pay the outstanding amount and submit your top-up proof before the deadline."
        )
    if any("UPLOAD_PROOF" in charge["allowedActions"] for charge in projected):
        actions.append("UPLOAD_PROOF")

    snapshot = order["fulfilment_snapshot"]
    result = {
        "id": str(order["id"]), "number": order["order_number"], "version": order["version"], "status": status,
        "fulfilment": order["fulfilment"], "paymentMethod": order["payment_method"],
        "requestedHandoffAt": at(order["requested_handoff_at"]), "promisedHandoffAt": at(order["promised_handoff_at"]),
        "readyAt": at(order["ready_at"]), "driverArrivedAt": at(order["driver_arrived_at"]), "handoffAt": at(order["handoff_at"]),
        "pickupDisplay": snapshot.get("pickupDisplay"), "address": snapshot.get("address"), "items": order["items"],
        "subtotalMinor": order["subtotal_minor"], "feeMinor": order["fee_minor"], "totalMinor": order["total_minor"],
        "termsVersion": order["terms_version"], "feeVersion": order["fee_version"], "proofDueAt": at(order["proof_due_at"]),
        "charge": standard, "feeOffer": fee_offer, "checkoutReviewId": str(order["checkout_review_id"]),
        "adjustments": [charge for charge in projected if charge["category"] == "STANDARD_ADJUSTMENT"],
        "contactName": snapshot["contactName"], "notificationEmail": snapshot.get("notificationEmail"),
        "termsText": snapshot["termsText"], "allowedActions": actions, "safeOutcome": outcome,
    }
    if history is None:
        result["phone"] = snapshot["phone"]
    else:
        result["contactPhone"] = snapshot["phone"]
        result["recentHistory"] = [
            {"action": event["action"], "at": iso(event["occurred_at"]), "safeReason": event["reason_code"]}
            for event in history
        ]
        result["allowedActions"] = _merchant_actions(conn, order, blocked, now)
    return result


def _merchant_actions(conn, order: dict, blocked: bool, now: datetime) -> list[str]:
    state = order["status"]
    pickup = order["fulfilment"] == "PICKUP"
    accepted = order["accepted_at"] is not None
    actions = {
        "AWAITING_FEE": ["QUOTE_DELIVERY_FEE", "REJECT"],
        "AWAITING_CASH": ["ACCEPT_CASH", "REJECT"],
        "PENDING_PROOF": ["REJECT"],
        "ACCEPTED": ["START_PREPARATION"],
        "PREPARING": ["MARK_READY"],
        "READY": ["HANDOFF"],
        "HANDED_OFF": ["COMPLETE"],
        "EXCEPTION": ["RESCHEDULE"],
    }.get(state, [])
    if blocked and "REJECT" in actions:
        actions.remove("REJECT")
    if state in ACTIVE | UNACCEPTED:
        actions.append("CANCEL")
    if accepted and state in ACTIVE | {"COMPLETED"}:
        actions.append("RECORD_INCIDENT")
    preceding = status_before_incident(conn, order)
    if state == "EXCEPTION" and accepted and preceding == "READY":
        actions.append("HANDOFF")
    if accepted and preceding in ("ACCEPTED", "PREPARING", "READY") and not pickup:
        recovery = latest_recovery(conn, order["id"])
        if not has_current_arrival(conn, order, recovery):
            actions.append("RECORD_DRIVER_ARRIVAL")
    if accepted and not pickup and state in ACTIVE | {"COMPLETED"}:
        actions.append("CREATE_DELIVERY_ADJUSTMENT")
    if order["payment_method"] == "CASH" and state in ("ACCEPTED", "PREPARING", "READY") and now >= order["promised_handoff_at"]:
        actions.append("MARK_NO_SHOW")
    return actions
