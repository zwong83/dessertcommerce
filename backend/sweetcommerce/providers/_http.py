"""Bounded HTTPS requests for the gateway adapters."""

import re
from collections.abc import Mapping
from http.client import HTTPSConnection
from typing import Protocol
from urllib.parse import SplitResult, urlsplit


class ProviderError(RuntimeError):
    """The gateway request or response failed without exposing its contents."""


class HttpTransport(Protocol):
    def request(
        self, method: str, url: str, *, headers: Mapping[str, str], body: bytes | None,
        timeout: float, max_response_bytes: int,
    ) -> tuple[int, bytes]:
        """Return status and bounded bytes for a 200 GET, or empty bytes otherwise."""
        ...


class _HttpsTransport:
    def request(
        self, method: str, url: str, *, headers: Mapping[str, str], body: bytes | None,
        timeout: float, max_response_bytes: int,
    ) -> tuple[int, bytes]:
        target = urlsplit(url)
        # HTTPSConnection verifies certificates and does not use proxies or follow redirects.
        connection = HTTPSConnection(target.hostname, target.port, timeout=timeout)
        try:
            connection.request(method, target.path or "/", body=body, headers=headers)
            with connection.getresponse() as response:
                if method != "GET" or response.status != 200:
                    return response.status, b""

                length = response.length
                if length is not None and length > max_response_bytes:
                    raise ProviderError("Gateway response is too large.")
                payload = response.read(max_response_bytes + 1)
                if len(payload) > max_response_bytes or (length is not None and len(payload) != length):
                    raise ProviderError("Invalid gateway response size.")
                return response.status, payload
        finally:
            connection.close()


def _https_endpoint(endpoint: str) -> SplitResult:
    if (
        not isinstance(endpoint, str)
        or not re.fullmatch(r"[!-~]{1,2048}", endpoint)
        or any(character in endpoint for character in "\\?#")
    ):
        raise ValueError("A valid HTTPS gateway endpoint is required.")
    try:
        target = urlsplit(endpoint)
        if (
            target.scheme == "https" and target.hostname and target.port != 0
            and target.username is None and not target.netloc.endswith(":")
        ):
            return target
    except ValueError:
        pass
    raise ValueError("A valid HTTPS gateway endpoint is required.")


class Gateway:
    """Use a per-socket-operation timeout in seconds and make one request per call."""

    def __init__(self, endpoint: str, token: str, timeout: float, transport: HttpTransport | None):
        self._endpoint = _https_endpoint(endpoint)
        if not isinstance(token, str) or len(token) > 4096 or not re.fullmatch(r"[A-Za-z0-9._~+/\-]+=*", token):
            raise ValueError("A valid gateway bearer token is required.")
        if type(timeout) not in (int, float) or not 0 < timeout <= 10:
            raise ValueError("Gateway timeout must be greater than zero and at most ten seconds.")
        self._token = token
        self._timeout = timeout
        self._transport = transport if transport is not None else _HttpsTransport()

    def request(
        self, method: str, *, headers: Mapping[str, str] | None = None, body: bytes | None = None,
        object_id: str | None = None, max_response_bytes: int = 0,
    ) -> tuple[int, bytes]:
        target = self._endpoint
        if object_id is not None:
            target = target._replace(path=f"{target.path.rstrip('/')}/{object_id}")
        try:
            status, payload = self._transport.request(
                method, target.geturl(), headers={"Authorization": f"Bearer {self._token}", **(headers or {})},
                body=body, timeout=self._timeout, max_response_bytes=max_response_bytes,
            )
            if type(status) is int and isinstance(payload, bytes) and len(payload) <= max_response_bytes:
                return status, payload
        except Exception:
            # Transport exceptions can carry headers, URLs, or raw response bytes.
            pass
        raise ProviderError("Gateway request failed.")
