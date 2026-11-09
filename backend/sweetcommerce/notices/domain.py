import re
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from ..clock import iso

RETRY_DELAYS = (60, 300, 900)
LEASE_SECONDS = 30
SEND_TIMEOUT_SECONDS = 5
FALLBACK_CHANNELS = ("SMS", "EMAIL")
SAFE_FAILURES = ("CHANNEL_NOT_CONFIGURED", "PROVIDER_REJECTED")
_MILESTONE = re.compile(r"(?:STANDARD_|EVENT_|MERCHANT_)[A-Z0-9_]{1,90}")
_PHONE = re.compile(r"\+[1-9][0-9]{7,14}")
_EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")


@dataclass(frozen=True)
class Delivery:
    outcome: str
    safe_reason: str | None = None
    retryable: bool = False


def safe_delivery(result):
    if isinstance(result, Delivery):
        if result.outcome == "DELIVERED":
            return Delivery("DELIVERED")
        if result.outcome == "FAILED":
            reason = result.safe_reason if result.safe_reason in SAFE_FAILURES else "PROVIDER_REJECTED"
            return Delivery("FAILED", reason, result.retryable is True)
    return Delivery("UNKNOWN", "PROVIDER_OUTCOME_UNKNOWN")


def milestone(data):
    value = data.get("milestone")
    if isinstance(value, str) and (value == "REFUND_POSTED" or _MILESTONE.fullmatch(value)):
        return value
    return "BUSINESS_NOTICE"


def identifier(value):
    try:
        return UUID(value) if isinstance(value, str) else None
    except ValueError:
        return None


def instant(value):
    try:
        parsed = datetime.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None
    return parsed if parsed is not None and parsed.tzinfo is not None else None


def destinations(contact, fallbacks):
    phone, email = contact["phone"], contact["email"]
    eligible = {}
    if phone and _PHONE.fullmatch(phone):
        eligible["WHATSAPP"] = phone
        if "SMS" in fallbacks:
            eligible["SMS"] = phone
    if "EMAIL" in fallbacks and email and len(email) <= 254 and _EMAIL.fullmatch(email):
        eligible["EMAIL"] = email
    return eligible


def notice_message(data, source_number):
    message = {"milestone": milestone(data), "reference": source_number}
    deadline = instant(data.get("deadline"))
    if deadline is not None:
        message["deadline"] = iso(deadline)
    outstanding = data.get("outstandingMinor")
    if type(outstanding) is int and 0 < outstanding <= 2**63 - 1:
        message["outstandingMinor"] = outstanding
    return message


def notice_view(work, attempts, followup):
    latest = attempts[-1] if attempts else None
    if followup:
        state = "RESOLVED"
    elif work["work_state"] == "LEASED":
        state = "SENDING"
    elif work["work_state"] == "READY":
        state = "PENDING"
    elif work["last_safe_error"] == "OBSOLETE":
        state = "RESOLVED"
    elif work["last_safe_error"] == "LEASE_EXPIRED":
        state = "UNKNOWN"
    elif latest:
        state = latest["outcome"]
    else:
        state = "FAILED" if work["work_state"] == "DEAD" else "RESOLVED"
    hints = {
        "PENDING": "Wait for the scheduled notice attempt.",
        "SENDING": "Wait for the current delivery attempt.",
        "DELIVERED": "Delivery was confirmed.",
        "FAILED": "Review the delivery and record an authorized follow-up.",
        "UNKNOWN": "Verify the provider outcome before contacting the recipient again.",
        "RESOLVED": "No further delivery action is pending.",
    }
    data = work["payload"] if isinstance(work["payload"], dict) else {}
    return {
        "noticeId": str(work["id"]), "sourceType": work["source_type"], "sourceId": str(work["resource_id"]),
        "recipientRole": "MERCHANT" if data.get("recipientRole") in ("ADMIN", "MERCHANT") else "CUSTOMER",
        "milestone": milestone(data), "status": state,
        "attempts": [{
            "attempt": attempt["attempt_no"], "channel": attempt["channel"], "at": iso(attempt["attempted_at"]),
            "outcome": attempt["outcome"], "safeReason": attempt["safe_reason"],
        } for attempt in attempts],
        "safeNextAction": hints[state], "resolvedAt": iso(followup["resolved_at"]) if followup else None,
    }
