from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from ..capacity.infrastructure import CapacityCommand
from ..http import field_string, field_uuid, read_object, require_session
from .application import OrderService
from .input import CHECKOUT_FIELDS, SUBMIT_FIELDS


def router(service: OrderService, identity, origin: str) -> APIRouter:
    routes = APIRouter()

    def command_context(request: Request) -> CapacityCommand:
        return CapacityCommand(
            field_uuid(request.headers.get("idempotency-key"), "the request key"),
            request.state.request_id,
        )

    @routes.post("/checkout/review")
    async def review(request: Request):
        actor = await run_in_threadpool(require_session, request, identity, origin, "CUSTOMER", write=True)
        body = await read_object(request, CHECKOUT_FIELDS)
        return await run_in_threadpool(service.review_checkout, actor, body)

    @routes.post("/orders", status_code=201)
    async def submit(request: Request):
        actor = await run_in_threadpool(require_session, request, identity, origin, "CUSTOMER", write=True)
        context = command_context(request)
        body = await read_object(request, SUBMIT_FIELDS)
        return await run_in_threadpool(service.submit_order, actor, body, context)

    @routes.get("/checkout/reviews/{review_id}/outcome")
    def outcome(request: Request, review_id: str):
        actor = require_session(request, identity, origin, "CUSTOMER")
        return service.get_checkout_outcome(actor, field_uuid(review_id, "the review"))

    @routes.post("/checkout/reviews/{review_id}/abandon")
    def abandon(request: Request, review_id: str):
        actor = require_session(request, identity, origin, "CUSTOMER", write=True)
        context = command_context(request)
        return service.abandon_or_resolve_checkout(actor, field_uuid(review_id, "the review"), context)

    @routes.get("/orders/{order_id}")
    def detail(request: Request, order_id: str):
        actor = require_session(request, identity, origin, "CUSTOMER")
        return service.get_own_order(actor, field_uuid(order_id, "the order"))

    @routes.get("/commands/{idempotency_key}")
    def command(request: Request, idempotency_key: str):
        actor = require_session(request, identity, origin, "CUSTOMER")
        operations = request.query_params.getlist("operation")
        operation = field_string(operations[0] if operations else None, "the command operation", max_length=80)
        return service.get_own_command_outcome(actor, operation, field_uuid(idempotency_key, "the request key"))

    return routes
