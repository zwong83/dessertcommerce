import re
from datetime import datetime

from ..order.input import _handoff_instant
from ..problems import Problem, validation
from ..values import field_string

MAX_MINOR = 999_999_999
MAX_VERSION = 9_007_199_254_740_991
UNACCEPTED = frozenset(("AWAITING_FEE", "AWAITING_CASH", "PENDING_PROOF", "PAYMENT_REVIEW", "EXCEPTION"))
TERMINAL = frozenset(("COMPLETED", "CANCELLED", "REJECTED", "EXPIRED", "NO_SHOW"))
ACTIVE = frozenset(("ACCEPTED", "PREPARING", "READY", "HANDED_OFF", "EXCEPTION"))
TRANSITIONS = {
    "START_PREPARATION": ("ACCEPTED", "PREPARING"),
    "MARK_READY": ("PREPARING", "READY"),
    "COMPLETE": ("HANDED_OFF", "COMPLETED"),
}
ACTION_FIELDS = ("action", "reason", "handoffAt", "driverArrivedAt", "cancellationBasis")
CONFIRM_FIELDS = ("feeVersion", "termsVersion")
QUOTE_FIELDS = ("feeMinor", "handoffAt", "serviceable", "reason")
RESCHEDULE_FIELDS = ("proposedHandoffAt", "requiresNewProduction", "reason", "consent", "recoveryKind")
ADJUSTMENT_FIELDS = ("amountMinor", "reason", "consent")
CANCEL_FIELDS = ("noTransferSent",)


def conflict(message: str) -> Problem:
    return Problem("INVALID_TRANSITION", 409, message)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise conflict(message)


def require_version(order: dict, version: int) -> None:
    if order["version"] != version:
        raise Problem("VERSION_CONFLICT", 409, "Refresh the order before trying again.")


def integer(value: object, minimum: int, maximum: int, label: str) -> int:
    if type(value) not in (int, float) or not minimum <= value <= maximum or value % 1:
        raise validation(f"Check {label}.")
    return int(value)


def choice(value: object, choices, label: str) -> str:
    if not isinstance(value, str) or value not in choices:
        raise validation(f"Check {label}.")
    return value


def safe_text(value: object, label: str, maximum: int) -> str:
    return field_string(value, label, pattern=r"\A[^\x00\ud800-\udfff]+\Z", max_length=maximum)


def boolean(value: object, label: str) -> bool:
    if type(value) is not bool:
        raise validation(f"Check {label}.")
    return value


def consent(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != {"agreedAt", "channel", "reference"}:
        raise validation("Record the customer's agreement to the exact change.")
    return {
        "agreedAt": _handoff_instant(value["agreedAt"]),
        "channel": choice(value["channel"], ("PHONE", "WHATSAPP", "IN_PERSON"), "the consent channel"),
        "reference": safe_text(value["reference"], "the consent reference", 200),
    }


def parse_version(value: str) -> int:
    match = re.fullmatch(r'"([1-9][0-9]{0,15})"', value)
    if not match or int(match[1]) > MAX_VERSION:
        raise validation("Refresh the order version.")
    return int(match[1])


def action_input(body: dict) -> dict:
    action = choice(
        body.get("action"),
        (*TRANSITIONS, "ACCEPT_CASH", "REJECT", "HANDOFF", "MARK_NO_SHOW", "RECORD_INCIDENT",
         "CANCEL", "RECORD_DRIVER_ARRIVAL"),
        "the merchant action",
    )
    result = {"action": action}
    if "reason" in body or action in ("RECORD_INCIDENT", "REJECT", "MARK_NO_SHOW", "CANCEL"):
        result["reason"] = safe_text(body.get("reason"), "the reason", 500)
    if action == "CANCEL" or "cancellationBasis" in body:
        result["cancellationBasis"] = choice(
            body.get("cancellationBasis"), ("MERCHANT_UNABLE", "CUSTOMER_POLICY", "EXCEPTION"),
            "the cancellation basis",
        )
    if action == "RECORD_DRIVER_ARRIVAL" or "driverArrivedAt" in body:
        result["driverArrivedAt"] = _handoff_instant(body.get("driverArrivedAt"))
    if "handoffAt" in body:
        result["handoffAt"] = _handoff_instant(body["handoffAt"])
    return result


def verify_agreement(agreement: dict, order: dict, now: datetime) -> None:
    agreed_at = datetime.fromisoformat(agreement["agreedAt"])
    if not order["created_at"] <= agreed_at <= now:
        raise validation("The agreement time must be between order creation and now.")
