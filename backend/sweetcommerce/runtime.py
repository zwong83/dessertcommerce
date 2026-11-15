import base64
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from .problems import unavailable

ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    dsn: str = field(repr=False)
    identity_key: bytes = field(repr=False)
    origin: str
    synthetic_otp: str | None = field(default=None, repr=False)
    local_storage: bool = False
    pool_size: int = 8
    send_budget: int = 250
    terms_version: str | None = None
    terms_text: str | None = None
    pickup_label: str | None = None
    duitnow_qr_url: str | None = None
    whatsapp_url: str | None = None
    otp_gateway: tuple[str, str] | None = field(default=None, repr=False)
    object_gateway: tuple[str, str] | None = field(default=None, repr=False)
    object_key: bytes | None = field(default=None, repr=False)
    customer_phone_verification: bool = False

    @classmethod
    def from_environment(cls):
        try:
            dsn = os.environ["DATABASE_URL"]
            key = os.environ["SWEETCOMMERCE_IDENTITY_KEY"]
            if not dsn or not re.fullmatch(r"[A-Za-z0-9_-]{43}", key):
                raise ValueError
            identity_key = base64.urlsafe_b64decode(key + "=")
            origin = os.environ.get("SWEETCOMMERCE_ORIGIN", "http://127.0.0.1:3000")
            parsed = urlsplit(origin)
            loopback = parsed.hostname in {"127.0.0.1", "localhost"}
            if (
                origin != f"{parsed.scheme}://{parsed.netloc}"
                or parsed.username is not None
                or not parsed.hostname
                or (parsed.scheme != "https" and (parsed.scheme != "http" or not loopback))
            ):
                raise ValueError
            local = loopback and "production" not in {
                os.environ.get("NODE_ENV"), os.environ.get("SWEETCOMMERCE_ENV"),
            }
            otp = os.environ.get("SWEETCOMMERCE_SYNTHETIC_OTP", "")
            synthetic = local and os.environ.get("SWEETCOMMERCE_OTP_MODE") == "synthetic" and re.fullmatch(r"[0-9]{6}", otp)
            pool_size = int(os.environ.get("SWEETCOMMERCE_DB_POOL", "8"))
            send_budget = int(os.environ.get("SWEETCOMMERCE_OTP_SEND_BUDGET", "250"))
            whatsapp_url = os.environ.get("SWEETCOMMERCE_WHATSAPP_URL")
            if whatsapp_url:
                url = urlsplit(whatsapp_url)
                if url.scheme != "https" or url.hostname not in {"wa.me", "api.whatsapp.com"} or url.username:
                    raise ValueError
            otp_gateway = _gateway("OTP")
            phone_verification = os.environ.get("SWEETCOMMERCE_CUSTOMER_PHONE_VERIFICATION", "false")
            if phone_verification not in ("true", "false"):
                raise ValueError
            object_gateway = _gateway("OBJECT")
            object_key = os.environ.get("SWEETCOMMERCE_OBJECT_KEY")
            if object_key is not None and not re.fullmatch(r"[A-Za-z0-9_-]{43}", object_key):
                raise ValueError
            storage_key = base64.urlsafe_b64decode(object_key + "=") if object_key else None
            if not local and (otp_gateway is None or object_gateway is None):
                raise ValueError
            if pool_size < 1 or send_budget < 1:
                raise ValueError
        except (KeyError, ValueError):
            raise unavailable() from None

        return cls(
            dsn, identity_key, origin, otp if synthetic else None, local, pool_size, send_budget,
            os.environ.get("SWEETCOMMERCE_TERMS_VERSION"), os.environ.get("SWEETCOMMERCE_TERMS_TEXT"),
            os.environ.get("SWEETCOMMERCE_PICKUP_DISPLAY"), os.environ.get("SWEETCOMMERCE_DUITNOW_QR_URL"),
            whatsapp_url, otp_gateway, object_gateway, storage_key, phone_verification == "true",
        )

    def otp_delivery(self):
        from .providers import HttpsOtpDelivery

        if self.otp_gateway is not None and self.synthetic_otp is None:
            return HttpsOtpDelivery(*self.otp_gateway)
        return self.deliver_otp

    def private_objects(self):
        import hmac
        from .catalogue.infrastructure import LocalPrivateStore
        from .providers import HttpsPrivateObjectStore

        key = self.object_key or hmac.digest(self.identity_key, b"local-private-v1", "sha256")
        if self.object_gateway:
            return HttpsPrivateObjectStore(*self.object_gateway, key)
        if self.local_storage:
            return LocalPrivateStore(ROOT / ".cache" / "private-objects", key)
        return UnavailableObjects()

    def deliver_otp(self, _message) -> None:
        if not self.synthetic_otp:
            raise unavailable()

    def terms(self) -> dict:
        if self.terms_version and self.terms_text:
            return {"version": self.terms_version, "text": self.terms_text}
        if self.synthetic_otp:
            return {"version": "synthetic-v1", "text": "Synthetic ordering terms for this local demonstration."}
        raise unavailable()

    def pickup_display(self) -> str:
        if self.pickup_label:
            return self.pickup_label
        if self.synthetic_otp:
            return "Sample pickup point (local demonstration)"
        raise unavailable()


def _gateway(name):
    url = os.environ.get(f"SWEETCOMMERCE_{name}_GATEWAY_URL")
    bearer = os.environ.get(f"SWEETCOMMERCE_{name}_GATEWAY_BEARER")
    if url is None and bearer is None:
        return None
    if not url or not bearer:
        raise ValueError
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.fragment or parsed.query:
        raise ValueError
    return url, bearer


class UnavailableObjects:
    def put(self, key, data):
        raise unavailable()

    def get(self, key):
        raise unavailable()
