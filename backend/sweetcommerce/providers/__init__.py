"""Provider-neutral adapters for OTP delivery and shared private object storage."""

import json
from hashlib import sha256
from secrets import token_bytes
from typing import TYPE_CHECKING

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ._http import Gateway, HttpTransport, ProviderError

if TYPE_CHECKING:
    from ..identity.application import OtpMessage

__all__ = ["HttpTransport", "HttpsOtpDelivery", "HttpsPrivateObjectStore", "ProviderError"]

_MAX_OTP_BYTES = 4096
_MAX_OBJECT_BYTES = 5 * 1024 * 1024
_NONCE_BYTES = 12
_TAG_BYTES = 16
_ENVELOPE_BYTES = _NONCE_BYTES + _TAG_BYTES
_BINARY = "application/octet-stream"


class HttpsOtpDelivery:
    """POST destination, code, role and purpose as JSON. HTTP 202 means accepted for delivery."""

    def __init__(self, endpoint: str, token: str, *, timeout: float = 3.0, transport: HttpTransport | None = None):
        self._gateway = Gateway(endpoint, token, timeout, transport)

    def __call__(self, message: "OtpMessage") -> None:
        payload = {field: message.get(field) for field in ("destination", "code", "role", "purpose")}
        if any(not isinstance(value, str) or not 0 < len(value) <= _MAX_OTP_BYTES for value in payload.values()):
            raise ValueError("Invalid OTP gateway message.")
        body = json.dumps(payload, separators=(",", ":")).encode()
        if len(body) > _MAX_OTP_BYTES:
            raise ValueError("OTP gateway message is too large.")
        status, _ = self._gateway.request("POST", headers={"Content-Type": "application/json"}, body=body)
        if status != 202:
            raise ProviderError("OTP gateway did not accept delivery.")


class HttpsPrivateObjectStore:
    """Store local-format AES-256-GCM envelopes at endpoint/<sha256 of UTF-8 key>.

    PUT with If-None-Match: * must atomically create the object (201), or report
    an existing object (412). GET returns the envelope (200) or absence (404).
    DELETE returns 204 or 404. Only an absent object returns 404. The gateway
    must serve a private namespace and make changes visible to all clients immediately.
    """

    def __init__(
        self, endpoint: str, token: str, key: bytes, *, timeout: float = 3.0, transport: HttpTransport | None = None,
    ):
        if not isinstance(key, bytes) or len(key) != 32:
            raise ValueError("Private storage requires a 32-byte key.")
        self._cipher = AESGCM(key)
        self._gateway = Gateway(endpoint, token, timeout, transport)

    def put(self, key: str, data: bytes) -> None:
        if len(data) > _MAX_OBJECT_BYTES:
            raise ValueError("Private object is too large.")
        aad = key.encode()
        nonce = token_bytes(_NONCE_BYTES)
        encrypted = self._cipher.encrypt(nonce, data, aad)
        # The local format places the authentication tag before the ciphertext.
        envelope = nonce + encrypted[-_TAG_BYTES:] + encrypted[:-_TAG_BYTES]
        status, _ = self._gateway.request(
            "PUT", object_id=sha256(aad).hexdigest(), body=envelope,
            headers={"Content-Type": _BINARY, "If-None-Match": "*"},
        )
        if status == 412:
            raise FileExistsError("Private object already exists.")
        if status != 201:
            raise ProviderError("Private object write failed.")

    def get(self, key: str) -> bytes | None:
        aad = key.encode()
        status, envelope = self._gateway.request(
            "GET", object_id=sha256(aad).hexdigest(),
            headers={"Accept": _BINARY, "Cache-Control": "no-store, no-cache"},
            max_response_bytes=_MAX_OBJECT_BYTES + _ENVELOPE_BYTES,
        )
        if status == 404:
            return None
        if status != 200 or len(envelope) < _ENVELOPE_BYTES:
            raise ProviderError("Private object read failed.")
        nonce, tag = envelope[:_NONCE_BYTES], envelope[_NONCE_BYTES:_ENVELOPE_BYTES]
        try:
            return self._cipher.decrypt(nonce, envelope[_ENVELOPE_BYTES:] + tag, aad)
        except InvalidTag:
            pass
        raise ProviderError("Private object authentication failed.")

    def delete(self, key: str) -> None:
        status, _ = self._gateway.request("DELETE", object_id=sha256(key.encode()).hexdigest())
        if status not in (204, 404):
            raise ProviderError("Private object delete failed.")
