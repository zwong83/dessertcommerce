"""Catalogue input, publication, and pagination policies."""

import base64
import binascii
import json
import re
from dataclasses import dataclass
from hashlib import sha256
from typing import Protocol
from uuid import UUID

from sweetcommerce.problems import Problem

MAX_PHOTO_BYTES = 5 * 1024 * 1024
MAX_VARIANTS = 100
MAX_SAFE_INTEGER = 2**53 - 1
TRANSITIONS = {
    "DRAFT": ("DRAFT", "LISTED", "ARCHIVED"),
    "LISTED": ("LISTED", "UNLISTED", "SUSPENDED", "SOLD_OUT", "ARCHIVED"),
    "UNLISTED": ("UNLISTED", "LISTED", "ARCHIVED"),
    "SUSPENDED": ("SUSPENDED", "LISTED", "ARCHIVED"),
    "SOLD_OUT": ("SOLD_OUT", "LISTED", "ARCHIVED"),
    "ARCHIVED": (),
}
UUID_PATTERN = re.compile(r"[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}")
# ECMAScript whitespace, used by the original validation and normalized digests.
WHITESPACE = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


class Principal(Protocol):
    @property
    def account_id(self) -> str | UUID: ...

    @property
    def role(self) -> str: ...


@dataclass(frozen=True)
class CatalogueCommand:
    idempotency_key: str
    request_id: str


@dataclass(frozen=True)
class CommandIdentity:
    actor_id: str
    operation: str
    key: str
    digest: bytes
    request_id: str

    @property
    def receipt_key(self):
        return self.actor_id, self.operation, self.key


@dataclass(frozen=True)
class CataloguePhoto:
    bytes: bytes
    media_type: str


class CatalogueValidationProblem(Problem):
    def __init__(self, field: str, code: str, message: str):
        super().__init__("VALIDATION", 422, message)
        self.field_errors = [{"field": field, "code": code}]


def json_digest(value):
    # Match JSON.stringify for receipts and cursors issued by the TypeScript runtime.
    compact = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return sha256(compact.encode("utf-8", errors="backslashreplace")).digest()


def is_uuid(value):
    return isinstance(value, str) and UUID_PATTERN.fullmatch(value) is not None


def require_role(principal: Principal | None, role: str) -> str:
    if principal is None or not is_uuid(str(principal.account_id)):
        raise Problem("UNAUTHENTICATED", 401, "Sign in to continue.")
    if principal.role != role:
        raise Problem("FORBIDDEN", 403, "This account cannot access the requested catalogue operation.")
    return str(principal.account_id).lower()


def missing_product():
    return Problem("NOT_FOUND", 404, "Product not found.")


def missing_photo():
    return Problem("NOT_FOUND", 404, "Photo not found.")


def path_id(value, missing):
    if not is_uuid(value):
        raise missing()
    return value.lower()


def identify_command(actor_id: str, operation: str, command: CatalogueCommand, value) -> CommandIdentity:
    if command is None or not is_uuid(command.idempotency_key):
        raise Problem("VALIDATION", 400, "Provide a valid Idempotency-Key.")
    if not is_text(command.request_id, 80):
        raise Problem("VALIDATION", 400, "Provide a valid request ID.")
    return CommandIdentity(actor_id, operation, command.idempotency_key.lower(), json_digest(value), command.request_id)


def is_text(value, max_length):
    return isinstance(value, str) and len(value) <= max_length and "\0" not in value and bool(value.strip(WHITESPACE))


def required_text(value, field, max_length):
    if not is_text(value, max_length):
        raise CatalogueValidationProblem(field, "INVALID_TEXT", f"Enter a value for {field} up to {max_length} characters.")
    return value.strip(WHITESPACE)


def product_name(value):
    return required_text(value, "name", 120)


def product_category(value):
    return None if value is None else required_text(value, "category", 80)


def in_integer_range(value, minimum, maximum):
    return type(value) in (int, float) and minimum <= value <= maximum and value == int(value)


def expected_version(value):
    if not in_integer_range(value, 1, MAX_SAFE_INTEGER):
        raise Problem("VALIDATION", 400, "Provide a valid product version.")
    return int(value)


