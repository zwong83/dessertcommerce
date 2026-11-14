import re

from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from ..capacity.domain import uuid
from ..capacity.infrastructure import CapacityCommand
from ..http import read_object, require_session, validation
from . import domain


def router(service, identity, origin):
    routes = APIRouter()

    @routes.post("/events", status_code=201)
    async def submit_event(request: Request):
        actor = await run_in_threadpool(require_session, request, identity, origin, "CUSTOMER", write=True)
        body = await read_object(request, domain.REQUEST_FIELDS)
        return await run_in_threadpool(service.submit_event_request, actor, body, _context(request))

    @routes.get("/events")
    def list_events(request: Request):
        actor = require_session(request, identity, origin, "CUSTOMER")
        limit = request.query_params.get("limit", "25")
        if not re.fullmatch(r"[0-9]{1,3}", limit):
            raise validation("Use a page size from 1 to 100.")
        return service.list_own_events(actor, int(limit), request.query_params.get("cursor"))

    @routes.get("/events/{event_id}")
    def own_event(request: Request, event_id: str):
        return service.get_own_event(require_session(request, identity, origin, "CUSTOMER"), event_id)

    @routes.get("/admin/events/{event_id}")
    def merchant_event(request: Request, event_id: str):
        return service.get_merchant_event(require_session(request, identity, origin, "ADMIN"), event_id)

    async def mutate(request, event_id, method, fields, role):
        actor = await run_in_threadpool(require_session, request, identity, origin, role, write=True)
        expected = domain.revision(request.headers.get("if-match"))
        body = await read_object(request, fields)
        return await run_in_threadpool(method, actor, event_id, body, expected, _context(request))

    @routes.post("/admin/events/{event_id}/quotes")
    async def issue_quote(request: Request, event_id: str):
        return await mutate(request, event_id, service.issue_event_quote, domain.QUOTE_FIELDS + domain.QUOTE_BILLING_FIELDS, "ADMIN")

    @routes.post("/events/{event_id}/accept-quote")
    async def accept_quote(request: Request, event_id: str):
        return await mutate(request, event_id, service.accept_event_quote, domain.ACCEPT_FIELDS, "CUSTOMER")

    @routes.post("/events/{event_id}/cancel")
    async def cancel_event(request: Request, event_id: str):
        return await mutate(request, event_id, service.cancel_event_request, ("noTransferSent",), "CUSTOMER")

    @routes.post("/admin/events/{event_id}/actions")
    async def change_booking(request: Request, event_id: str):
        return await mutate(request, event_id, service.change_event_booking, domain.ACTION_FIELDS, "ADMIN")

    @routes.post("/admin/events/{event_id}/reschedule")
    async def reschedule_booking(request: Request, event_id: str):
        return await mutate(request, event_id, service.reschedule_event_booking, domain.RESCHEDULE_FIELDS, "ADMIN")

    return routes


def _context(request):
    return CapacityCommand(uuid(request.headers.get("idempotency-key")), request.state.request_id)
