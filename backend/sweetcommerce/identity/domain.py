from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

Role = Literal["CUSTOMER", "ADMIN"]
Purpose = Literal["SIGN_IN", "RECOVERY"]

OTP_TTL = timedelta(minutes=5)
OTP_ATTEMPTS = 5
OTP_SENDS = 3
OTP_WINDOW = timedelta(minutes=15)
OTP_RESEND = timedelta(minutes=1)


@dataclass(frozen=True)
class Session:
    account_id: str
    role: Role
    csrf_token: str
    expires_at: datetime


def is_eligible_challenge(
    expires_at: datetime, used_at: datetime | None, attempts: int, now: datetime
) -> bool:
    return used_at is None and expires_at > now and attempts < OTP_ATTEMPTS
