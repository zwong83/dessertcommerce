import re
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from ..capacity.domain import uuid
from ..problems import Problem, validation
from ..values import field_string

MYT = ZoneInfo("Asia/Kuala_Lumpur")
DAY = timedelta(days=1)
MAX_MONEY = 999_999_999
PRE_TRANSFER = {"APPLIED", "QUOTED", "AWAITING_DEPOSIT"}
BOOKING_STATES = {"BOOKED", "BALANCE_GRACE", "PROCEEDING", "EXCEPTION"}
ACTIVE_EVENT = PRE_TRANSFER | BOOKING_STATES | {"DEPOSIT_REVIEW", "EQUIPMENT_CHECK", "ADDITIONAL_BILL"}
SCHEDULE_FIELDS = ("setupReadyAt", "eventStartAt", "eventEndAt", "teardownAt")
REQUEST_FIELDS = (
    "eventDate", "startAt", "expectedEndAt", "setupReadyAt", "venue", "guestCount", "budgetMinor",
    "occasion", "theme", "specialRequirements", "contactName", "phone", "notificationEmail",
)
QUOTE_FIELDS = (
    "totalMinor", "depositDueAt", "balanceDueAt", "resourceWindow", "packageSummary", "equipment",
    "extraChargeTerms", "termsVersion", "resourceAssessment", "schedule", "serviceSummary",
)
ACCEPT_FIELDS = ("quoteId", "quoteVersion", "termsVersion")
RESCHEDULE_FIELDS = ("schedule", "resourceWindow", "consent", "reason", "obligationDisposition", "balancePlan")
ACTION_FIELDS = (
    "action", "reason", "equipmentCheck", "extras", "at", "equipmentOut", "alternativeSchedule",
    "cancellationBasis", "noTransferSent", "noBalanceFundsReceived",
)
_DATE_TIME = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
    r"(?:\.[0-9]{1,6})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])", re.I,
)


def missing():
    return Problem("NOT_FOUND", 404, "The event was not found.")


def transition(message="This action is unavailable for the current event."):
    return Problem("INVALID_TRANSITION", 409, message)


def stale():
    return Problem("VERSION_CONFLICT", 409, "Refresh the event and try again.")


def terms_changed():
    return Problem("TERMS_CHANGED", 409, "Review the current terms before continuing.")


def text(value, label, limit):
    value = field_string(value, label, max_length=limit)
    if "\x00" in value or any(0xD800 <= ord(char) <= 0xDFFF for char in value):
        raise validation(f"Check {label}.")
    return value


def integer(value, label, low, high):
    if type(value) is not int or not low <= value <= high:
        raise validation(f"Check {label}.")
    return value


def object_fields(value, required, optional=()):
    if not isinstance(value, dict) or not set(required) <= value.keys() or value.keys() - set(required) - set(optional):
        raise validation("Check the submitted fields.")
    return value


def choice(value, options, label):
    if not isinstance(value, str) or value not in options:
        raise validation(f"Check {label}.")
    return value


def entries(value, limit, *, minimum=0):
    if not isinstance(value, list) or not minimum <= len(value) <= limit:
        raise validation("Check the submitted list.")
    return value


def instant(value, label="the timestamp"):
    if isinstance(value, str) and len(value) <= 64 and _DATE_TIME.fullmatch(value):
        try:
            stamp = datetime.fromisoformat(value.upper()).astimezone(UTC)
            # Leave room for the business deadline offsets at datetime's limits.
            if 1 < stamp.year < 9999:
                return stamp
        except (ValueError, OverflowError):
            pass
    raise validation(f"Check {label}. Use a date and time with a timezone.")


def wire(value):
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z") if value is not None else None


def local_day(value):
    return value.astimezone(MYT).date()


def calendar_date(value):
    if isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        try:
            return date.fromisoformat(value)
        except ValueError:
            pass
    raise validation("Check the event date.")


