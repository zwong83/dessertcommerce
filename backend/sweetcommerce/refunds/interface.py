from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from ..capacity.infrastructure import CapacityCommand
from ..http import field_uuid, read_object, require_session
from .application import RefundService
from .domain import POST_FIELDS, RECONCILE_FIELDS, RESERVE_FIELDS


def router(service: RefundService, identity, origin: str) -> APIRouter:
    routes = APIRouter()

    async def run(request, handler, target_id, fields):
        actor = await run_in_threadpool(require_session, request, identity, origin, "ADMIN", write=True)
        context = CapacityCommand(
            field_uuid(request.headers.get("idempotency-key"), "the request key"),
            request.state.request_id,
        )
        body = await read_object(request, fields)
        return await run_in_threadpool(handler, actor, target_id, body, context)

    @routes.post("/admin/charges/{chargeId}/refund-intents", operation_id="reserveRefund")
    async def reserve(request: Request, chargeId: str):
        return await run(request, service.reserve_refund, chargeId, RESERVE_FIELDS)

    @routes.post("/admin/charges/{chargeId}/refunds", operation_id="recordRefund")
    async def post(request: Request, chargeId: str):
        return await run(request, service.record_refund, chargeId, POST_FIELDS)

    @routes.post("/admin/refund-intents/{refundIntentId}/reconcile", operation_id="reconcileRefundIntent")
    async def reconcile(request: Request, refundIntentId: str):
        return await run(request, service.reconcile_refund_intent, refundIntentId, RECONCILE_FIELDS)

    return routes
