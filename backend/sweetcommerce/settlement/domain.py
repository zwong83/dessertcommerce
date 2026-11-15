from datetime import datetime, timedelta
from enum import StrEnum

from ..clock import iso
from ..order.domain import OrderStatus
from ..problems import InvalidTransition, Problem


class ChargeState(StrEnum):
    OPEN = "OPEN"
    PROOF_REVIEW = "PROOF_REVIEW"
    PAID = "PAID"
    DISPUTED = "DISPUTED"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"
    PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED"
    REFUNDED = "REFUNDED"


ACTIVE_ORDER = frozenset((OrderStatus.PENDING_PROOF, OrderStatus.PAYMENT_REVIEW, OrderStatus.EXCEPTION))
ACTIVE_CHARGE = frozenset((ChargeState.OPEN, ChargeState.PROOF_REVIEW, ChargeState.DISPUTED))
TOP_UP_WINDOW = timedelta(minutes=30)


def invalid_transition(message="This action is unavailable for the current payment state.") -> Problem:
    return InvalidTransition(message)


def proof_view(proof):
    return {
        "id": str(proof["id"]), "chargeId": str(proof["charge_id"]),
        "state": proof["state"], "receivedAt": iso(proof["received_at"]),
        "reviewDisposition": proof["review_disposition"],
    }


def case_view(case):
    return {
        "id": str(case["id"]), "chargeId": str(case["charge_id"]),
        "reason": case["kind"], "state": case["status"],
        "proofId": str(case["proof_id"]) if case["proof_id"] is not None else None,
        "openedAt": iso(case["opened_at"]),
    }


def refund_view(refund):
    return {
        "id": str(refund["id"]), "receiptId": str(refund["receipt_id"]),
        "amountMinor": refund["amount_minor"], "state": refund["status"],
        "updatedAt": iso(refund["updated_at"]),
    }


def charge_view(charge, money, now: datetime, *, pending: bool, qr_url=None, admin=False, cutoff=None):
    paid, refunded = money["paid"], money["refunded"]
    net = paid - refunded
    due = cutoff or charge["top_up_due_at"] or charge["due_at"]
    active = charge["state"] in ACTIVE_CHARGE
    qr = qr_url if active and due and now < due and not pending and net < charge["expected_minor"] else None
    top_up = None
    if active and charge["top_up_due_at"] and 0 < charge["expected_minor"] - net and (now < due or pending):
        top_up = {
            "outstandingMinor": charge["expected_minor"] - net,
            "requestedAt": iso(charge["top_up_requested_at"]), "dueAt": iso(due),
            "status": "UNDER_REVIEW" if pending else "AWAITING_PROOF",
        }
    actions = []
    if admin:
        if active:
            actions.append("CONFIRM_RECEIPT")
        if pending:
            actions.append("REVIEW_PROOF")
        if money["available"]:
            actions.append("RESERVE_REFUND")
        actions.append("OPEN_SETTLEMENT_CASE")
    elif active or charge["state"] in (ChargeState.EXPIRED, ChargeState.CANCELLED):
        actions.append("UPLOAD_PROOF")
    return {
        "id": str(charge["id"]), "category": charge["category"], "state": charge["state"],
        "expectedMinor": charge["expected_minor"], "paidMinor": paid, "refundedMinor": refunded,
        "dueAt": iso(charge["due_at"]) if charge["due_at"] else None, "version": charge["version"],
        "qrUrl": qr, "outstandingMinor": max(0, charge["expected_minor"] - net),
        "refundableMinor": money["available"], "requiredRefundMinor": money["required"],
        "reviewStatus": "UNDER_REVIEW" if pending else None, "topUp": top_up, "allowedActions": actions,
    }
