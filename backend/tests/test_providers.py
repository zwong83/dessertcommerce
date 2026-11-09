import json
import traceback
from hashlib import sha256
from io import BytesIO

import pytest

from sweetcommerce.catalogue.infrastructure import LocalPrivateStore
from sweetcommerce.providers import HttpsOtpDelivery, HttpsPrivateObjectStore, ProviderError
from sweetcommerce.providers import _http


OTP_URL = "https://gateway.example.test/v1/otp"
OBJECT_URL = "https://gateway.example.test/v1/objects"
TOKEN = "test-bearer-token"
KEY = b"\x19" * 32
OTP = {"destination": "example@example.test", "code": "123456", "role": "ADMIN", "purpose": "RECOVERY"}
MAX_BYTES = 5 * 1024 * 1024


class FakeTransport:
    def __init__(self):
        self.calls = []
        self.objects = {}

    def request(self, method, url, *, headers, body, timeout, max_response_bytes):
        self.calls.append((method, url, headers, body, timeout, max_response_bytes))
        if method == "POST":
            return 202, b""
        if method == "PUT":
            assert headers["If-None-Match"] == "*"
            if url in self.objects:
                return 412, b""
            self.objects[url] = body
            return 201, b""
        if method == "GET":
            return (200, self.objects[url]) if url in self.objects else (404, b"")
        assert method == "DELETE"
        return (204, b"") if self.objects.pop(url, None) is not None else (404, b"")


