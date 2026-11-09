import hmac
import logging
from contextlib import asynccontextmanager
from uuid import uuid4

import psycopg
from fastapi import FastAPI, Request
from psycopg_pool import PoolTimeout
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

from .db import Database
from .problems import Problem, unavailable
from .runtime import Settings

logger = logging.getLogger(__name__)


def _problem_response(request: Request, problem: Problem):
    body = {
        "code": problem.code,
        "message": str(problem),
        "requestId": request.state.request_id,
        "retryable": problem.status in (429, 503),
    }
    if field_errors := getattr(problem, "field_errors", None):
        body["fieldErrors"] = field_errors
    headers = {}
    if problem.retry_after is not None:
        headers["Retry-After"] = str(problem.retry_after)
    return JSONResponse(body, status_code=problem.status, media_type="application/problem+json", headers=headers)


def create_app(settings: Settings | None = None, *, database=None, clock=None, delivery=None, objects=None):
    from .capacity import interface as capacity
    from .capacity.application import CapacityService
    from .cart import interface as cart
    from .cart.application import CartService
    from .catalogue import interface as catalogue
    from .catalogue.application import CatalogueService
    from .identity import interface as identity
    from .identity.application import IdentityService
    from .notices import interface as notices
    from .notices.application import NoticeService
    from .events import interface as events
    from .events.application import EventService
    from .fulfilment import interface as fulfilment
    from .fulfilment.application import FulfilmentService
    from .order import interface as order
    from .order.application import OrderService
    from .proofs import interface as proofs
    from .proofs.application import ProofService
    from .refunds import interface as refunds
    from .refunds.application import RefundService
    from .settlement import interface as settlement
    from .settlement.application import SettlementService
    from .reporting import interface as reporting
    from .reporting.application import ReportService
    from .work import interface as work
    from .work.application import WorkService

    settings = settings if settings is not None else Settings.from_environment()
    db = database if database is not None else Database(settings.dsn, max_size=settings.pool_size)

    @asynccontextmanager
    async def lifespan(_app):
        if database is None:
            db.open()
        try:
            yield
        finally:
            if database is None:
                db.close()

    # The reviewed OpenAPI contract in output/SD is the public source of truth.
    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False)

    @app.middleware("http")
    async def response_metadata(request, call_next):
        request.state.request_id = str(uuid4())
        try:
            response = await call_next(request)
        except (psycopg.OperationalError, PoolTimeout):
            response = _problem_response(request, unavailable())
        except Exception as exc:
            logger.error("feature=api outcome=failed request_id=%s error_type=%s", request.state.request_id, type(exc).__name__)
            response = _problem_response(request, Problem("INTERNAL", 500, "Something went wrong."))
        if response.headers.get("Cache-Control") != "private, no-store":
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Request-Id"] = request.state.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(Problem)
    async def application_problem(request, error):
        return _problem_response(request, error)

    @app.exception_handler(HTTPException)
    async def unmatched_route(request, error):
        return _problem_response(request, Problem("NOT_FOUND", 404, "This resource was not found."))

    def key(purpose: bytes) -> bytes:
        return hmac.digest(settings.identity_key, purpose, "sha256")

    objects = objects if objects is not None else settings.private_objects()
    delivery = delivery if delivery is not None else settings.otp_delivery()

    @app.get("/internal/live", include_in_schema=False)
    def liveness():
        return {"status": "live"}

    @app.get("/internal/ready", include_in_schema=False)
    def readiness():
        with db.connection() as connection:
            migrated = connection.execute(
                """SELECT to_regclass('sweetcommerce.event_application') IS NOT NULL
                    AND to_regprocedure('sweetcommerce.notice_recipient(uuid,uuid)') IS NOT NULL AS ready"""
            ).fetchone()["ready"]
        if not migrated:
            raise unavailable()
        return {"status": "ready"}

    def synthetic_code():
        return settings.synthetic_otp

    clock_args = {} if clock is None else {"clock": clock}
    identity_service = IdentityService(
        db, settings.identity_key, delivery,
        new_code=synthetic_code if settings.synthetic_otp else None,
        global_send_limit=settings.send_budget, **clock_args,
    )
    app.include_router(identity.router(identity_service, settings.origin), prefix="/api/v1")
    for module, service in (
        (cart, CartService(db, **clock_args)),
        (catalogue, CatalogueService(db, objects, **clock_args)),
        (capacity, CapacityService(db, key(b"capacity-impact-v1"), **clock_args)),
        (order, OrderService(db, settings.terms, settings.pickup_display, duitnow_qr_url=settings.duitnow_qr_url, whatsapp_url=settings.whatsapp_url, **clock_args)),
        (fulfilment, FulfilmentService(db, settings.duitnow_qr_url, settings.whatsapp_url, terms=settings.terms, **clock_args)),
        (events, EventService(db, terms=settings.terms, duitnow_qr_url=settings.duitnow_qr_url,
                              whatsapp_url=settings.whatsapp_url, **clock_args)),
        (notices, NoticeService(db, **clock_args)),
        (reporting, ReportService(db)),
        (proofs, ProofService(db, objects, **clock_args)),
        (refunds, RefundService(db)),
        (settlement, SettlementService(db, **clock_args)),
        (work, WorkService(db)),
    ):
        app.include_router(module.router(service, identity_service, settings.origin), prefix="/api/v1")

    return app
