import base64
import hmac
import json
import re
from collections import defaultdict
from datetime import UTC, datetime, timedelta

from sweetcommerce.clock import utc_now
from sweetcommerce.db import Database, iso
from sweetcommerce.problems import Problem, VersionConflict, validation

from .domain import (
    FULFILMENT_MODES,
    CapacityActor,
    add_days,
    can_fit_capacity,
    date_millis,
    earliest_handoff,
    is_handoff_eligible,
    myt_date,
    product_demand,
    require_role,
    timestamp_millis,
    uuid,
)
from .infrastructure import (
    WEEKDAYS,
    CapacityClock,
    CapacityCommand,
    affected_orders,
    audit,
    calendar_event_windows,
    check_products,
    command,
    database_time,
    json_bytes,
    lock_capacity_dates,
    lock_policy,
    protected_counts,
    read_days,
    read_limits,
    read_policy,
    read_variants,
    save_capacity,
    save_policy,
)

_MAX_PG_INTEGER = 2_147_483_647
_MAX_EXPECTED_VERSION = 2**53 - 2
_HHMM = re.compile(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]")
_IF_MATCH = re.compile(r'"([1-9][0-9]{0,15})"')
_SIGNED_VALUE = re.compile(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}")


def _conflict() -> Problem:
    return VersionConflict("Refresh and review the current capacity before saving.")


def _whole_number(value, low: int, high: int) -> bool:
    return type(value) in (int, float) and low <= value <= high and int(value) == value


def _normalize_edit(input: dict) -> dict:
    date_millis(input["date"])
    products = input.get("productLimits")
    if (
        type(input.get("closed")) is not bool
        or not _whole_number(input.get("dayLimit"), 0, _MAX_PG_INTEGER)
        or not _whole_number(input.get("expectedVersion"), 0, _MAX_EXPECTED_VERSION)
        or not isinstance(products, list)
        or len(products) > 100
    ):
        raise validation("Check the date, revision and capacity limits.")

    product_limits = []
    for item in products:
        if not _whole_number(item.get("limit"), 0, _MAX_PG_INTEGER):
            raise validation("Product limits must be non-negative whole units.")
        product_limits.append({"productId": uuid(item["productId"]), "limit": int(item["limit"])})
    product_limits.sort(key=lambda item: item["productId"])
    if len({item["productId"] for item in product_limits}) != len(product_limits):
        raise validation("Use one limit per product.")

    return {
        "date": input["date"], "closed": input["closed"], "dayLimit": int(input["dayLimit"]),
        "productLimits": product_limits, "expectedVersion": int(input["expectedVersion"]),
    }


def _project_policy(policy: dict) -> dict:
    return {
        "version": policy["version"], "timezone": "Asia/Kuala_Lumpur",
        "openWeekdays": [WEEKDAYS[day - 1] for day in policy["openWeekdays"]],
        "opensAt": policy["opensAt"], "closesAt": policy["closesAt"],
        "sameDaySubmitCutoff": "18:00", "latestSameDayHandoff": "21:00", "eventRollover": "22:00",
    }


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


class _ImpactSigner:
    def __init__(self, key: bytes):
        if len(key) < 32:
            raise ValueError("Capacity impact signing requires a key of at least 32 bytes.")
        self._key = bytes(key)

    def _sign(self, payload: str, binding: list) -> str:
        return _base64url(hmac.digest(self._key, json_bytes([binding, payload]), "sha256"))

    def encode(self, value, binding: list) -> str:
        payload = _base64url(json_bytes(value))
        return f"{payload}.{self._sign(payload, binding)}"

    def decode(self, token: str, binding: list):
        if not isinstance(token, str) or len(token) > 600 or not _SIGNED_VALUE.fullmatch(token):
            return None
        payload, signature = token.split(".")
        if not hmac.compare_digest(signature, self._sign(payload, binding)):
            return None
        try:
            return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        except ValueError:
            raise validation("Invalid capacity preview value.") from None