def test_otp_sends_only_delivery_fields_and_uses_bounded_transport():
    http = FakeTransport()
    delivery = HttpsOtpDelivery(OTP_URL, TOKEN, timeout=1.25, transport=http)
    assert delivery({**OTP, "extra": "private metadata"}) is None
    [(method, url, headers, body, timeout, limit)] = http.calls
    assert (method, url, timeout, limit) == ("POST", OTP_URL, 1.25, 0)
    assert headers == {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
    assert json.loads(body) == OTP

    with pytest.raises(ValueError, match="too large"):
        delivery({**OTP, "destination": "x" * 4096})
    assert len(http.calls) == 1


@pytest.mark.parametrize("status", [200, 302, 401, 429, 503])
def test_otp_requires_explicit_gateway_acceptance(status):
    class RejectingTransport(FakeTransport):
        def request(self, *args, **kwargs):
            super().request(*args, **kwargs)
            return status, b""

    http = RejectingTransport()
    with pytest.raises(ProviderError, match="did not accept delivery"):
        HttpsOtpDelivery(OTP_URL, TOKEN, transport=http)(OTP)
    assert len(http.calls) == 1


def test_transport_error_discards_sensitive_context_and_logs_nothing(caplog):
    class FailingTransport:
        def request(self, method, url, *, headers, body, **kwargs):
            raise TimeoutError(f"{headers}: {body!r} at {url}")

    with pytest.raises(ProviderError, match="^Gateway request failed\\.$") as failure:
        HttpsOtpDelivery(OTP_URL, TOKEN, transport=FailingTransport())(OTP)
    assert failure.value.__context__ is None
    trace = "".join(traceback.format_exception(failure.value))
    for value in (TOKEN, OTP["code"], OTP["destination"], OTP_URL):
        assert value not in trace
        assert value not in caplog.text


@pytest.mark.parametrize("endpoint", [
    "http://gateway.example.test/otp", "https://secret@gateway.example.test/otp",
    "https://gateway.example.test/otp?secret", "https://gateway.example.test/otp#secret",
    "https://gateway.example.test:secret/otp", "https://gateway.example.test/ot\np", "https:///otp",
])
def test_invalid_endpoints_fail_before_transport(endpoint):
    http = FakeTransport()
    with pytest.raises(ValueError, match="^A valid HTTPS gateway endpoint is required\\.$") as failure:
        HttpsOtpDelivery(endpoint, TOKEN, transport=http)
    assert failure.value.__context__ is None
    assert not http.calls


@pytest.mark.parametrize("timeout", [0, -1, 11, float("inf"), float("nan")])
def test_timeout_configuration_is_bounded(timeout):
    with pytest.raises(ValueError, match="Gateway timeout"):
        HttpsOtpDelivery(OTP_URL, TOKEN, timeout=timeout)


def test_credentials_and_aes_key_are_required():
    for token in ("", "test\r\ninjected: header"):
        with pytest.raises(ValueError, match="valid gateway bearer token"):
            HttpsOtpDelivery(OTP_URL, token)
    with pytest.raises(ValueError, match="32-byte key"):
        HttpsPrivateObjectStore(OBJECT_URL, TOKEN, b"short")


def test_shared_store_interoperates_with_local_format_and_creates_once(tmp_path):
    http = FakeTransport()
    writer = HttpsPrivateObjectStore(OBJECT_URL + "/", TOKEN, KEY, transport=http)
    reader = HttpsPrivateObjectStore(OBJECT_URL, TOKEN, KEY, transport=http)
    local = LocalPrivateStore(tmp_path, KEY)
    key, data = "proofs/receipt", b"private receipt content"
    digest = sha256(key.encode()).hexdigest()
    url = f"{OBJECT_URL}/{digest}"

    assert reader.get(key) is None
    writer.put(key, data)
    envelope = http.objects[url]
    assert data not in envelope
    assert len(envelope) == len(data) + 28
    assert http.calls[-1][2] == {
        "Authorization": f"Bearer {TOKEN}", "Content-Type": "application/octet-stream", "If-None-Match": "*",
    }
    with pytest.raises(FileExistsError):
        writer.put(key, b"different bytes")
    assert http.objects[url] == envelope
    assert reader.get(key) == data
    assert http.calls[-1][-1] == MAX_BYTES + 28

    (tmp_path / digest).write_bytes(envelope)
    assert local.get(key) == data
    local_key = "catalogue/é"
    local_digest = sha256(local_key.encode()).hexdigest()
    local.put(local_key, b"local content")
    http.objects[f"{OBJECT_URL}/{local_digest}"] = (tmp_path / local_digest).read_bytes()
    assert reader.get(local_key) == b"local content"

    reader.delete(key)
    reader.delete(key)
    assert writer.get(key) is None


def test_object_store_rejects_tampering_swaps_and_wrong_key():
    http = FakeTransport()
    store = HttpsPrivateObjectStore(OBJECT_URL, TOKEN, KEY, transport=http)
    store.put("one", b"sensitive bytes")
    url, envelope = next(iter(http.objects.items()))
    http.objects[f"{OBJECT_URL}/{sha256(b'two').hexdigest()}"] = envelope
    with pytest.raises(ProviderError, match="authentication failed"):
        store.get("two")
    with pytest.raises(ProviderError, match="authentication failed"):
        HttpsPrivateObjectStore(OBJECT_URL, TOKEN, b"\x07" * 32, transport=http).get("one")
    http.objects[url] = envelope[:-1] + bytes([envelope[-1] ^ 1])
    with pytest.raises(ProviderError, match="authentication failed") as failure:
        store.get("one")
    assert failure.value.__context__ is None
    http.objects[url] = envelope[:27]
    with pytest.raises(ProviderError, match="object read failed"):
        store.get("one")


def test_object_size_limit_applies_to_uploads_and_injected_responses():
    http = FakeTransport()
    store = HttpsPrivateObjectStore(OBJECT_URL, TOKEN, KEY, transport=http)
    with pytest.raises(ValueError, match="object is too large"):
        store.put("one", b"x" * (MAX_BYTES + 1))
    assert not http.calls
    store.put("one", b"x" * MAX_BYTES)
    assert store.get("one") == b"x" * MAX_BYTES
    url = next(iter(http.objects))
    http.objects[url] += b"x"
    with pytest.raises(ProviderError, match="Gateway request failed"):
        store.get("one")


def test_object_gateway_failure_is_never_treated_as_success_or_absence():
    class ForbiddenTransport:
        def request(self, *args, **kwargs):
            return 403, b""

    store = HttpsPrivateObjectStore(OBJECT_URL, TOKEN, KEY, transport=ForbiddenTransport())
    with pytest.raises(ProviderError, match="object write failed"):
        store.put("one", b"data")
    with pytest.raises(ProviderError, match="object read failed"):
        store.get("one")
    with pytest.raises(ProviderError, match="object delete failed"):
        store.delete("one")


class FakeResponse(BytesIO):
    def __init__(self, status, payload, length=None):
        super().__init__(payload)
        self.status = status
        self.length = length
        self.read_sizes = []

    def read(self, size=-1):
        self.read_sizes.append(size)
        return super().read(size)


@pytest.mark.parametrize(("status", "length", "payload", "reads"), [
    (307, None, b"redirect body", []),
    (200, MAX_BYTES + 29, b"", []),
    (200, None, b"x" * (MAX_BYTES + 29), [MAX_BYTES + 29]),
    (200, 40, b"short", [MAX_BYTES + 29]),
])
def test_default_transport_makes_one_request_and_bounds_response(monkeypatch, status, length, payload, reads):
    response = FakeResponse(status, payload, length)
    calls = []

    class FakeConnection:
        def __init__(self, hostname, port, *, timeout):
            calls.append((hostname, port, timeout))

        def request(self, method, path, *, body, headers):
            calls.append((method, path, body, headers))

        def getresponse(self):
            return response

        def close(self):
            calls.append("closed")

    monkeypatch.setattr(_http, "HTTPSConnection", FakeConnection)
    with pytest.raises(ProviderError):
        HttpsPrivateObjectStore(OBJECT_URL, TOKEN, KEY).get("object")
    connected, requested, closed = calls
    assert connected == ("gateway.example.test", None, 3.0)
    assert requested[:3] == ("GET", f"/v1/objects/{sha256(b'object').hexdigest()}", None)
    assert requested[3]["Authorization"] == f"Bearer {TOKEN}"
    assert closed == "closed"
    assert response.closed
    assert response.read_sizes == reads
