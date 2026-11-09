"""Catalogue use cases and their transaction boundaries."""

from collections.abc import Callable
from hashlib import sha256
from typing import Protocol
from uuid import uuid4

from sweetcommerce.clock import utc_now
from sweetcommerce.db import Database, iso
from sweetcommerce.problems import Problem

from . import infrastructure as store
from .domain import (
    CatalogueCommand,
    CataloguePhoto,
    CommandIdentity,
    Principal,
    catalogue_filter,
    encode_cursor,
    expected_version,
    identify_command,
    merchant_filter,
    missing_category,
    missing_photo,
    missing_product,
    page_bounds,
    path_id,
    product_category,
    product_name,
    require_photo_staging,
    require_role,
    require_transition,
    unreadable_photo,
    validate_photo,
    validate_update,
)
from .infrastructure import sanitize_image


class CatalogueObjectStore(Protocol):
    def put(self, key: str, data: bytes) -> None: ...

    def get(self, key: str) -> bytes | None: ...


def storage_unavailable():
    return Problem("DEPENDENCY_UNAVAILABLE", 503, "Photo storage is temporarily unavailable.")


class CatalogueService:
    def __init__(
        self,
        db: Database,
        objects: CatalogueObjectStore,
        sanitizer: Callable[[bytes, str], bytes | None] = sanitize_image,
        *,
        clock=utc_now,
    ):
        self._db = db
        self._objects = objects
        self._sanitize = sanitizer
        self._clock = clock

    def list_catalog(self, principal: Principal | None, *, limit=None, cursor=None, category=None):
        require_role(principal, "CUSTOMER")
        return self._list_products(True, catalogue_filter(category), limit, cursor)

    def list_merchant_products(self, principal: Principal | None, *, limit=None, cursor=None, status=None):
        require_role(principal, "ADMIN")
        return self._list_products(False, merchant_filter(status), limit, cursor)

    def _list_products(self, storefront, filter_value, limit, cursor):
        limit, after, prefix = page_bounds(limit, cursor, storefront, filter_value)
        with self._db.connection() as conn:
            records = store.list_products(conn, storefront, filter_value, after, limit + 1)
        items = [store.as_product(row) for row in records[:limit]]
        next_cursor = encode_cursor(prefix, items[-1]["id"]) if len(records) > limit else None
        return {"items": items, "nextCursor": next_cursor}

    def get_listed_product(self, principal: Principal | None, product_id: str):
        require_role(principal, "CUSTOMER")
        product_id = path_id(product_id, missing_product)
        with self._db.connection() as conn:
            return store.read_product(conn, product_id, True)

    def get_merchant_product(self, principal: Principal | None, product_id: str):
        require_role(principal, "ADMIN")
        product_id = path_id(product_id, missing_product)
        with self._db.connection() as conn:
            return store.read_product(conn, product_id, False)

    def create_product(self, principal: Principal | None, body: dict, command: CatalogueCommand):
        actor_id = require_role(principal, "ADMIN")
        body = body if isinstance(body, dict) else {}
        name = product_name(body.get("name"))
        category = product_category(body.get("category"))
        identity = identify_command(actor_id, "createProduct", command, {"name": name, "category": category})

        def create(conn, timestamp):
            product_id = str(uuid4())
            store.insert_draft(conn, product_id, name, category)
            product = store.read_product(conn, product_id, False)
            store.audit(conn, identity, product_id, {"status": product["status"], "version": product["version"]}, timestamp)
            return product

        return self._run_command(identity, create)

    def update_product(self, principal: Principal | None, product_id: str, version: int, body: dict, command: CatalogueCommand):
        actor_id = require_role(principal, "ADMIN")
        product_id = path_id(product_id, missing_product)
        version = expected_version(version)
        edit = validate_update(body if isinstance(body, dict) else {})
        identity = identify_command(actor_id, "updateProduct", command, {
            "productId": product_id, "expected": version, "edit": edit,
        })

        def update(conn, timestamp):
            before = store.product_state(conn, product_id, lock=True)
            if before["version"] != version:
                raise Problem("VERSION_CONFLICT", 409, "This product changed. Refresh before saving.")
            status = edit["status"]
            require_transition(before["status"], status)
            category = edit.get("category", before["category"])
            if status == "LISTED" and category is None:
                raise missing_category()
            store.save_variants(conn, product_id, edit["variants"])
            store.save_gallery(conn, product_id, edit["imageRefs"], timestamp)
            store.update_product(conn, product_id, edit["name"], category, status)
            product = store.read_product(conn, product_id, False)
            store.audit(conn, identity, product_id, {
                "previousStatus": before["status"],
                "status": product["status"],
                "version": product["version"],
                "photoCount": len(product["imageRefs"]),
            }, timestamp)
            return product

        return self._run_command(identity, update)

    def upload_product_photo(
        self, principal: Principal | None, product_id: str, declared_type: str, data: bytes, command: CatalogueCommand,
    ):
        actor_id = require_role(principal, "ADMIN")
        product_id = path_id(product_id, missing_product)
        validate_photo(data, declared_type)
        original = bytes(data)
        identity = identify_command(actor_id, "uploadProductPhoto", command, {
            "productId": product_id, "mediaType": declared_type, "byteDigest": sha256(original).hexdigest(),
        })
        with self._db.connection() as conn:
            replay = store.command_receipt(conn, identity)
            if replay is not None:
                return replay
            require_photo_staging(store.product_state(conn, product_id)["status"])

        try:
            decoded = self._sanitize(original, declared_type)
        except Exception as exc:
            raise Problem("DEPENDENCY_UNAVAILABLE", 503, "Photo processing is temporarily unavailable.") from exc
        if decoded is None:
            raise unreadable_photo()
        validate_photo(decoded, declared_type)
        normalized = bytes(decoded)
        media_id = str(uuid4())
        object_key = f"catalogue/{product_id}/{media_id}"
        content_digest = sha256(normalized).digest()
        try:
            self._objects.put(object_key, normalized)
        except Exception as exc:
            raise storage_unavailable() from exc

        # Storage reconciliation owns unlinked objects from failed or competing writes.
        def stage(conn, timestamp):
            require_photo_staging(store.product_state(conn, product_id, lock=True)["status"])
            store.stage_photo(conn, product_id, media_id, object_key, content_digest, len(normalized), declared_type, timestamp)
            store.audit(conn, identity, product_id, {"mediaId": media_id, "state": "STAGED"}, timestamp)
            return {
                "id": media_id,
                "productId": product_id,
                "state": "STAGED",
                "byteCount": len(normalized),
                "mediaType": declared_type,
                "createdAt": iso(timestamp),
            }

        return self._run_command(identity, stage)

    def get_merchant_product_photo(self, principal: Principal | None, product_id: str, media_id: str):
        require_role(principal, "ADMIN")
        product_id = path_id(product_id, missing_photo)
        media_id = path_id(media_id, missing_photo)
        with self._db.connection() as conn:
            row = store.merchant_photo(conn, product_id, media_id)
        return self._read_photo(row)

    def get_listed_product_photo(self, principal: Principal | None, media_id: str):
        require_role(principal, "CUSTOMER")
        media_id = path_id(media_id, missing_photo)
        with self._db.connection() as conn:
            row = store.listed_photo(conn, media_id)
        return self._read_photo(row)

    def _read_photo(self, row):
        if row is None:
            raise missing_photo()
        try:
            data = self._objects.get(row["object_key"])
        except Exception as exc:
            raise storage_unavailable() from exc
        if data is None or len(data) != row["byte_count"] or sha256(data).digest() != row["content_digest"]:
            raise storage_unavailable()
        return CataloguePhoto(data, row["media_type"])

    def _run_command(self, identity: CommandIdentity, work):
        with self._db.transaction() as conn:
            store.lock_command(conn, identity)
            replay = store.command_receipt(conn, identity)
            if replay is not None:
                return replay
            timestamp = self._clock()
            result = work(conn, timestamp)
            store.save_receipt(conn, identity, result, timestamp)
            return result
