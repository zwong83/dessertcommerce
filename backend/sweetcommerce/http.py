import json
from datetime import UTC, datetime
from email.utils import format_datetime

from starlette.requests import Request

from .clock import utc_now as utc_now
from .problems import Problem as Problem, validation as validation
from .values import field_string as field_string, field_uuid as field_uuid

SESSION_COOKIE = "__Host-sc-session"


def cookie(request: Request, name: str = SESSION_COOKIE) -> str | None:
    for entry in request.headers.get("cookie", "").split(";"):
        key, separator, value = entry.strip().partition("=")
        if separator and key == name:
            return value
    return None


def session_cookie(token: str, expiry: str | datetime | None = None) -> str:
    if isinstance(expiry, str):
        expiry = datetime.fromisoformat(expiry)
    lifetime = "; Expires=" + format_datetime(expiry.astimezone(UTC), usegmt=True) if expiry else "; Max-Age=0"
    return f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; Secure; SameSite=Lax{lifetime}"


def require_same_origin(request: Request, origin: str, status: int = 403) -> None:
    if request.headers.get("origin") != origin:
        raise Problem("ORIGIN_DENIED", status, "Send the request from this application.")


def require_session(request: Request, identity, origin: str, role: str | None, *, write: bool = False):
    if write:
        require_same_origin(request, origin)
        return identity.get_session(cookie(request), role, request.headers.get("x-csrf-token"))
    return identity.get_session(cookie(request), role)


def _invalid_constant(value: str):
    raise ValueError(value)


async def read_object(request: Request, allowed, limit: int = 32768) -> dict:
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type != "application/json":
        raise validation("Submit a JSON request.")
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > limit:
            raise validation("The submitted request is too large.")
        data.extend(chunk)
    if not data and request.headers.get("content-length") == "0":
        raise validation("Submit a JSON request.")
    try:
        value = json.loads(data.decode("utf-8", errors="replace"), parse_constant=_invalid_constant)
    except (ValueError, RecursionError):
        raise Problem("VALIDATION", 400, "Submit a valid JSON request.") from None
    if not isinstance(value, dict) or any(key not in allowed for key in value):
        raise validation()
    return value
