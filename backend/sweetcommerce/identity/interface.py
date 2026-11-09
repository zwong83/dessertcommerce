import re

from fastapi import APIRouter, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from ..db import iso
from ..http import SESSION_COOKIE, cookie, field_string, field_uuid, read_object, require_same_origin, session_cookie, validation
from .application import IdentityService
from .domain import Role, Session

_PHONE = re.compile(r"\A\+[1-9][0-9]{7,14}\Z")
_CODE = re.compile(r"\A[0-9]{6}\Z")


def _session_json(session: Session) -> dict[str, str]:
    return {
        "accountId": session.account_id,
        "role": session.role,
        "csrfToken": session.csrf_token,
        "expiresAt": iso(session.expires_at),
    }


def router(service: IdentityService, origin: str) -> APIRouter:
    api = APIRouter()

    @api.get("/session")
    def get_session(request: Request):
        return _session_json(service.get_session(cookie(request, SESSION_COOKIE)))

    @api.post("/auth/otp/challenges", status_code=201)
    async def start_customer(request: Request):
        require_same_origin(request, origin, 400)
        body = await read_object(request, ["phone"])
        phone = field_string(body.get("phone"), "the international phone number", _PHONE, 16)
        return await run_in_threadpool(service.start, "CUSTOMER", phone)

    @api.post("/admin/auth/challenges", status_code=201)
    async def start_admin(request: Request):
        require_same_origin(request, origin, 400)
        body = await read_object(request, ["verifiedContact", "purpose"])
        contact = field_string(body.get("verifiedContact"), "the enrolled contact")
        purpose = body.get("purpose", "SIGN_IN")
        if purpose not in ("SIGN_IN", "RECOVERY"):
            raise validation()
        return await run_in_threadpool(service.start, "ADMIN", contact, purpose)

    async def verify(request: Request, role: Role):
        require_same_origin(request, origin, 400)
        body = await read_object(request, ["challengeId", "code"])
        challenge_id = field_uuid(body.get("challengeId"), "the verification challenge")
        code = field_string(body.get("code"), "the six-digit code", _CODE, 6)
        token, session = await run_in_threadpool(service.verify, role, challenge_id, code)
        return JSONResponse(
            _session_json(session), headers={"Set-Cookie": session_cookie(token, session.expires_at)}
        )

    @api.post("/auth/otp/verify")
    async def verify_customer(request: Request):
        return await verify(request, "CUSTOMER")

    @api.post("/admin/auth/sign-in")
    async def verify_admin(request: Request):
        return await verify(request, "ADMIN")

    @api.post("/session/logout", status_code=204)
    def logout(request: Request):
        require_same_origin(request, origin)
        service.logout(cookie(request, SESSION_COOKIE), request.headers.get("x-csrf-token"))
        return Response(status_code=204, headers={"Set-Cookie": session_cookie("")})

    return api