class CapacityService:
    def __init__(self, db: Database, impact_key: bytes, *, clock: CapacityClock | None = utc_now):
        self._db = db
        self._signer = _ImpactSigner(impact_key)
        # Production keeps the PostgreSQL clock's precision at the guarded decision point.
        self._clock = None if clock is utc_now else clock

    def evaluate_availability(self, actor: CapacityActor | None, input: dict) -> dict:
        require_role(actor, "CUSTOMER")
        handoff = input.get("requestedHandoffAt")
        day = myt_date(handoff)
        items = input.get("items")
        if input.get("fulfilment") not in FULFILMENT_MODES or not isinstance(items, list) or not 1 <= len(items) <= 100:
            raise validation("Check the handoff and selected items.")
        selections = []
        for item in items:
            if not _whole_number(item.get("quantity"), 1, 999):
                raise validation("Check the item quantities.")
            selections.append({"variantId": uuid(item["variantId"]), "quantity": int(item["quantity"])})

        with self._db.transaction() as conn:
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            evaluated_at = database_time(conn, self._clock)
            variants = read_variants(conn, [item["variantId"] for item in selections])
            units, prep_minutes, sellable = product_demand(selections, variants)
            result = {"eligible": False, "alternatives": [], "evaluatedAt": evaluated_at}
            if not sellable:
                return result

            policy = read_policy(conn)
            today = myt_date(evaluated_at)
            end = add_days(today, 30)
            if is_handoff_eligible(policy, evaluated_at, handoff, prep_minutes):
                requested_day = next(iter(read_days(conn, day, day)), None)
                if requested_day is not None:
                    limits = {row["product_id"]: row for row in read_limits(conn, day, day)}
                    if can_fit_capacity(requested_day, limits, units):
                        return {**result, "eligible": True}

            days = read_days(conn, today, end)
            limits_by_date = defaultdict(dict)
            for row in read_limits(conn, today, end):
                limits_by_date[row["date"]][row["product_id"]] = row
            for available_day in days:
                date = available_day["date"]
                if not can_fit_capacity(available_day, limits_by_date.get(date, {}), units):
                    continue
                alternative = earliest_handoff(policy, evaluated_at, date, prep_minutes)
                if alternative:
                    result["alternatives"].append(alternative)
                if len(result["alternatives"]) == 20:
                    break
            return result

    def get_capacity_calendar(self, actor: CapacityActor | None, start: str, end: str) -> dict:
        require_role(actor, "ADMIN")
        span = date_millis(end) - date_millis(start)
        if not 0 <= span <= 30 * 86_400_000:
            raise validation("Use a calendar range of at most 31 days.")
        with self._db.transaction() as conn:
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            days = read_days(conn, start, end)
            limits = read_limits(conn, start, end)
            windows = calendar_event_windows(conn, start, end)
        return {"days": [
            {
                "date": day["date"], "closed": day["closed"], "version": day["version"],
                "maxUnits": day["max"], "allocatedUnits": day["allocated"],
                "productLimits": [
                    {"productId": row["product_id"], "maxUnits": row["max"], "allocatedUnits": row["allocated"]}
                    for row in limits if row["date"] == day["date"]
                ],
                "eventWindows": windows.get(day["date"], []),
            }
            for day in days
        ]}

    def get_operating_policy(self, actor: CapacityActor | None) -> dict:
        require_role(actor, "ADMIN")
        with self._db.connection() as conn:
            return _project_policy(read_policy(conn))

    def update_operating_policy(self, actor: CapacityActor | None, input: dict, if_match: str,
                                context: CapacityCommand) -> dict:
        actor_id = require_role(actor, "ADMIN")
        expected = _IF_MATCH.fullmatch(if_match)
        version = int(expected[1]) if expected else 0
        weekdays, opens, closes = input.get("openWeekdays"), input.get("opensAt"), input.get("closesAt")
        if (
            not 1 <= version <= _MAX_EXPECTED_VERSION
            or not isinstance(weekdays, list)
            or not 1 <= len(weekdays) <= 7
            or not all(day in WEEKDAYS for day in weekdays)
            or len(set(weekdays)) != len(weekdays)
            or not isinstance(opens, str) or not _HHMM.fullmatch(opens)
            or not isinstance(closes, str) or not _HHMM.fullmatch(closes)
            or closes <= opens
        ):
            raise validation("Check the operating hours, weekdays and policy revision.")

        policy = {
            "openWeekdays": sorted(WEEKDAYS.index(day) + 1 for day in weekdays),
            "opensAt": opens, "closesAt": closes, "version": version + 1,
        }
        with self._db.transaction() as conn:
            def update():
                lock_policy(conn, "exclusive")
                if read_policy(conn)["version"] != version:
                    raise _conflict()
                save_policy(conn, policy)
                audit(conn, actor_id, "UPDATE_OPERATING_POLICY", "00000000-0000-4000-8000-000000000001", context, policy)
                return _project_policy(policy)

            return command(conn, actor_id, "updateOperatingPolicy", context, policy, update)

    def preview_capacity_impact(self, actor: CapacityActor | None, input: dict, context: CapacityCommand,
                                page: dict | None = None) -> dict:
        actor_id = require_role(actor, "ADMIN")
        edit = _normalize_edit(input)
        page = page or {}
        cursor = page.get("cursor")
        limit = page.get("limit")
        if limit is None:
            limit = 25
        if not _whole_number(limit, 1, 100) or (
            "cursor" in page and (not isinstance(cursor, str) or not 1 <= len(cursor) <= 500)
        ):
            raise validation("Check the impact page parameters.")
        limit = int(limit)

        binding = ["capacity-cursor", actor_id, edit]
        anchor = None
        if cursor is not None:
            anchor = self._signer.decode(cursor, binding)
            if not isinstance(anchor, list) or len(anchor) != 2 or not all(isinstance(value, str) for value in anchor):
                raise validation("Use the cursor from this impact preview.")

        with self._db.transaction() as conn:
            def preview():
                check_products(conn, edit, lock=False)
                day = edit["date"]
                lock_capacity_dates(conn, [day])
                now = database_time(conn, self._clock)
                if day < myt_date(now):
                    raise validation("Choose today or a future MYT date.")
                saved = next(iter(read_days(conn, day, day)), None)
                if (saved["version"] if saved else 0) != edit["expectedVersion"]:
                    raise _conflict()
                counts = protected_counts(conn, edit, saved)
                items, count = affected_orders(conn, edit, saved, limit, anchor)
                expires = timestamp_millis(now) + 600_000
                next_cursor = None
                if len(items) > limit:
                    last = items[limit - 1]
                    next_cursor = self._signer.encode([last["createdAt"], last["orderId"]], binding)
                return {
                    "date": day, "expectedVersion": edit["expectedVersion"], **counts, "affectedCount": count,
                    "impactToken": self._signer.encode(expires, ["capacity-confirm", actor_id, edit]),
                    "expiresAt": iso(datetime(1970, 1, 1, tzinfo=UTC) + timedelta(milliseconds=expires)),
                    "items": [{key: value for key, value in item.items() if key != "createdAt"} for item in items[:limit]],
                    "nextCursor": next_cursor,
                }

            return command(conn, actor_id, "previewCapacityImpact", context, [edit, limit, cursor], preview)

    def configure_capacity(self, actor: CapacityActor | None, input: dict, context: CapacityCommand) -> dict:
        actor_id = require_role(actor, "ADMIN")
        edit = _normalize_edit(input)
        token = input.get("impactToken")
        if not isinstance(token, str) or not 1 <= len(token) <= 600:
            raise validation("Provide the impact token for this edit.")

        with self._db.transaction() as conn:
            def configure():
                check_products(conn, edit, lock=True)
                day = edit["date"]
                lock_capacity_dates(conn, [day])
                now = database_time(conn, self._clock)
                expires = self._signer.decode(token, ["capacity-confirm", actor_id, edit])
                saved = next(iter(read_days(conn, day, day)), None)
                if (
                    type(expires) not in (int, float)
                    or timestamp_millis(now) >= expires
                    or day < myt_date(now)
                    or (saved["version"] if saved else 0) != edit["expectedVersion"]
                ):
                    raise _conflict()
                if not protected_counts(conn, edit, saved)["canSave"]:
                    raise Problem("CAPACITY_UNAVAILABLE", 409, "Capacity limits must cover occupied and used units.")
                version = edit["expectedVersion"] + 1
                save_capacity(conn, edit, version)
                resource = "00000000-0000-4000-8000-0000" + day.replace("-", "")
                audit(conn, actor_id, "CONFIGURE_CAPACITY", resource, context, {**edit, "version": version})
                return {"date": day, "version": version}

            return command(conn, actor_id, "configureCapacity", context, [edit, token], configure)
