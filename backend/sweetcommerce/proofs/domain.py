import base64
import binascii
import json
import re
from datetime import UTC, datetime
from uuid import UUID

from ..fulfilment.domain import ACTIVE as ACTIVE_FULFILMENT
from ..problems import Problem
from ..values import UUID_PATTERN

MAX_PROOF_BYTES = 5 * 1024 * 1024
MEDIA_EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf"}
ACTIVE_CHARGES = {"OPEN", "PROOF_REVIEW", "DISPUTED"}


def require_role(actor, role: str) -> str:
    if actor is None:
        raise Problem("UNAUTHENTICATED", 401, "Sign in to continue.")
    if actor.role != role:
        raise Problem("FORBIDDEN", 403, "This account cannot access payment evidence.")
    return identifier(str(actor.account_id), "the account")


def identifier(value: str | None, label: str) -> str:
    if value is None or not UUID_PATTERN.fullmatch(value):
        raise Problem("VALIDATION", 400, f"Provide a valid {label}.")
    return value.lower()


def check_media_type(value: str | None) -> str:
    if value is None:
        raise Problem("VALIDATION", 400, "Provide the X-File-Media-Type header.")
    if value not in MEDIA_EXTENSIONS:
        raise unsupported_media()
    return value


def unsupported_media() -> Problem:
    return Problem("UNSUPPORTED_MEDIA", 415, "Upload a JPEG, PNG or PDF proof as raw bytes.")


def oversized() -> Problem:
    return Problem("PAYLOAD_TOO_LARGE", 413, "Payment evidence must be at most 5 MiB.")


def invalid_file() -> Problem:
    return Problem("VALIDATION", 422, "Upload a complete, valid payment proof file.")


def missing() -> Problem:
    return Problem("NOT_FOUND", 404, "Payment evidence resource not found.")


def storage_unavailable() -> Problem:
    return Problem("DEPENDENCY_UNAVAILABLE", 503, "Payment evidence storage is temporarily unavailable.")


def invalid_transition() -> Problem:
    return Problem("INVALID_TRANSITION", 409, "This charge cannot receive payment evidence.")


def standard_disposition(order: dict, charge: dict, now: datetime) -> str:
    if order["payment_method"] != "DUITNOW":
        raise invalid_transition()
    if order["status"] in {"EXPIRED", "CANCELLED", "REJECTED"} or charge["state"] in {"EXPIRED", "CANCELLED"}:
        return "RECONCILIATION_ONLY"
    if (
        order["status"] not in {"PENDING_PROOF", "PAYMENT_REVIEW", "EXCEPTION"}
        or charge["state"] not in ACTIVE_CHARGES
    ):
        raise invalid_transition()

    deadline = charge["top_up_due_at"]
    if deadline is not None:
        if now < charge["top_up_requested_at"]:
            raise invalid_transition()
    else:
        deadline = order["proof_due_at"]
        if deadline is None or deadline != charge["due_at"]:
            raise invalid_transition()
    if now >= deadline:
        return "RECONCILIATION_ONLY"
    return "TIMELY"


def adjustment_disposition(order: dict, charge: dict) -> str:
    if order["payment_method"] != "DUITNOW":
        raise invalid_transition()
    if charge["state"] not in ACTIVE_CHARGES or order["status"] in {"CANCELLED", "REJECTED", "EXPIRED", "NO_SHOW"}:
        return "RECONCILIATION_ONLY"
    if (
        order["accepted_at"] is None
        or order["fulfilment"] == "PICKUP"
        or order["status"] not in ACTIVE_FULFILMENT | {"COMPLETED"}
    ):
        raise invalid_transition()
    return "TIMELY"


def _timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def proof_view(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "chargeId": str(row["charge_id"]),
        "state": row["state"],
        "receivedAt": _timestamp(row["received_at"]),
        "reviewDisposition": row["review_disposition"],
    }


def page_bounds(charge_id: str, limit: str | None, cursor: str | None) -> tuple[int, datetime | None, UUID | None]:
    if limit is None:
        count = 25
    elif re.fullmatch(r"[0-9]{1,3}", limit) and 1 <= int(limit) <= 100:
        count = int(limit)
    else:
        raise Problem("VALIDATION", 400, "Choose a proof page size between 1 and 100.")
    if cursor is None:
        return count, None, None
    try:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,500}", cursor):
            raise ValueError
        scope, instant, anchor = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
        if scope != ["payment-proofs", charge_id, "newest-first"]:
            raise ValueError
        at = datetime.fromisoformat(instant)
        if at.tzinfo is None or _timestamp(at) != instant:
            raise ValueError
        return count, at, UUID(identifier(anchor, "proof cursor"))
    except (binascii.Error, ValueError, TypeError, OverflowError, RecursionError):
        raise Problem("VALIDATION", 400, "Provide a valid proof cursor.") from None


def next_cursor(charge_id: str, row: dict) -> str:
    parts = [["payment-proofs", charge_id, "newest-first"], _timestamp(row["received_at"]), str(row["id"])]
    return base64.urlsafe_b64encode(json.dumps(parts, separators=(",", ":")).encode()).decode().rstrip("=")
