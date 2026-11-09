from fastapi import APIRouter, Request

from ..http import require_session


def router(service, identity, origin):
    routes = APIRouter()

    @routes.get("/admin/reports")
    def merchant_report(request: Request):
        actor = require_session(request, identity, origin, "ADMIN")
        query = request.query_params
        return service.report(actor, query.get("from"), query.get("to"), query.get("orderStatus"))

    return routes