def validate_update(body):
    name = product_name(body.get("name"))
    category = product_category(body.get("category"))
    status = body.get("status")
    if not isinstance(status, str) or status not in TRANSITIONS:
        raise CatalogueValidationProblem("status", "INVALID_STATUS", "Choose a product status.")

    submitted = body.get("variants")
    if not isinstance(submitted, list) or len(submitted) > MAX_VARIANTS:
        raise CatalogueValidationProblem("variants", "INVALID_COUNT", "Provide at most 100 variants.")
    variants = []
    variant_ids = set()
    for index, variant in enumerate(submitted):
        field = f"variants.{index}"
        if not isinstance(variant, dict):
            variant = {}
        variant_name = required_text(variant.get("name"), f"{field}.name", 120)
        flavour = required_text(variant.get("flavour"), f"{field}.flavour", 120)
        price = variant.get("unitMinor")
        if not in_integer_range(price, 0, 999_999_999):
            raise CatalogueValidationProblem(f"{field}.unitMinor", "INVALID_PRICE", "Enter the variant price in whole sen.")
        prep = variant.get("prepMinutes")
        if not in_integer_range(prep, 0, 10_080):
            raise CatalogueValidationProblem(f"{field}.prepMinutes", "INVALID_PREPARATION", "Enter preparation time in whole minutes from 0 to 10080.")
        available = variant.get("available")
        if type(available) is not bool:
            raise CatalogueValidationProblem(f"{field}.available", "INVALID_AVAILABILITY", "Choose whether the variant is available.")

        normalized = {}
        if "id" in variant:
            variant_id = variant["id"]
            if not is_uuid(variant_id) or variant_id.lower() in variant_ids:
                raise CatalogueValidationProblem(f"{field}.id", "INVALID_ID", "Provide each existing variant ID at most once.")
            variant_id = variant_id.lower()
            variant_ids.add(variant_id)
            normalized["id"] = variant_id
        normalized.update(name=variant_name, flavour=flavour, unitMinor=int(price), prepMinutes=int(prep), available=available)
        variants.append(normalized)

    image_refs = body.get("imageRefs")
    if not isinstance(image_refs, list) or len(image_refs) > 12 or not all(map(is_uuid, image_refs)):
        raise CatalogueValidationProblem("imageRefs", "INVALID_GALLERY", "Provide at most 12 valid photo IDs.")
    image_refs = [image_id.lower() for image_id in image_refs]
    if len(set(image_refs)) != len(image_refs):
        raise CatalogueValidationProblem("imageRefs", "DUPLICATE_PHOTO", "Include each photo at most once.")

    if status == "LISTED":
        if "category" in body and category is None:
            raise missing_category()
        if not any(variant["available"] for variant in variants):
            raise CatalogueValidationProblem("variants", "REQUIRED", "Make at least one variant available before listing.")

    edit = {"name": name}
    if "category" in body:
        edit["category"] = category
    edit.update(status=status, variants=variants, imageRefs=image_refs)
    return edit


def missing_category():
    return CatalogueValidationProblem("category", "REQUIRED", "Choose a category before listing.")


def require_transition(current, next_status):
    if next_status not in TRANSITIONS[current]:
        raise Problem("INVALID_TRANSITION", 409, "This product cannot move to the selected status.")


def require_photo_staging(status):
    if status == "ARCHIVED":
        raise Problem("INVALID_TRANSITION", 409, "Archived products cannot stage new photos.")


def encode_cursor(prefix: str, product_id: str) -> str:
    return base64.urlsafe_b64encode((prefix + product_id).encode()).decode().rstrip("=")


def page_bounds(limit, cursor, storefront, filter_value):
    limit = 25 if limit is None else limit
    if not in_integer_range(limit, 1, 100):
        raise Problem("VALIDATION", 400, "Choose a page limit between 1 and 100.")
    prefix = json_digest({"storefront": storefront, "filter": filter_value}).hex() + ":"
    if cursor is None:
        return int(limit), None, prefix
    invalid = Problem("VALIDATION", 400, "Use a valid cursor for this catalogue filter.")
    if not isinstance(cursor, str) or len(cursor) > 500:
        raise invalid
    try:
        decoded = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True).decode()
    except (ValueError, binascii.Error):
        raise invalid from None
    after = decoded[len(prefix):]
    if not decoded.startswith(prefix) or not is_uuid(after) or encode_cursor(prefix, after) != cursor:
        raise invalid
    return int(limit), after, prefix


def catalogue_filter(category):
    if category is None:
        return None
    if not is_text(category, 80):
        raise Problem("VALIDATION", 400, "Use a category between 1 and 80 characters.")
    return category.strip(WHITESPACE)


def merchant_filter(status):
    if status is None:
        return None
    if not isinstance(status, str) or status not in TRANSITIONS:
        raise Problem("VALIDATION", 400, "Choose a valid product status.")
    return status


def unreadable_photo():
    return Problem("UNSUPPORTED_MEDIA", 415, "Choose a valid JPEG, PNG or WebP photo.")


def validate_photo(data: bytes, declared_type: str):
    if len(data) > MAX_PHOTO_BYTES:
        raise Problem("PAYLOAD_TOO_LARGE", 413, "Choose a photo no larger than 5 MiB.")
    if declared_type == "image/jpeg" and data.startswith(b"\xff\xd8\xff"):
        return
    if declared_type == "image/png" and data.startswith(b"\x89PNG\r\n\x1a\n"):
        return
    if declared_type == "image/webp" and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return
    raise unreadable_photo()
