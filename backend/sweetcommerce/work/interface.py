from fastapi import APIRouter, Request

from ..http import require_session


def router(service, identity, origin):
    routes = APIRouter()

    @routes.get("/admin/work")
    def merchant_work(request: Request):
        actor = require_session(request, identity, origin, "ADMIN")
        query = request.query_params
        return service.list(actor, limit=query.get("limit"), cursor=query.get("cursor"), kind=query.get("kind"),
                            status=query.get("status"), service_date=query.get("serviceDate"))

    return routes
