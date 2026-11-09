import json
import os
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .domain import Delivery, FALLBACK_CHANNELS, SEND_TIMEOUT_SECONDS


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class ChannelTransport:
    def __init__(self, endpoint=None, secret=None, *, synthetic=False, fallback_channels=()):
        self.endpoint = endpoint
        self.secret = secret
        self.synthetic = synthetic
        self.fallback_channels = tuple(fallback_channels)
        if any(channel not in FALLBACK_CHANNELS for channel in self.fallback_channels):
            raise ValueError("Configure notice fallbacks using SMS or EMAIL.")
        self.opener = build_opener(_NoRedirect())

    @classmethod
    def from_environment(cls):
        endpoint = os.environ.get("SWEETCOMMERCE_NOTICE_ENDPOINT")
        secret = os.environ.get("SWEETCOMMERCE_NOTICE_BEARER") if endpoint else None
        fallbacks = tuple(channel.strip().upper() for channel in
                          os.environ.get("SWEETCOMMERCE_NOTICE_FALLBACK_CHANNELS", "").split(",") if channel.strip())
        synthetic = (os.environ.get("SWEETCOMMERCE_ENV") == "development"
                     and os.environ.get("SWEETCOMMERCE_NOTICE_MODE") == "synthetic")
        if endpoint:
            url = urlsplit(endpoint)
            if url.scheme != "https" or not url.hostname or url.username or url.fragment or not secret:
                raise ValueError("Notice endpoint requires an HTTPS origin and service authorization.")
        return cls(endpoint, secret, synthetic=synthetic, fallback_channels=fallbacks)

    def __call__(self, channel, destination, message, event_key):
        if self.synthetic:
            return Delivery("DELIVERED")
        if not self.endpoint:
            return Delivery("FAILED", "CHANNEL_NOT_CONFIGURED")
        request = Request(self.endpoint, method="POST", headers={
            "Authorization": "Bearer " + self.secret, "Content-Type": "application/json", "Idempotency-Key": event_key,
        }, data=json.dumps({"channel": channel, "recipient": destination, **message}).encode())
        try:
            with self.opener.open(request, timeout=SEND_TIMEOUT_SECONDS) as response:
                receipt = json.loads(response.read(4096))
        except (OSError, ValueError):
            return Delivery("UNKNOWN", "PROVIDER_OUTCOME_UNKNOWN")
        if isinstance(receipt, dict) and receipt.get("outcome") == "DELIVERED":
            return Delivery("DELIVERED")
        if isinstance(receipt, dict) and receipt.get("outcome") == "FAILED":
            return Delivery("FAILED", "PROVIDER_REJECTED", receipt.get("retryable") is True)
        return Delivery("UNKNOWN", "PROVIDER_OUTCOME_UNKNOWN")
