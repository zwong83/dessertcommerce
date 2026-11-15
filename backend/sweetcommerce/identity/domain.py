from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import StrEnum


class Role(StrEnum):
    CUSTOMER = "CUSTOMER"
    ADMIN = "ADMIN"


class Purpose(StrEnum):
    SIGN_IN = "SIGN_IN"
    RECOVERY = "RECOVERY"
    CUSTOMER_LOGIN = "CUSTOMER_LOGIN"
    CUSTOMER_SIGNUP = "CUSTOMER_SIGNUP"
    MERCHANT_SETUP = "MERCHANT_SETUP"


class PasswordAction(StrEnum):
    SIGN_IN = "PASSWORD_SIGN_IN"
    SIGN_UP = "PASSWORD_SIGN_UP"
    CHANGE = "PASSWORD_CHANGE"
    MERCHANT_SIGN_IN = "MERCHANT_PASSWORD_SIGN_IN"


OTP_TTL = timedelta(minutes=5)
OTP_ATTEMPTS = 5
OTP_SENDS = 3
OTP_WINDOW = timedelta(minutes=15)
OTP_RESEND = timedelta(minutes=1)
PASSWORD_WINDOW = timedelta(minutes=15)
PASSWORD_ATTEMPTS = 8
PASSWORD_GLOBAL_ATTEMPTS = 250
USERNAME_CHANGE_INTERVAL = timedelta(days=60)


@dataclass(frozen=True)
class ProfileEdit:
    display_name: str
    username: str | None
    replace_avatar: bool
    avatar: bytes | None = field(repr=False)
    contact_phone: str | None = None
    email: str | None = None
    update_email: bool = False


@dataclass(frozen=True)
class CustomerProfile:
    display_name: str | None = None
    username: str | None = None
    username_change_available_at: datetime | None = None
    avatar_version: str | None = None
    phone: str | None = field(default=None, repr=False)
    email: str | None = field(default=None, repr=False)


@dataclass(frozen=True)
class Registration:
    name: str
    email: str | None
    username: str
    password: str = field(repr=False)


@dataclass(frozen=True)
class Session:
    account_id: str
    role: Role
    csrf_token: str
    expires_at: datetime

    def __post_init__(self):
        object.__setattr__(self, "role", Role(self.role))


def is_eligible_challenge(
    expires_at: datetime, used_at: datetime | None, attempts: int, now: datetime
) -> bool:
    return used_at is None and expires_at > now and attempts < OTP_ATTEMPTS
