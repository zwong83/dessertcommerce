from typing import Literal

from fastapi import APIRouter, Request, Response
from starlette.concurrency import run_in_threadpool

from ..http import read_object, require_session
from .template import MAX_REQUEST_BYTES, template_version

InvoiceKind = Literal["booking", "extras"]


def router(service, identity, origin):
    routes = APIRouter()

    @routes.get("/admin/invoice-template")
    def template(request: Request):
        return service.template(require_session(request, identity, origin, "ADMIN"))

    async def update(request, *, publish):
        actor = await run_in_threadpool(require_session, request, identity, origin, "ADMIN", write=True)
        version = template_version(request.headers.get("if-match"))
        body = await read_object(request, ("template",), MAX_REQUEST_BYTES)
        return await run_in_threadpool(service.save_template, actor, body.get("template"), version, publish=publish)

    @routes.put("/admin/invoice-template/draft")
    async def save_draft(request: Request):
        return await update(request, publish=False)

    @routes.post("/admin/invoice-template/publish")
    async def publish_template(request: Request):
        return await update(request, publish=True)

    @routes.post("/admin/invoice-template/preview/{kind}")
    async def preview(request: Request, kind: InvoiceKind):
        actor = await run_in_threadpool(require_session, request, identity, origin, "ADMIN", write=True)
        body = await read_object(request, ("template",), MAX_REQUEST_BYTES)
        pages = await run_in_threadpool(service.preview, actor, body.get("template"), kind)
        return {"pages": pages}

    @routes.get("/events/{event_id}/invoices")
    def list_own(request: Request, event_id: str):
        actor = require_session(request, identity, origin, "CUSTOMER")
        return service.list(actor, event_id, admin=False)

    @routes.get("/admin/events/{event_id}/invoices")
    def list_merchant(request: Request, event_id: str):
        actor = require_session(request, identity, origin, "ADMIN")
        return service.list(actor, event_id, admin=True)

    @routes.post("/admin/events/{event_id}/invoices/{kind}")
    def issue_invoice(request: Request, event_id: str, kind: InvoiceKind):
        actor = require_session(request, identity, origin, "ADMIN", write=True)
        return service.issue_existing(actor, event_id, kind)

    def attachment(request, event_id, kind, *, admin):
        actor = require_session(request, identity, origin, "ADMIN" if admin else "CUSTOMER")
        number, pdf = service.download(actor, event_id, kind, admin=admin)
        return Response(pdf, media_type="application/pdf", headers={
            "Cache-Control": "private, no-store", "Content-Disposition": f'attachment; filename="{number}.pdf"',
        })

    @routes.get("/events/{event_id}/invoices/{kind}/pdf")
    def download_own(request: Request, event_id: str, kind: InvoiceKind):
        return attachment(request, event_id, kind, admin=False)

    @routes.get("/admin/events/{event_id}/invoices/{kind}/pdf")
    def download_merchant(request: Request, event_id: str, kind: InvoiceKind):
        return attachment(request, event_id, kind, admin=True)

    return routes
