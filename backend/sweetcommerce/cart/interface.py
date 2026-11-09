import re

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool

from ..http import field_uuid, read_object, require_session, validation
from ..identity import IdentityService
from .application import INVALID_QUANTITY, CartService

_VERSION = re.compile(r'"([1-9][0-9]{0,17})"')


def router(service: CartService, identity: IdentityService, origin: str) -> APIRouter:
    api = APIRouter()

    @api.get("/cart")
    def get_cart(request: Request):
        return service.get(require_session(request, identity, origin, "CUSTOMER"))

    @api.put("/cart/items/{variant_id}")
    async def set_quantity(request: Request, variant_id: str):
        principal = await run_in_threadpool(require_session, request, identity, origin, "CUSTOMER", write=True)
        body = await read_object(request, ["quantity"])
        quantity = body.get("quantity")
        if type(quantity) not in (int, float):
            raise validation(INVALID_QUANTITY)
        variant = field_uuid(variant_id, "the selected variant")
        key = field_uuid(request.headers.get("idempotency-key"), "the request key")
        version = _VERSION.fullmatch(request.headers.get("if-match", ""))
        if version is None:
            raise validation("Refresh the cart version.")
        return await run_in_threadpool(
            service.set_quantity,
            principal,
            variant_id=variant,
            quantity=quantity,
            idempotency_key=key,
            expected_version=version[1],
        )

    return api
