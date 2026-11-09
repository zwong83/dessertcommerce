import re
from collections.abc import Callable
from datetime import datetime, timedelta
from hmac import compare_digest
from secrets import randbelow, token_bytes
from typing import TypedDict
from uuid import uuid4

from ..clock import utc_now
from ..db import Database, iso
from ..problems import Problem
from . import infrastructure as store
from .domain import (
    OTP_RESEND,
    OTP_SENDS,
    OTP_TTL,
    OTP_WINDOW,
    Purpose,
    Role,
    Session,
    is_eligible_challenge,
)


class OtpMessage(TypedDict):
    destination: str
    code: str
    role: Role
    purpose: Purpose


OtpDelivery = Callable[[OtpMessage], None]


_CHECK_UNSET = object()
_SESSION_TOKEN = re.compile(r"[A-Za-z0-9_-]{43}")
# Match String.trim() before hashing contact data created by either runtime.
_JS_WHITESPACE = (
    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006"
    "\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)


def _new_code() -> str:
    return f"{randbelow(1_000_000):06d}"


def _enrolled_contact(enrollment, contact):
    if enrollment is None:
        return None
    if enrollment["phone_e164"] == contact:
        return enrollment["phone_e164"]
    email = enrollment["recovery_email"]
    return email if email is not None and email.lower() == contact else None


def _unauthenticated():
    return Problem("UNAUTHENTICATED", 401, "Sign in to continue.")


class IdentityService:
    def __init__(
        self,
        db: Database,
        secret: bytes,
        delivery: OtpDelivery,
        *,
        clock: Callable[[], datetime] = utc_now,
        new_code: Callable[[], str] | None = None,
        session_ttl_ms: int = 28_800_000,
        global_send_limit: int = 250,
    ):
        self._db = db
        self._crypto = store.IdentityCrypto(secret)
        self._deliver = delivery
        self._clock = clock
        self._new_code = new_code if new_code is not None else _new_code
        self._session_ttl = timedelta(milliseconds=session_ttl_ms)
        self._global_send_limit = global_send_limit

    def _now(self) -> datetime:
        current = self._clock()
        return current.replace(microsecond=current.microsecond // 1000 * 1000)

    def start(self, role: Role, destination: str, purpose: Purpose = "SIGN_IN") -> dict[str, str]:
        challenge_id = str(uuid4())
        code = self._new_code()
        normalized = destination.strip(_JS_WHITESPACE).lower()
        fingerprint = self._crypto.destination_fingerprint(normalized)
        with self._db.transaction() as conn:
            store.lock_send_budget(conn, role)
            created = self._now()
            expiry = created + OTP_TTL
            counts = store.send_counts(conn, fingerprint, role, created - OTP_WINDOW)
            if counts["destination_count"] >= OTP_SENDS or counts["global_count"] >= self._global_send_limit:
                raise Problem("RATE_LIMITED", 429, "Try again later.", 900)

            enrollment = store.lock_admin(conn) if role == "ADMIN" else None
            contact = _enrolled_contact(enrollment, normalized) if role == "ADMIN" else normalized
            if contact is not None:
                sealed = self._crypto.seal_destination(challenge_id, normalized) if role == "CUSTOMER" else None
                store.insert_challenge(
                    conn, challenge_id, role, purpose, enrollment["credential_epoch"] if enrollment else None,
                    fingerprint, self._crypto.otp_verifier(challenge_id, code), sealed, created, expiry,
                )

        if contact is not None:
            try:
                self._deliver({"destination": contact, "code": code, "role": role, "purpose": purpose})
            except Exception:
                with self._db.transaction() as conn:
                    store.consume_challenge(conn, challenge_id, self._now())
                raise Problem("DEPENDENCY_UNAVAILABLE", 503, "Verification is temporarily unavailable.") from None

        return {"challengeId": challenge_id, "expiresAt": iso(expiry), "resendAt": iso(created + OTP_RESEND)}

    def verify(self, role: Role, challenge_id: str, code: str) -> tuple[str, Session]:
        token = store.base64url(token_bytes(32))
        csrf = self._crypto.csrf_token(token)
        with self._db.transaction() as conn:
            session = self._verify(conn, role, challenge_id, code, token, csrf)
        if session is None:
            raise Problem("OTP_INVALID", 422, "The code could not be verified. Request a new code and try again.")
        return token, session

    def _verify(self, conn, role, challenge_id, code, token, csrf):
        # Recovery and verification take the enrollment lock before the challenge lock.
        enrollment = store.lock_admin(conn) if role == "ADMIN" else None
        row = store.lock_challenge(conn, challenge_id, role)
        current = self._now()
        if row is None or not is_eligible_challenge(row["expires_at"], row["used_at"], row["attempts"], current):
            return None
        if role == "ADMIN" and not self._matches_enrollment(enrollment, row):
            return None
        if not self._crypto.matches_otp(challenge_id, code, row["verifier"]):
            store.record_failed_attempt(conn, challenge_id, current)
            return None

        account_id = enrollment["id"] if enrollment else None
        if role == "CUSTOMER" and row["customer_destination_cipher"] is not None:
            phone = self._crypto.open_destination(challenge_id, row["customer_destination_cipher"])
            account_id = store.resolve_customer(conn, phone)
        if account_id is None:
            return None

        if role == "ADMIN" and row["purpose"] == "RECOVERY":
            store.recover_admin(conn, account_id, current)
        store.consume_challenge(conn, challenge_id, current)
        expiry = current + self._session_ttl
        store.insert_session(conn, token, account_id, csrf, current, expiry)
        store.audit_sign_in(conn, account_id, row["purpose"], current, challenge_id)
        return Session(str(account_id), role, csrf, expiry)

    def _matches_enrollment(self, enrollment, challenge) -> bool:
        if enrollment is None or enrollment["credential_epoch"] != challenge["enrollment_epoch"]:
            return False
        return any(
            compare_digest(challenge["destination_fingerprint"], self._crypto.destination_fingerprint(contact.lower()))
            for contact in (enrollment["phone_e164"], enrollment["recovery_email"])
            if contact
        )

    def get_session(self, raw_token: str | None, role: Role | None = None, csrf_token=_CHECK_UNSET) -> Session:
        if not raw_token or not _SESSION_TOKEN.fullmatch(raw_token):
            raise _unauthenticated()
        with self._db.connection() as conn:
            row = store.find_session(conn, raw_token, self._now())
        if row is None:
            raise _unauthenticated()
        if role is not None and row["role"] != role:
            raise Problem("FORBIDDEN", 403, "This action requires a different account role.")
        if csrf_token is not _CHECK_UNSET and (
            not csrf_token or not compare_digest(store.token_hash(csrf_token), row["csrf_hash"])
        ):
            raise Problem("FORBIDDEN", 403, "Refresh your session and try again.")
        return Session(str(row["account_id"]), row["role"], self._crypto.csrf_token(raw_token), row["expires_at"])

    def logout(self, raw_token: str | None, csrf_token: str | None) -> None:
        self.get_session(raw_token, csrf_token=csrf_token)
        with self._db.transaction() as conn:
            store.revoke_session(conn, raw_token, self._now())
