from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from ..capacity.infrastructure import CapacityCommand
from ..http import field_uuid, read_object, require_session
from ..problems import Problem
from ..values import UUID_PATTERN
from .application import FulfilmentService
from .domain import (
    ACTION_FIELDS, ADJUSTMENT_FIELDS, CANCEL_FIELDS, CONFIRM_FIELDS, QUOTE_FIELDS, RESCHEDULE_FIELDS, parse_version,
)


def router(service: FulfilmentService, identity, origin: str) -> APIRouter:
    routes = APIRouter()

    @routes.get("/orders", operation_id="listOwnOrders")
    def list_orders(request: Request):
        actor = require_session(request, identity, origin, "CUSTOMER")
        raw_limit = request.query_params.get("limit", "25")
        if not 1 <= len(raw_limit) <= 3 or not raw_limit.isascii() or not raw_limit.isdecimal() or not 1 <= int(raw_limit) <= 100:
            raise Problem("VALIDATION", 400, "Choose a page limit between 1 and 100.")
        return service.list_own_orders(actor, request.query_params.get("cursor"), int(raw_limit))

    @routes.get("/admin/orders/{order_id}", operation_id="getMerchantOrder")
    def merchant_order(request: Request, order_id: str):
        actor = require_session(request, identity, origin, "ADMIN")
        if not UUID_PATTERN.fullmatch(order_id):
            raise Problem("VALIDATION", 400, "Use a valid order identifier.")
        return service.get_merchant_order(actor, order_id)

    async def mutate(request, order_id, role, fields, apply):
        actor = await run_in_threadpool(require_session, request, identity, origin, role, write=True)
        context = CapacityCommand(field_uuid(request.headers.get("idempotency-key"), "the request key"), request.state.request_id)
        version = parse_version(request.headers.get("if-match", ""))
        body = await read_object(request, fields)
        return await run_in_threadpool(apply, actor, field_uuid(order_id, "the order"), version, body, context)

    @routes.post("/orders/{order_id}/confirm-fee", operation_id="confirmDeliveryFee")
    async def confirm_fee(request: Request, order_id: str):
        return await mutate(request, order_id, "CUSTOMER", CONFIRM_FIELDS, service.confirm_delivery_fee)

    @routes.post("/orders/{order_id}/cancel", operation_id="cancelOwnOrder")
    async def cancel(request: Request, order_id: str):
        return await mutate(request, order_id, "CUSTOMER", CANCEL_FIELDS, service.cancel_own_order)

    @routes.post("/admin/orders/{order_id}/fee", operation_id="quoteDeliveryFee")
    async def fee(request: Request, order_id: str):
        return await mutate(request, order_id, "ADMIN", QUOTE_FIELDS, service.quote_delivery_fee)

    @routes.post("/admin/orders/{order_id}/actions", operation_id="changeStandardOrder")
    async def action(request: Request, order_id: str):
        return await mutate(request, order_id, "ADMIN", ACTION_FIELDS, service.change_standard_order)

    @routes.post("/admin/orders/{order_id}/reschedule", operation_id="rescheduleStandardOrder")
    async def reschedule(request: Request, order_id: str):
        return await mutate(request, order_id, "ADMIN", RESCHEDULE_FIELDS, service.reschedule_standard_order)

    @routes.post("/admin/orders/{order_id}/delivery-adjustments", operation_id="createDeliveryAdjustment")
    async def adjustment(request: Request, order_id: str):
        return await mutate(request, order_id, "ADMIN", ADJUSTMENT_FIELDS, service.create_delivery_adjustment)

    return routes
