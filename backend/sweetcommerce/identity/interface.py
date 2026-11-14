import re
from string import punctuation

from fastapi import APIRouter, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from ..db import iso
from ..http import (
    SESSION_COOKIE,
    cookie,
    field_string,
    field_uuid,
    read_object,
    require_same_origin,
    require_session,
    session_cookie,
    validation,
)
from ..problems import AccessDenied, ResourceNotFound
from .application import IdentityService
from .avatar import MAX_AVATAR_REQUEST_BYTES, profile_avatar
from .domain import CustomerProfile, ProfileEdit, Purpose, Registration, Role, Session

_PHONE = re.compile(r"\A\+[1-9][0-9]{7,14}\Z")
_CODE = re.compile(r"\A[0-9]{6}\Z")
_USERNAME = re.compile(r"\A[a-z0-9][a-z0-9_.-]{2,31}\Z", re.ASCII | re.IGNORECASE)
_EMAIL = re.compile(r"\A[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+\Z")
_CUSTOMER_INTENTS = {"login": Purpose.CUSTOMER_LOGIN, "signup": Purpose.CUSTOMER_SIGNUP}


def _customer_purpose(value) -> Purpose:
    if not isinstance(value, str) or value not in _CUSTOMER_INTENTS:
        raise validation("Choose log in or sign up.")
    return _CUSTOMER_INTENTS[value]


def _username(value) -> str:
    return field_string(value, "the username (3–32 letters, numbers, dots, hyphens or underscores)", _USERNAME, 32).lower()


def _password(value) -> str:
    return field_string(value, "the password", max_length=128)


def _new_password(value) -> str:
    password = _password(value)
    if (
        len(password) < 8
        or not re.search(r"[a-z]", password)
        or not re.search(r"[A-Z]", password)
        or not re.search(r"[0-9]", password)
        or not any(character in punctuation for character in password)
    ):
        raise validation("Use at least 8 characters, including a lowercase letter, an uppercase letter, a number and a symbol.")
    return password


def _registration(value) -> Registration:
    if not isinstance(value, dict) or value.keys() - {"name", "email", "username", "password"}:
        raise validation("Check the sign-up details.")
    return Registration(
        name=field_string(value.get("name"), "your name", max_length=120).strip(),
        email=field_string(value["email"], "the email address", _EMAIL) if "email" in value else None,
        username=_username(value.get("username")), password=_new_password(value.get("password")),
    )


def _profile_json(profile: CustomerProfile):
    available_at = profile.username_change_available_at
    return {
        "displayName": profile.display_name, "username": profile.username, "avatarVersion": profile.avatar_version,
        "usernameChangeAvailableAt": iso(available_at) if available_at else None,
        "phone": profile.phone, "email": profile.email,
    }


def _session_json(session: Session) -> dict[str, str]:
    return {
        "accountId": session.account_id,
        "role": session.role,
        "csrfToken": session.csrf_token,
        "expiresAt": iso(session.expires_at),
    }


def _signed_in(token: str, session: Session, *, status_code: int = 200) -> JSONResponse:
    return JSONResponse(_session_json(session), status_code=status_code,
                        headers={"Set-Cookie": session_cookie(token, session.expires_at)})


