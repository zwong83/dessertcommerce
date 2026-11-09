import re
from datetime import UTC, datetime

from ..problems import Problem, validation
from ..settlement.domain import ACTIVE_CHARGE, ACTIVE_ORDER
from ..values import field_string

ACTIVE_INTENTS = ("RESERVED", "UNCERTAIN")
RESERVE_FIELDS = ("receiptId", "amountMinor", "expectedVersion", "reason")
POST_FIELDS = ("refundIntentId", "amountMinor", "expectedVersion", "externalReference", "refundedAt", "reason")
RECONCILE_FIELDS = ("outcome", "expectedChargeVersion", "reason")
_MAX_INTEGER = 9_007_199_254_740_991
_TEXT = re.compile(r"\A[^\x00\ud800-\udfff]+\Z")
_INSTANT = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]"
    r"(?:\.[0-9]{1,6}0*)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])",
    re.IGNORECASE | re.ASCII,
)


def positive_integer(value, label, maximum=_MAX_INTEGER) -> int:
    if type(value) not in (int, float) or not 1 <= value <= maximum or value % 1:
        raise validation(f"Check {label}.")
    return int(value)


def reason(value) -> str:
    return field_string(value, "the refund reason", _TEXT, 500)


def movement_reference(value) -> str:
    return field_string(value, "the payout reference", _TEXT, 140).strip()


def payout_time(value) -> datetime:
    if isinstance(value, str) and len(value) <= 80 and _INSTANT.fullmatch(value):
        try:
            return datetime.fromisoformat(value.upper()).astimezone(UTC)
        except (ValueError, OverflowError):
            pass
    raise validation("Use the actual payout time with an explicit timezone.")


def check_version(charge, expected: int) -> None:
    if charge["version"] != expected:
        raise Problem("VERSION_CONFLICT", 409, "Review the current charge before trying again.")


def refund_limit() -> Problem:
    return Problem("REFUND_LIMIT_EXCEEDED", 409, "The refund exceeds the available amount for this receipt.")


def charge_state_after_payout(parent, charge, money) -> str:
    if charge["state"] in ACTIVE_CHARGE:
        # A partial payout can coexist with an open proof or expiry workflow.
        if charge["category"] == "STANDARD":
            if parent["status"] in ACTIVE_ORDER:
                return charge["state"]
        elif not charge.get("event_id") or parent["status"] not in ("COMPLETED", "EXPIRED", "CANCELLED", "DECLINED"):
            return charge["state"]
    return "REFUNDED" if money["paid"] == money["refunded"] else "PARTIALLY_REFUNDED"


def next_intent_state(intent, outcome: str) -> str:
    if outcome == "PAYOUT_UNCERTAIN" and intent["status"] == "RESERVED":
        return "UNCERTAIN"
    if outcome == "CONFIRMED_NOT_PAID" and intent["status"] in ACTIVE_INTENTS:
        return "VOIDED"
    raise Problem("INVALID_TRANSITION", 409, "This refund intent cannot be reconciled in its current state.")
