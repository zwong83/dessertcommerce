import re
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from hmac import compare_digest
from secrets import randbelow, token_bytes
from typing import TypedDict
from uuid import uuid4

from psycopg.errors import UniqueViolation

from ..clock import utc_now
from ..db import Database, iso
from ..problems import (
    AccessDenied,
    AuthenticationRequired,
    DependencyUnavailable,
    Problem,
)
from . import infrastructure as store
from .domain import (
    OTP_RESEND,
    OTP_SENDS,
    OTP_TTL,
    OTP_WINDOW,
    PASSWORD_ATTEMPTS,
    PASSWORD_GLOBAL_ATTEMPTS,
    PASSWORD_WINDOW,
    USERNAME_CHANGE_INTERVAL,
    CustomerProfile,
    PasswordAction,
    ProfileEdit,
    Purpose,
    Registration,
    Role,
    Session,
    is_eligible_challenge,
)
from .password import hash_password, password_matches


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
    return AuthenticationRequired("Sign in to continue.")


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

    def start(self, role: Role, destination: str, purpose: Purpose = Purpose.SIGN_IN) -> dict[str, str]:
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

            enrollment = store.lock_admin(conn) if role == Role.ADMIN else None
            contact = _enrolled_contact(enrollment, normalized) if role == Role.ADMIN else normalized
            if contact is not None:
                sealed = self._crypto.seal_destination(challenge_id, normalized) if role == Role.CUSTOMER else None
                store.insert_challenge(
                    conn, challenge_id, role, purpose, enrollment["credential_epoch"] if enrollment else None,
                    fingerprint, self._crypto.otp_verifier(challenge_id, code), sealed, created, expiry,
                )

        if contact is not None:
            try:
                delivery_purpose = Purpose.SIGN_IN if role == Role.CUSTOMER or purpose == Purpose.MERCHANT_SETUP else purpose
                self._deliver({"destination": contact, "code": code, "role": role, "purpose": delivery_purpose})
            except Exception:
                with self._db.transaction() as conn:
                    store.consume_challenge(conn, challenge_id, self._now())
                raise DependencyUnavailable("Verification is temporarily unavailable.") from None

        return {"challengeId": challenge_id, "expiresAt": iso(expiry), "resendAt": iso(created + OTP_RESEND)}

    def verify(self, role: Role, challenge_id: str, code: str, *,
               purpose: Purpose | None = None, registration: Registration | None = None) -> tuple[str, Session]:
        registration_role = {Purpose.CUSTOMER_SIGNUP: Role.CUSTOMER, Purpose.MERCHANT_SETUP: Role.ADMIN}.get(purpose)
        if (registration is not None) != (registration_role is not None) or (registration_role and registration_role != role):
            raise ValueError("Registration is required only for the matching account setup.")
        token = store.base64url(token_bytes(32))
        with self._db.transaction() as conn:
            session = self._verify(conn, role, challenge_id, code, token, purpose, registration)
        if session is None:
            raise Problem("OTP_INVALID", 422, "The code could not be verified. Request a new code and try again.")
        return token, session

    def _verify(self, conn, role, challenge_id, code, token, purpose, registration):
        # Recovery and verification take the enrollment lock before the challenge lock.
        enrollment = store.lock_admin(conn) if role == Role.ADMIN else None
        row = store.lock_challenge(conn, challenge_id, role)
        current = self._now()
        if row is None or not is_eligible_challenge(row["expires_at"], row["used_at"], row["attempts"], current):
            return None
        if role == Role.CUSTOMER and row["purpose"] != (purpose or Purpose.SIGN_IN):
            return None
        if role == Role.ADMIN:
            if not self._matches_enrollment(enrollment, row):
                return None
            if (row["purpose"] == Purpose.MERCHANT_SETUP) != (purpose == Purpose.MERCHANT_SETUP):
                return None
        if not self._crypto.matches_otp(challenge_id, code, row["verifier"]):
            store.record_failed_attempt(conn, challenge_id, current)
            return None

        account_id = enrollment["id"] if enrollment else None
        if role == Role.CUSTOMER and row["customer_destination_cipher"] is not None:
            phone = self._crypto.open_destination(challenge_id, row["customer_destination_cipher"])
            account_id = store.resolve_customer(conn, phone) if registration is not None else store.find_customer(conn, phone)
            if registration is None and account_id is None:
                store.consume_challenge(conn, challenge_id, current)
            if registration is not None and (
                account_id is None or not store.insert_customer_profile(conn, account_id, registration, hash_password(registration.password))
            ):
                raise Problem("REGISTRATION_CONFLICT", 409, "This phone or username is already registered. Try logging in or choose another username.")
        if account_id is None:
            return None

        if purpose == Purpose.MERCHANT_SETUP and not store.insert_merchant_profile(
            conn, account_id, registration, hash_password(registration.password),
        ):
            raise Problem("REGISTRATION_CONFLICT", 409, "Merchant sign-up is complete. Log in or recover merchant access.")
        if role == Role.ADMIN and row["purpose"] == Purpose.RECOVERY:
            store.recover_admin(conn, account_id, current)
        store.consume_challenge(conn, challenge_id, current)
        return self._open_session(conn, account_id, role, token, current, row["purpose"], challenge_id)

    def _open_session(self, conn, account_id, role, token, current, action, request_id):
        expiry = current + self._session_ttl
        csrf = self._crypto.csrf_token(token)
        store.insert_session(conn, token, account_id, csrf, current, expiry)
        store.audit_sign_in(conn, account_id, action, current, request_id)
        return Session(str(account_id), role, csrf, expiry)

    def _reserve_password_attempt(self, conn, operation: PasswordAction, username: str) -> None:
        fingerprint = self._crypto.username_fingerprint(username)
        store.lock_password_budget(conn, operation)
        now = self._now()
        seconds = int(PASSWORD_WINDOW.total_seconds())
        bucket = datetime.fromtimestamp(int(now.timestamp()) // seconds * seconds, UTC)
        counts = store.password_counts(conn, operation, bucket, fingerprint)
        if counts["for_username"] >= PASSWORD_ATTEMPTS or counts["total"] >= PASSWORD_GLOBAL_ATTEMPTS:
            raise Problem("RATE_LIMITED", 429, "Try again later.", int((bucket + PASSWORD_WINDOW - now).total_seconds()) + 1)
        store.record_password_attempt(conn, operation, bucket, fingerprint)

    def password_sign_up(self, registration: Registration, contact_phone: str) -> tuple[str, Session]:
        with self._db.transaction() as conn:
            self._reserve_password_attempt(conn, PasswordAction.SIGN_UP, registration.username)
        password_hash = hash_password(registration.password)
        token = store.base64url(token_bytes(32))
        with self._db.transaction() as conn:
            account_id = store.create_password_customer(conn)
            if not store.insert_customer_profile(conn, account_id, registration, password_hash, contact_phone=contact_phone):
                raise Problem("REGISTRATION_CONFLICT", 409, "This username is already registered. Choose another username or log in.")
            session = self._open_session(conn, account_id, Role.CUSTOMER, token, self._now(), PasswordAction.SIGN_UP, str(uuid4()))
        return token, session

    def password_sign_in(self, username: str, password: str) -> tuple[str, Session]:
        with self._db.transaction() as conn:
            self._reserve_password_attempt(conn, PasswordAction.SIGN_IN, username)
            account = store.find_password_customer(conn, username)
        if not password_matches(password, account["password_hash"] if account else None):
            raise Problem("CREDENTIALS_INVALID", 401, "The username or password is incorrect.")

        token = store.base64url(token_bytes(32))
        with self._db.transaction() as conn:
            credentials = store.lock_customer_credentials(conn, account["id"])
            if not credentials or credentials["password_hash"] != account["password_hash"] or credentials["username"] != username:
                raise Problem("CREDENTIALS_INVALID", 401, "The username or password is incorrect.")
            session = self._open_session(conn, account["id"], Role.CUSTOMER, token, self._now(), PasswordAction.SIGN_IN, str(uuid4()))
        return token, session

    def merchant_password_sign_in(self, username: str, password: str) -> tuple[str, Session]:
        with self._db.transaction() as conn:
            self._reserve_password_attempt(conn, PasswordAction.MERCHANT_SIGN_IN, username)
            account = store.find_password_merchant(conn, username)
        if not password_matches(password, account["password_hash"] if account else None):
            raise Problem("CREDENTIALS_INVALID", 401, "The username or password is incorrect.")

        token = store.base64url(token_bytes(32))
        with self._db.transaction() as conn:
            enrollment = store.lock_admin(conn)
            if not enrollment or (enrollment["id"], enrollment["credential_epoch"]) != (account["id"], account["credential_epoch"]):
                raise Problem("CREDENTIALS_INVALID", 401, "The username or password is incorrect.")
            session = self._open_session(conn, account["id"], Role.ADMIN, token, self._now(), PasswordAction.MERCHANT_SIGN_IN, str(uuid4()))
        return token, session

    @staticmethod
    def _profile(row, now) -> CustomerProfile:
        if not row:
            return CustomerProfile()
        changed_at = row["username_changed_at"]
        available_at = changed_at + USERNAME_CHANGE_INTERVAL if changed_at else None
        avatar = row["avatar_version"]
        return CustomerProfile(
            display_name=row["display_name"], username=row["username"],
            username_change_available_at=available_at if available_at and now < available_at else None,
            avatar_version=str(avatar) if avatar else None, phone=row["phone"], email=row["email"],
        )

    def customer_account(self, session: Session) -> CustomerProfile:
        with self._db.connection() as conn:
            return self._profile(store.read_customer_profile(conn, session.account_id), self._now())

    def edit_customer_account(self, session: Session, edit: ProfileEdit, request_id: str) -> CustomerProfile:
        try:
            with self._db.transaction() as conn:
                store.ensure_customer_profile(conn, session.account_id, edit.display_name)
                current = store.lock_customer_credentials(conn, session.account_id)
                now = self._now()
                username, changed_at = current["username"], current["username_changed_at"]
                if edit.username is not None and edit.username != username:
                    if username is None:
                        raise AccessDenied("This account does not have a username to change.")
                    if changed_at is not None and now < changed_at + USERNAME_CHANGE_INTERVAL:
                        raise Problem("USERNAME_CHANGE_LOCKED", 409, "You can change your username once every 60 days.")
                    username, changed_at = edit.username, now
                store.update_customer_profile(conn, session.account_id, edit, username, changed_at)
                store.audit_sign_in(conn, session.account_id, "PROFILE_UPDATED", now, request_id)
                return self._profile(store.read_customer_profile(conn, session.account_id), now)
        except UniqueViolation:
            raise Problem("USERNAME_UNAVAILABLE", 409, "This username is already taken.") from None

    def customer_avatar(self, session: Session) -> bytes | None:
        with self._db.connection() as conn:
            return store.read_customer_avatar(conn, session.account_id)

    def change_customer_password(self, session: Session, token: str, current: str, new: str, request_id: str) -> None:
        with self._db.transaction() as conn:
            self._reserve_password_attempt(conn, PasswordAction.CHANGE, session.account_id)
            stored_hash = store.customer_password_hash(conn, session.account_id)
        if stored_hash is None:
            raise AccessDenied("This account does not have a password to change.")
        if not password_matches(current, stored_hash):
            raise Problem("CURRENT_PASSWORD_INCORRECT", 422, "Your current password is incorrect.")
        new_hash = hash_password(new)
        with self._db.transaction() as conn:
            if not store.update_customer_password(conn, session.account_id, stored_hash, new_hash):
                raise Problem("PASSWORD_CHANGED", 409, "Your password changed. Try again with your current password.")
            now = self._now()
            if store.find_session(conn, token, now) is None:
                raise _unauthenticated()
            store.revoke_other_sessions(conn, session.account_id, token, now)
            store.audit_sign_in(conn, session.account_id, PasswordAction.CHANGE, now, request_id)

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
            raise AccessDenied("This action requires a different account role.")
        if csrf_token is not _CHECK_UNSET and (
            not csrf_token or not compare_digest(store.token_hash(csrf_token), row["csrf_hash"])
        ):
            raise AccessDenied("Refresh your session and try again.")
        return Session(str(row["account_id"]), row["role"], self._crypto.csrf_token(raw_token), row["expires_at"])

    def logout(self, raw_token: str | None, csrf_token: str | None) -> None:
        self.get_session(raw_token, csrf_token=csrf_token)
        with self._db.transaction() as conn:
            store.revoke_session(conn, raw_token, self._now())

    def customer_display_name(self, raw_token: str | None) -> str | None:
        session = self.get_session(raw_token, Role.CUSTOMER)
        with self._db.connection() as conn:
            return store.find_customer_display_name(conn, session.account_id)