def router(service: IdentityService, origin: str, *, customer_phone_verification: bool) -> APIRouter:
    api = APIRouter()

    @api.get("/session")
    def get_session(request: Request):
        return _session_json(service.get_session(cookie(request, SESSION_COOKIE)))

    @api.get("/auth/customer/profile", operation_id="getCustomerProfile")
    def customer_profile(request: Request):
        return {"displayName": service.customer_display_name(cookie(request, SESSION_COOKIE))}

    @api.get("/auth/customer/account", operation_id="getCustomerAccount")
    def get_customer_account(request: Request):
        session = require_session(request, service, origin, Role.CUSTOMER)
        return _profile_json(service.customer_account(session))

    @api.put("/auth/customer/account", operation_id="updateCustomerAccount")
    async def update_customer_account(request: Request):
        session = await run_in_threadpool(require_session, request, service, origin, Role.CUSTOMER, write=True)
        body = await read_object(request, ["displayName", "username", "avatar", "phone", "email"], limit=MAX_AVATAR_REQUEST_BYTES)
        name = field_string(body.get("displayName"), "your display name", max_length=120).strip()
        username = _username(body["username"]) if "username" in body else None
        avatar = await run_in_threadpool(profile_avatar, body.get("avatar"))
        phone = field_string(body["phone"], "the international phone number", _PHONE, 16) if "phone" in body else None
        email = field_string(body["email"], "the email address", _EMAIL) if body.get("email") is not None else None
        edit = ProfileEdit(name, username, "avatar" in body, avatar,
                           contact_phone=phone, email=email, update_email="email" in body)
        profile = await run_in_threadpool(
            service.edit_customer_account, session, edit, request.state.request_id,
        )
        return _profile_json(profile)

    @api.get("/auth/customer/account/photo", operation_id="getCustomerAccountPhoto")
    def get_customer_account_photo(request: Request):
        session = require_session(request, service, origin, Role.CUSTOMER)
        avatar = service.customer_avatar(session)
        if avatar is None:
            raise ResourceNotFound("You haven’t added a profile picture.")
        return Response(avatar, media_type="image/webp", headers={"Cache-Control": "private, no-store"})

    @api.post("/auth/customer/account/password", status_code=204, operation_id="changeCustomerPassword")
    async def change_customer_password(request: Request):
        session = await run_in_threadpool(require_session, request, service, origin, Role.CUSTOMER, write=True)
        body = await read_object(request, ["currentPassword", "newPassword"], limit=8192)
        await run_in_threadpool(
            service.change_customer_password, session, cookie(request, SESSION_COOKIE),
            _password(body.get("currentPassword")), _new_password(body.get("newPassword")), request.state.request_id,
        )
        return Response(status_code=204)

    @api.post("/auth/otp/challenges", status_code=201)
    async def start_customer(request: Request):
        require_same_origin(request, origin, 400)
        body = await read_object(request, ["phone"])
        phone = field_string(body.get("phone"), "the international phone number", _PHONE, 16)
        return await run_in_threadpool(service.start, Role.CUSTOMER, phone)

    @api.post("/auth/customer/otp/challenges", status_code=201, operation_id="startCustomerAccessChallenge")
    async def start_customer_access(request: Request):
        require_same_origin(request, origin, 400)
        body = await read_object(request, ["phone", "intent"], limit=2048)
        phone = field_string(body.get("phone"), "the international phone number", _PHONE, 16)
        return await run_in_threadpool(service.start, Role.CUSTOMER, phone, _customer_purpose(body.get("intent")))

    @api.post("/auth/customer/otp/verify", operation_id="verifyCustomerAccessChallenge")
    async def verify_customer_access(request: Request):
        require_same_origin(request, origin, 400)
        body = await read_object(request, ["intent", "challengeId", "code", "registration"], limit=4096)
        purpose = _customer_purpose(body.get("intent"))
        if purpose == Purpose.CUSTOMER_LOGIN and "registration" in body:
            raise validation("Submit registration details only when signing up.")
        registration = _registration(body.get("registration")) if purpose == Purpose.CUSTOMER_SIGNUP else None
        challenge_id = field_uuid(body.get("challengeId"), "the verification challenge")
        code = field_string(body.get("code"), "the six-digit code", _CODE, 6)
        return _signed_in(*await run_in_threadpool(
            service.verify, Role.CUSTOMER, challenge_id, code, purpose=purpose, registration=registration
        ))

    @api.post("/auth/customer/password", operation_id="signInCustomerWithPassword")
    async def sign_in_customer_with_password(request: Request):
        require_same_origin(request, origin, 400)
        body = await read_object(request, ["username", "password"], limit=2048)
        return _signed_in(*await run_in_threadpool(service.password_sign_in, _username(body.get("username")), _password(body.get("password"))))

    @api.post("/auth/customer/registration", status_code=201, operation_id="registerCustomerWithPassword")
    async def register_customer_with_password(request: Request):
        require_same_origin(request, origin, 400)
        if customer_phone_verification:
            raise AccessDenied("Verify your phone number to sign up.")
        body = await read_object(request, ["registration", "phone"], limit=4096)
        registration = _registration(body.get("registration"))
        phone = field_string(body.get("phone"), "the international phone number", _PHONE, 16)
        token, session = await run_in_threadpool(service.password_sign_up, registration, phone)
        return _signed_in(token, session, status_code=201)

    @api.post("/admin/auth/challenges", status_code=201)
    async def start_admin(request: Request):
        require_same_origin(request, origin, 400)
        body = await read_object(request, ["verifiedContact", "purpose"])
        contact = field_string(body.get("verifiedContact"), "the enrolled contact")
        purpose = body.get("purpose", Purpose.SIGN_IN)
        if purpose not in (Purpose.SIGN_IN, Purpose.RECOVERY):
            raise validation()
        return await run_in_threadpool(service.start, Role.ADMIN, contact, Purpose(purpose))

    @api.post("/admin/auth/registration/challenges", status_code=201, operation_id="startMerchantRegistration")
    async def start_merchant_registration(request: Request):
        require_same_origin(request, origin, 400)
        body = await read_object(request, ["verifiedContact"], limit=2048)
        contact = field_string(body.get("verifiedContact"), "the enrolled phone number or email")
        return await run_in_threadpool(service.start, Role.ADMIN, contact, Purpose.MERCHANT_SETUP)

    @api.post("/admin/auth/registration", status_code=201, operation_id="registerMerchantCredentials")
    async def register_merchant_credentials(request: Request):
        require_same_origin(request, origin, 400)
        body = await read_object(request, ["challengeId", "code", "registration"], limit=4096)
        challenge_id = field_uuid(body.get("challengeId"), "the verification challenge")
        code = field_string(body.get("code"), "the six-digit code", _CODE, 6)
        registration = _registration(body.get("registration"))
        token, session = await run_in_threadpool(
            service.verify, Role.ADMIN, challenge_id, code, purpose=Purpose.MERCHANT_SETUP, registration=registration,
        )
        return _signed_in(token, session, status_code=201)

    @api.post("/admin/auth/password", operation_id="signInMerchantWithPassword")
    async def sign_in_merchant_with_password(request: Request):
        require_same_origin(request, origin, 400)
        body = await read_object(request, ["username", "password"], limit=2048)
        username, password = _username(body.get("username")), _password(body.get("password"))
        return _signed_in(*await run_in_threadpool(service.merchant_password_sign_in, username, password))

    async def verify(request: Request, role: Role):
        require_same_origin(request, origin, 400)
        body = await read_object(request, ["challengeId", "code"])
        challenge_id = field_uuid(body.get("challengeId"), "the verification challenge")
        code = field_string(body.get("code"), "the six-digit code", _CODE, 6)
        token, session = await run_in_threadpool(service.verify, role, challenge_id, code)
        return _signed_in(token, session)

    @api.post("/auth/otp/verify")
    async def verify_customer(request: Request):
        return await verify(request, Role.CUSTOMER)

    @api.post("/admin/auth/sign-in")
    async def verify_admin(request: Request):
        return await verify(request, Role.ADMIN)

    @api.post("/session/logout", status_code=204)
    def logout(request: Request):
        require_same_origin(request, origin)
        service.logout(cookie(request, SESSION_COOKIE), request.headers.get("x-csrf-token"))
        return Response(status_code=204, headers={"Set-Cookie": session_cookie("")})

    return api