def schedule(value):
    object_fields(value, SCHEDULE_FIELDS)
    setup, start, end, teardown = (instant(value[key], "the event schedule") for key in SCHEDULE_FIELDS)
    day = local_day(start)
    if not setup <= start < end <= teardown or local_day(setup) != day or local_day(teardown) != day:
        raise validation("Keep setup, the event and teardown in order on the same MYT date.")
    return dict(zip(SCHEDULE_FIELDS, map(wire, (setup, start, end, teardown))))


def window(value, offered):
    object_fields(value, ("startAt", "endAt"))
    start, end = (instant(value[key], "the resource window") for key in ("startAt", "endAt"))
    if not start <= instant(offered["setupReadyAt"]) <= instant(offered["teardownAt"]) <= end or start >= end:
        raise validation("Include setup through teardown in the resource window.")
    if (local_day(end) - local_day(start)).days >= 31:
        raise validation("Use a resource window of at most 31 calendar dates.")
    return start, end


def intake(body):
    object_fields(body, REQUEST_FIELDS[:-1], REQUEST_FIELDS[-1:])
    day = calendar_date(body["eventDate"])
    setup, start, end = (instant(body[key], "the requested times") for key in ("setupReadyAt", "startAt", "expectedEndAt"))
    if not setup <= start < end or local_day(setup) != day or local_day(end) != day:
        raise validation("Keep setup and event times in order on the requested MYT date.")
    address = object_fields(body["venue"], ("line1", "city", "postcode", "region"), ("line2", "note"))
    address_limits = {"line1": 200, "line2": 200, "city": 100, "postcode": 20, "region": 100, "note": 300}
    result = {
        "eventDate": day.isoformat(), "startAt": wire(start), "expectedEndAt": wire(end), "setupReadyAt": wire(setup),
        "venue": {key: text(value, "the venue", address_limits[key]) for key, value in address.items()},
        "guestCount": integer(body["guestCount"], "the guest count", 1, 100_000),
        "budgetMinor": integer(body["budgetMinor"], "the budget", 0, MAX_MONEY),
    }
    for key, label, limit in (
        ("occasion", "the occasion", 120), ("theme", "the theme", 120),
        ("specialRequirements", "special requirements", 1000), ("contactName", "the contact name", 120),
        ("phone", "the phone number", 24),
    ):
        result[key] = text(body[key], label, limit)
    if "notificationEmail" in body:
        email = text(body["notificationEmail"], "the notification email", 254)
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise validation("Check the notification email.")
        result["notificationEmail"] = email
    return result


def check_lead_time(body, now):
    local = now.astimezone(MYT)
    earliest = local.date() + DAY * (8 if local.time() > time(22) else 7)
    if calendar_date(body["eventDate"]) < earliest:
        raise validation("Choose a date that meets the seven-day MYT lead time.")


def acceptance(body):
    object_fields(body, ACCEPT_FIELDS)
    return {
        "quoteId": uuid(body["quoteId"]),
        "quoteVersion": integer(body["quoteVersion"], "the quote version", 1, 999),
        "termsVersion": text(body["termsVersion"], "the terms version", 40),
    }


def revision(value):
    if isinstance(value, str) and re.fullmatch(r'"[1-9][0-9]{0,18}"', value):
        return integer(int(value[1:-1]), "the event version", 1, 2**63 - 1)
    raise validation("Send the current event version in If-Match.")


