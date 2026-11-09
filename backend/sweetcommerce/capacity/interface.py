import re

from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from sweetcommerce.http import field_string, field_uuid, read_object, require_session, validation

from .application import CapacityService
from .domain import FULFILMENT_MODES
from .infrastructure import WEEKDAYS, CapacityCommand

_EDIT_FIELDS = ("date", "closed", "dayLimit", "productLimits", "expectedVersion")


def _query(request: Request, key: str) -> str | None:
    return next(iter(request.query_params.getlist(key)), None)


def _pair(value, first: str, second: str) -> tuple:
    if not isinstance(value, dict) or value.keys() != {first, second}:
        raise validation("Check the submitted fields.")
    return value[first], value[second]


def _array(value) -> list:
    if not isinstance(value, list) or len(value) > 100:
        raise validation("Check the submitted list.")
    return value


def _command(request: Request) -> CapacityCommand:
    return CapacityCommand(
        idempotency_key=field_uuid(request.headers.get("idempotency-key"), "the request key"),
        request_id=request.state.request_id,
    )


async def _read_edit(request: Request, *, confirm: bool) -> dict:
    fields = (*_EDIT_FIELDS, "impactToken") if confirm else _EDIT_FIELDS
    body = await read_object(request, fields)
    closed, day_limit, version = body.get("closed"), body.get("dayLimit"), body.get("expectedVersion")
    if type(closed) is not bool or type(day_limit) not in (int, float) or type(version) not in (int, float):
        raise validation("Check the date, revision and capacity limits.")
    limits = []
    for entry in _array(body.get("productLimits")):
        product, limit = _pair(entry, "productId", "limit")
        if type(limit) not in (int, float):
            raise validation("Enter a product limit.")
        limits.append({"productId": field_uuid(product, "the product"), "limit": limit})

    edit = {
        "date": field_string(body.get("date"), "the date", max_length=10),
        "closed": closed, "dayLimit": day_limit, "expectedVersion": version, "productLimits": limits,
    }
    if confirm:
        edit["impactToken"] = field_string(body.get("impactToken"), "the impact token", max_length=600)
    return edit


def router(service: CapacityService, identity, origin: str) -> APIRouter:
    routes = APIRouter()

    @routes.get("/admin/operating-policy")
    def get_operating_policy(request: Request):
        actor = require_session(request, identity, origin, "ADMIN")
        return service.get_operating_policy(actor)

    @routes.get("/admin/capacity-calendar")
    def get_capacity_calendar(request: Request):
        actor = require_session(request, identity, origin, "ADMIN")
        start = field_string(_query(request, "from"), "the start date", max_length=10)
        end = field_string(_query(request, "to"), "the end date", max_length=10)
        return service.get_capacity_calendar(actor, start, end)

    @routes.post("/availability")
    async def evaluate_availability(request: Request):
        actor = await run_in_threadpool(require_session, request, identity, origin, "CUSTOMER", write=True)
        body = await read_object(request, ("items", "requestedHandoffAt", "fulfilment"))
        fulfilment = body.get("fulfilment")
        if fulfilment not in FULFILMENT_MODES:
            raise validation("Choose a fulfilment mode.")
        items = []
        for entry in _array(body.get("items")):
            variant, quantity = _pair(entry, "variantId", "quantity")
            if type(quantity) not in (int, float):
                raise validation("Enter an item quantity.")
            items.append({"variantId": field_uuid(variant, "the variant"), "quantity": quantity})
        return await run_in_threadpool(service.evaluate_availability, actor, {
            "items": items, "fulfilment": fulfilment,
            "requestedHandoffAt": field_string(body.get("requestedHandoffAt"), "the handoff time"),
        })

    @routes.put("/admin/operating-policy")
    async def update_operating_policy(request: Request):
        actor = await run_in_threadpool(require_session, request, identity, origin, "ADMIN", write=True)
        context = _command(request)
        body = await read_object(request, ("openWeekdays", "opensAt", "closesAt"))
        weekdays = body.get("openWeekdays")
        if not isinstance(weekdays, list) or not all(day in WEEKDAYS for day in weekdays):
            raise validation("Check the operating weekdays.")
        policy = {
            "openWeekdays": weekdays,
            "opensAt": field_string(body.get("opensAt"), "the opening time", max_length=5),
            "closesAt": field_string(body.get("closesAt"), "the closing time", max_length=5),
        }
        return await run_in_threadpool(
            service.update_operating_policy, actor, policy, request.headers.get("if-match", ""), context,
        )

    @routes.post("/admin/capacity/preview")
    async def preview_capacity(request: Request):
        actor = await run_in_threadpool(require_session, request, identity, origin, "ADMIN", write=True)
        context = _command(request)
        edit = await _read_edit(request, confirm=False)
        page = {}
        limit = _query(request, "limit")
        if limit is not None:
            if not re.fullmatch(r"[0-9]+", limit):
                raise validation("Enter an impact page size from 1 to 100.")
            # Ignore leading zeroes, and let the service reject out-of-range values.
            digits = limit.lstrip("0")
            page["limit"] = 101 if len(digits) > 3 else int(digits or "0")
        cursor = _query(request, "cursor")
        if cursor is not None:
            page["cursor"] = cursor
        return await run_in_threadpool(service.preview_capacity_impact, actor, edit, context, page)

    @routes.put("/admin/capacity")
    async def configure_capacity(request: Request):
        actor = await run_in_threadpool(require_session, request, identity, origin, "ADMIN", write=True)
        context = _command(request)
        edit = await _read_edit(request, confirm=True)
        return await run_in_threadpool(service.configure_capacity, actor, edit, context)

    return routes
