import re
from datetime import UTC, datetime

from ..capacity.domain import FulfilmentMode, date_millis
from ..problems import validation
from ..values import field_string, field_uuid
from .domain import PaymentMethod

CHECKOUT_FIELDS = (
    "items", "requestedHandoffAt", "fulfilment", "cartVersion", "contactName", "phone",
    "address", "notificationEmail",
)
SUBMIT_FIELDS = (*CHECKOUT_FIELDS, "paymentMethod", "termsVersion", "reviewId")

TEXT = re.compile(r"\A[^\x00]+\Z")
EMAIL_CHAR = r"[^@\x00\x09-\x0d\x20\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]"
EMAIL = re.compile(rf"\A{EMAIL_CHAR}+@{EMAIL_CHAR}+\Z")
HANDOFF = re.compile(
    r"([0-9]{4}-[0-9]{2}-[0-9]{2})T((?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9])"
    r"(?:\.([0-9]+))?(Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])",
    re.IGNORECASE,
)


def _fields(value: object, allowed: tuple[str, ...]) -> dict:
    if not isinstance(value, dict) or any(key not in allowed for key in value):
        raise validation()
    return value


def _text(value: object, label: str, max_length: int, pattern: re.Pattern = TEXT) -> str:
    return field_string(value, label, pattern=pattern, max_length=max_length)


def _handoff_instant(value: object) -> str:
    match = HANDOFF.fullmatch(_text(value, "the handoff time", 80))
    if match is None:
        raise validation("Use a handoff time with an explicit timezone.")
    date, time, fraction, offset = match.groups()
    date_millis(date)
    fraction = fraction or ""
    if fraction[6:].strip("0"):
        raise validation("Use at most six decimal places for the handoff time.")
    try:
        utc = datetime.fromisoformat(f"{date}T{time}{offset.upper()}").astimezone(UTC)
    except (ValueError, OverflowError):
        raise validation("Use a valid calendar date.") from None
    fraction = fraction[:6].rstrip("0").ljust(3, "0")
    return f"{utc.isoformat(timespec='seconds')[:19]}.{fraction}Z"


def _delivery_address(value: object) -> dict:
    address = _fields(value, ("line1", "line2", "city", "postcode", "region", "note"))
    result = {
        "line1": _text(address.get("line1"), "the address", 200),
        "city": _text(address.get("city"), "the city", 100),
        "postcode": _text(address.get("postcode"), "the postcode", 20),
        "region": _text(address.get("region"), "the region", 100),
    }
    if "line2" in address:
        result["line2"] = _text(address["line2"], "the second address line", 200)
    if "note" in address:
        result["note"] = _text(address["note"], "the delivery note", 300)
    return result


def _integer_in_range(value: object, maximum: int) -> bool:
    return type(value) in (int, float) and 1 <= value <= maximum and value % 1 == 0


def _checkout(body: dict) -> dict:
    fulfilment = body.get("fulfilment")
    cart_version = body.get("cartVersion")
    if fulfilment not in (FulfilmentMode.PICKUP, FulfilmentMode.MERCHANT_LALAMOVE, FulfilmentMode.CUSTOMER_LALAMOVE):
        raise validation("Choose a handoff method.")
    if not _integer_in_range(cart_version, 9_007_199_254_740_991):
        raise validation("Refresh the cart version.")
    raw_items = body.get("items")
    if not isinstance(raw_items, list) or not 1 <= len(raw_items) <= 100:
        raise validation("Choose between 1 and 100 cart selections.")

    items = []
    for raw_item in raw_items:
        item = _fields(raw_item, ("variantId", "quantity"))
        quantity = item.get("quantity")
        if not _integer_in_range(quantity, 999):
            raise validation("Check the item quantities.")
        items.append({
            "variantId": str(field_uuid(item.get("variantId"), "the selected variant")).lower(),
            "quantity": int(quantity),
        })
    items.sort(key=lambda item: item["variantId"])
    if len({item["variantId"] for item in items}) != len(items):
        raise validation("Enter each selection once.")
    if fulfilment == FulfilmentMode.PICKUP and "address" in body:
        raise validation("Pickup uses the merchant pickup point.")

    # Key order is part of the digest shared with existing TypeScript reviews.
    result = {
        "fulfilment": fulfilment,
        "cartVersion": int(cart_version),
        "items": items,
        "requestedHandoffAt": _handoff_instant(body.get("requestedHandoffAt")),
        "contactName": _text(body.get("contactName"), "the contact name", 120),
        "phone": _text(body.get("phone"), "the contact phone", 24),
    }
    if fulfilment != FulfilmentMode.PICKUP:
        result["address"] = _delivery_address(body.get("address"))
    if "notificationEmail" in body:
        result["notificationEmail"] = _text(body["notificationEmail"], "the notification email", 254, EMAIL)
    return result


def parse_checkout_review(value: object) -> dict:
    return _checkout(_fields(value, CHECKOUT_FIELDS))


def parse_submit_order(value: object) -> tuple[dict, dict]:
    body = _fields(value, SUBMIT_FIELDS)
    payment_method = body.get("paymentMethod")
    if payment_method not in (PaymentMethod.DUITNOW, PaymentMethod.CASH):
        raise validation("Choose a payment method.")
    return _checkout(body), {
        "paymentMethod": payment_method,
        "reviewId": str(field_uuid(body.get("reviewId"), "the checkout review")).lower(),
        "termsVersion": _text(body.get("termsVersion"), "the terms version", 40),
    }