def quote_details(body):
    object_fields(body, QUOTE_FIELDS)
    total = integer(body["totalMinor"], "the quote total", 2, MAX_MONEY)
    offered = schedule(body["schedule"])
    resource = window(body["resourceWindow"], offered)
    assessment = object_fields(body["resourceAssessment"], ("staffCount", "notes"))
    equipment = []
    for item in entries(body["equipment"], 100):
        object_fields(item, ("name", "quantity"))
        equipment.append({
            "name": text(item["name"], "the equipment name", 120),
            "quantity": integer(item["quantity"], "the equipment quantity", 1, 999),
        })
    snapshot = {
        key: text(body[key], "the quote details", 1500)
        for key in ("packageSummary", "serviceSummary", "extraChargeTerms")
    }
    return {
        "totalMinor": total, "depositDueAt": instant(body["depositDueAt"], "the deposit deadline"),
        "balanceDueAt": instant(body["balanceDueAt"], "the balance deadline"),
        "termsVersion": text(body["termsVersion"], "the terms version", 40),
        "schedule": offered, "window": resource, "equipment": equipment, "snapshot": snapshot,
        "staffCount": integer(assessment["staffCount"], "the planned staff count", 1, 999),
        "notes": text(assessment["notes"], "the resource assessment", 1200),
    }


def quote_cutoff(details, now):
    start = instant(details["schedule"]["eventStartAt"])
    deposit_due = details["depositDueAt"]
    balance_due = details["balanceDueAt"]
    cutoff = min(now + DAY * 3, deposit_due)
    if cutoff <= now or deposit_due > start - DAY * 4:
        raise validation("Choose a future deposit deadline at least four days before the event.")
    if local_day(balance_due) != local_day(start) - DAY * 3 or deposit_due >= balance_due:
        raise validation("Set the balance deadline on the MYT date three days before the event.")
    return cutoff


def reschedule_details(body):
    object_fields(body, RESCHEDULE_FIELDS)
    proposed = schedule(body["schedule"])
    consent = object_fields(body["consent"], ("agreedAt", "channel", "reference"))
    balance = body["balancePlan"]
    if not isinstance(balance, dict):
        raise validation("Check the balance plan.")
    state = choice(balance.get("state"), ("SETTLED", "AGREED_OUTSTANDING"), "the balance plan")
    fields = ("state", "chargeId", "dueAt", "graceEndsAt") if state == "AGREED_OUTSTANDING" else ("state", "chargeId")
    object_fields(balance, fields)
    plan = {**balance, "chargeId": uuid(balance["chargeId"])}
    for field in fields[2:]:
        plan[field] = wire(instant(balance[field], "the replacement balance deadline"))
    return {
        "schedule": proposed, "window": window(body["resourceWindow"], proposed),
        "consent": {
            "agreedAt": wire(instant(consent["agreedAt"], "the consent timestamp")),
            "channel": choice(consent["channel"], ("PHONE", "WHATSAPP", "IN_PERSON"), "the consent channel"),
            "reference": text(consent["reference"], "the consent reference", 200),
        },
        "reason": text(body["reason"], "the reschedule reason", 500),
        "obligationDisposition": choice(
            body["obligationDisposition"], ("KEEP_APPROVED_TERMS", "OWNER_REVIEW_REQUIRED"), "the obligation disposition",
        ),
        "balancePlan": plan,
    }


def cancellation_basis(body):
    return choice(
        body.get("cancellationBasis"),
        ("CUSTOMER_REQUEST", "BALANCE_OVERDUE", "MERCHANT_UNABLE", "FORCE_MAJEURE"),
        "the cancellation basis",
    )


def confirmed(body, key):
    if body.get(key) is not True:
        raise validation("Explicitly confirm that no funds were transferred.")


def service_entries(body, key, fields):
    result = {}
    for item in entries(body.get(key), 100, minimum=1):
        object_fields(item, fields)
        equipment_id = uuid(item["equipmentId"])
        if equipment_id in result:
            raise validation("Include each equipment item only once.")
        result[equipment_id] = item
    return result


def extra_lines(value):
    result = []
    for line in entries(value, 40, minimum=1):
        object_fields(line, ("item", "reason", "amountMinor"))
        result.append({
            "item": text(line["item"], "the extra item", 120),
            "reason": text(line["reason"], "the extra charge reason", 500),
            "amountMinor": integer(line["amountMinor"], "the extra amount", 1, MAX_MONEY),
        })
    total = integer(sum(line["amountMinor"] for line in result), "the extra total", 1, MAX_MONEY)
    return result, total
