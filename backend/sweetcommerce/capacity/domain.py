import re
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from sweetcommerce.problems import AccessDenied, AuthenticationRequired, validation

_EPOCH = date(1970, 1, 1).toordinal()
_DAY = 86_400
_MYT = 8 * 3_600
_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_TIMESTAMP = re.compile(
    r"([0-9]{4}-[0-9]{2}-[0-9]{2})T((?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9])"
    r"(?:\.([0-9]+))?(Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])",
    re.IGNORECASE | re.ASCII,
)
_UUID = re.compile(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}", re.IGNORECASE)

Timestamp = str | datetime
SAME_DAY_ORDER_CUTOFF = "18:00"
SAME_DAY_LATEST_HANDOFF = "21:00"


class FulfilmentMode(StrEnum):
    PICKUP = "PICKUP"
    MERCHANT_LALAMOVE = "MERCHANT_LALAMOVE"
    CUSTOMER_LALAMOVE = "CUSTOMER_LALAMOVE"


FULFILMENT_MODES = tuple(FulfilmentMode)


class CapacityActor(Protocol):
    account_id: str | UUID
    role: str


def uuid(value: str | UUID) -> str:
    identifier = str(value)
    if not _UUID.fullmatch(identifier):
        raise validation("Use a valid identifier.")
    return identifier.lower()


def require_role(actor: CapacityActor | None, role: str) -> str:
    if actor is None:
        raise AuthenticationRequired("Sign in to continue.")
    if actor.role != role:
        raise AccessDenied("This action requires a different account role.")
    return uuid(actor.account_id)


def date_millis(value: str | date) -> int:
    value = str(value)
    if _DATE.fullmatch(value):
        try:
            return (date.fromisoformat(value).toordinal() - _EPOCH) * _DAY * 1_000
        except ValueError:
            pass
    raise validation("Use a valid calendar date.")


def _date_iso(days: int) -> str:
    ordinal = days + _EPOCH
    # Move by a Gregorian cycle at the edges of datetime's year range.
    shift = 400 if ordinal < 1 else -400 if ordinal > date.max.toordinal() else 0
    shifted = date.fromordinal(ordinal + shift * 146_097 // 400)
    year = shifted.year - shift
    prefix = f"{year:04d}" if 0 <= year <= 9999 else f"{year:+07d}"
    return f"{prefix}-{shifted.month:02d}-{shifted.day:02d}"


def add_days(value: str | date, days: int) -> str:
    return _date_iso(date_millis(value) // (_DAY * 1_000) + days)


def _instant(value: Timestamp) -> tuple[int, str]:
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise validation("Use a valid handoff timestamp with an explicit timezone.")
        value = value.astimezone(UTC).isoformat()
    match = _TIMESTAMP.fullmatch(value) if isinstance(value, str) else None
    if not match:
        raise validation("Use a valid handoff timestamp with an explicit timezone.")
    day, time, fraction, offset = match.groups()
    hour, minute, second = map(int, time.split(":"))
    seconds = date_millis(day) // 1_000 + hour * 3_600 + minute * 60 + second
    if offset[0] in "+-":
        offset_seconds = (int(offset[1:3]) * 60 + int(offset[4:6])) * 60
        seconds += offset_seconds if offset[0] == "-" else -offset_seconds
    # Comparing the full decimal fraction avoids rounding across policy cutoffs.
    return seconds, (fraction or "").rstrip("0")


def timestamp_millis(timestamp: Timestamp) -> int:
    seconds, fraction = _instant(timestamp)
    return seconds * 1_000 + int(fraction[:3].ljust(3, "0"))


def myt_date(timestamp: Timestamp) -> str:
    return _date_iso((_instant(timestamp)[0] + _MYT) // _DAY)


def _local_time(day: str, time: str) -> tuple[int, str]:
    return _instant(f"{day}T{time}:00+08:00")


def _handoff_window(policy: Mapping, now: tuple[int, str], day: str, prep_minutes: int):
    weekday = (date_millis(day) // (_DAY * 1_000) + 3) % 7 + 1
    today = _date_iso((now[0] + _MYT) // _DAY)
    same_day = day == today
    if weekday not in policy["openWeekdays"] or day < today:
        return None
    if same_day and now > _local_time(day, SAME_DAY_ORDER_CUTOFF):
        return None

    opens = _local_time(day, policy["opensAt"])
    ready = (now[0] + prep_minutes * 60, now[1])
    closes = min(policy["closesAt"], SAME_DAY_LATEST_HANDOFF) if same_day else policy["closesAt"]
    return max(opens, ready), _local_time(day, closes)


def is_handoff_eligible(policy: Mapping, now: Timestamp, handoff: Timestamp, prep_minutes: int) -> bool:
    requested = _instant(handoff)
    window = _handoff_window(policy, _instant(now), _date_iso((requested[0] + _MYT) // _DAY), prep_minutes)
    return window is not None and window[0] <= requested <= window[1]


def earliest_handoff(policy: Mapping, now: Timestamp, day: str, prep_minutes: int) -> str | None:
    window = _handoff_window(policy, _instant(now), day, prep_minutes)
    if window is None or window[0] > window[1]:
        return None
    (seconds, fraction), _ = window
    days, within_day = divmod(seconds, _DAY)
    hour, remainder = divmod(within_day, 3_600)
    minute, second = divmod(remainder, 60)
    return f"{_date_iso(days)}T{hour:02d}:{minute:02d}:{second:02d}.{fraction or '000'}Z"


def can_fit_capacity(day: Mapping | None, limits: Mapping[str, Mapping], units: Mapping[str, int]) -> bool:
    for product_id, quantity in units.items():
        limit = limits.get(product_id)
        if limit is not None and quantity > limit["max"] - limit["allocated"]:
            return False
    return day is not None and not day["closed"] and sum(units.values()) <= day["max"] - day["allocated"]


def product_demand(items: Sequence[Mapping], rows: Sequence[Mapping]) -> tuple[dict[str, int], int, bool]:
    variants = {str(row["variant_id"]): row for row in rows}
    units: dict[str, int] = {}
    prep_minutes = 0
    sellable = bool(items)
    for item in items:
        row = variants.get(str(item["variantId"]))
        if row is None or row["status"] != "LISTED" or not row["available"]:
            sellable = False
            continue
        product_id = str(row["product_id"])
        units[product_id] = units.get(product_id, 0) + item["quantity"]
        prep_minutes = max(prep_minutes, row["prep_minutes"])
    return units, prep_minutes, sellable
