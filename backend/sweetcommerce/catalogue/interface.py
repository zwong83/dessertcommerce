"""The versioned catalogue HTTP routes."""

import re

from fastapi import APIRouter, Request, Response
from fastapi.concurrency import run_in_threadpool

from sweetcommerce.http import field_uuid, read_object, require_session
from sweetcommerce.problems import Problem, validation

from .application import CatalogueService
from .domain import MAX_PHOTO_BYTES, MAX_SAFE_INTEGER, TRANSITIONS, WHITESPACE, CatalogueCommand

_IF_MATCH = re.compile(r'"([1-9][0-9]{0,15})"')
_DECIMAL = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
_BASES = {"x": (16, r"[0-9a-f]+"), "o": (8, r"[0-7]+"), "b": (2, r"[01]+")}


def _query_limit(value):
    if value is None:
        return None
    value = value.strip(WHITESPACE)
    if _DECIMAL.fullmatch(value):
        return float(value)
    if len(value) > 2 and value[0] == "0" and value[1].lower() in _BASES:
        radix, pattern = _BASES[value[1].lower()]
        if re.fullmatch(pattern, value[2:].lower()):
            return int(value[2:], radix)
    return 0


def _command(request: Request) -> CatalogueCommand:
    key = field_uuid(request.headers.get("idempotency-key"), "the request key")
    return CatalogueCommand(key, request.state.request_id)


def _version(request: Request) -> int:
    match = _IF_MATCH.fullmatch(request.headers.get("if-match", ""))
    if match is None or int(match[1]) > MAX_SAFE_INTEGER:
        raise validation("Refresh the product version.")
    return int(match[1])


async def _image_bytes(request: Request) -> bytes:
    media = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if media != "application/octet-stream":
        raise Problem("UNSUPPORTED_MEDIA", 415, "Upload the photo as binary data.")
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_PHOTO_BYTES:
            raise Problem("PAYLOAD_TOO_LARGE", 413, "Photo must be at most 5 MiB.")
        data.extend(chunk)
    if not data and request.headers.get("content-length") == "0":
        raise validation("Choose a photo.")
    return bytes(data)


def _photo_response(photo):
    return Response(photo.bytes, media_type=photo.media_type, headers={"X-Content-Type-Options": "nosniff"})


def router(service: CatalogueService, identity, origin: str) -> APIRouter:
    api = APIRouter()

    @api.get("/catalog")
    def list_catalog(request: Request):
        actor = require_session(request, identity, origin, "CUSTOMER")
        query = dict(reversed(request.query_params.multi_items()))
        return service.list_catalog(
            actor, limit=_query_limit(query.get("limit")), cursor=query.get("cursor"), category=query.get("category"),
        )

    @api.get("/catalog/products/{product_id}")
    def listed_product(request: Request, product_id: str):
        actor = require_session(request, identity, origin, "CUSTOMER")
        return service.get_listed_product(actor, product_id)

    @api.get("/catalog/media/{media_id}")
    def listed_photo(request: Request, media_id: str):
        actor = require_session(request, identity, origin, "CUSTOMER")
        return _photo_response(service.get_listed_product_photo(actor, media_id))

    @api.get("/admin/products")
    def list_merchant_products(request: Request):
        actor = require_session(request, identity, origin, "ADMIN")
        query = dict(reversed(request.query_params.multi_items()))
        status = query.get("status")
        if status is not None and status not in TRANSITIONS:
            raise validation("Choose a product status.")
        return service.list_merchant_products(actor, limit=_query_limit(query.get("limit")), cursor=query.get("cursor"), status=status)

    @api.get("/admin/products/{product_id}")
    def merchant_product(request: Request, product_id: str):
        actor = require_session(request, identity, origin, "ADMIN")
        return service.get_merchant_product(actor, product_id)

    @api.get("/admin/products/{product_id}/media/{media_id}")
    def merchant_photo(request: Request, product_id: str, media_id: str):
        actor = require_session(request, identity, origin, "ADMIN")
        return _photo_response(service.get_merchant_product_photo(actor, product_id, media_id))

    @api.post("/admin/products", status_code=201)
    async def create_product(request: Request):
        actor = await run_in_threadpool(require_session, request, identity, origin, "ADMIN", write=True)
        command = _command(request)
        body = await read_object(request, ["name", "category"])
        return await run_in_threadpool(service.create_product, actor, body, command)

    @api.put("/admin/products/{product_id}")
    async def update_product(request: Request, product_id: str):
        actor = await run_in_threadpool(require_session, request, identity, origin, "ADMIN", write=True)
        command = _command(request)
        version = _version(request)
        body = await read_object(request, ["name", "status", "variants", "imageRefs", "category"], 96_000)
        return await run_in_threadpool(service.update_product, actor, product_id, version, body, command)

    @api.post("/admin/products/{product_id}/media", status_code=201)
    async def upload_photo(request: Request, product_id: str):
        actor = await run_in_threadpool(require_session, request, identity, origin, "ADMIN", write=True)
        command = _command(request)
        data = await _image_bytes(request)
        declared_type = request.headers.get("x-file-media-type", "")
        return await run_in_threadpool(service.upload_product_photo, actor, product_id, declared_type, data, command)

    return api
