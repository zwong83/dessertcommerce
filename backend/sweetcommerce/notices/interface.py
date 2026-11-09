from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from ..capacity.infrastructure import CapacityCommand
from ..http import field_uuid, read_object, require_session
from .application import NoticeService


def router(service: NoticeService, identity, origin: str) -> APIRouter:
    routes = APIRouter()

    @routes.get("/admin/notices/{noticeId}", operation_id="getMerchantNotice")
    def get_notice(request: Request, noticeId: str):
        actor = require_session(request, identity, origin, "ADMIN")
        return service.get(actor, noticeId)

    @routes.post("/admin/notices/{noticeId}/resolve", operation_id="resolveNotificationFailure")
    async def resolve_notice(request: Request, noticeId: str):
        actor = await run_in_threadpool(require_session, request, identity, origin, "ADMIN", write=True)
        context = CapacityCommand(field_uuid(request.headers.get("idempotency-key"), "the request key"), request.state.request_id)
        body = await read_object(request, ("disposition", "reason"))
        return await run_in_threadpool(service.resolve, actor, noticeId, body, context)

    return routes
