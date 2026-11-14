import logging
from dataclasses import dataclass
from hashlib import sha256
from random import uniform
from time import monotonic

from ..capacity.domain import require_role, uuid
from ..capacity.infrastructure import command
from ..clock import utc_now
from ..problems import InvalidTransition, Problem, ResourceNotFound, validation
from ..values import field_string
from ..work.domain import work_item
from . import eligibility
from . import infrastructure as store
from .domain import (
    FALLBACK_CHANNELS,
    LEASE_SECONDS,
    RETRY_DELAYS,
    SEND_TIMEOUT_SECONDS,
    Delivery,
    destinations,
    milestone,
    notice_message,
    notice_view,
    safe_delivery,
)

logger = logging.getLogger(__name__)
_CHANNELS = ("WHATSAPP", *FALLBACK_CHANNELS)
_MAX_ATTEMPTS = 1 + len(RETRY_DELAYS)


@dataclass(frozen=True)
class _Prepared:
    attempt: int
    channel: str
    contacts: dict[str, str]
    message: dict


def _fallback_after(channel, contacts):
    if channel not in _CHANNELS:
        return None
    return next((candidate for candidate in _CHANNELS[_CHANNELS.index(channel) + 1:] if candidate in contacts), None)


def _prepare(conn, work, fallbacks):
    history = store.attempts(conn, work["id"])
    latest = history[-1] if history else None
    if work["previous_state"] == "LEASED" or (latest and latest["outcome"] == "UNKNOWN"):
        if latest and latest["safe_reason"] == "IN_FLIGHT":
            store.finish_attempt(conn, work, latest["attempt_no"], Delivery("UNKNOWN", "LEASE_EXPIRED"))
        store.finish_notice(conn, work, "DEAD", "LEASE_EXPIRED")
        return "unknown"
    if latest and latest["outcome"] == "DELIVERED":
        store.finish_notice(conn, work, "SUCCEEDED")
        return "delivered"

    data = work["payload"]
    if work["payload_version"] != 1 or not isinstance(data, dict):
        store.finish_notice(conn, work, "DEAD", "INVALID_NOTICE_PAYLOAD")
        return "failed"
    if not eligibility.current(conn, work, milestone(data), data):
        store.finish_notice(conn, work, "SUCCEEDED", "OBSOLETE")
        return "obsolete"

    contact = store.context(conn, work)
    contacts = destinations(contact, fallbacks) if contact else {}
    if latest is None:
        channel = next((candidate for candidate in _CHANNELS if candidate in contacts), None)
    elif work["last_safe_error"] == "FALLBACK_SCHEDULED" or latest["channel"] not in contacts:
        channel = _fallback_after(latest["channel"], contacts)
    else:
        channel = latest["channel"]

    attempt = (latest["attempt_no"] if latest else 0) + 1
    if attempt > _MAX_ATTEMPTS or channel is None:
        reason = "RETRY_BUDGET_EXHAUSTED" if attempt > _MAX_ATTEMPTS else "NO_ELIGIBLE_CONTACT"
        store.finish_notice(conn, work, "DEAD", reason)
        return "failed"
    store.start_attempt(conn, work, attempt, channel)
    return _Prepared(attempt, channel, contacts, notice_message(data, contact["source_number"]))


def _complete(db, work, prepared, result):
    with db.transaction() as conn:
        if store.fenced_notice(conn, work) is None:
            return "stale-lease"
        store.finish_attempt(conn, work, prepared.attempt, result)
        if result.outcome == "DELIVERED":
            store.finish_notice(conn, work, "SUCCEEDED")
            return "delivered"
        if result.outcome == "FAILED" and prepared.attempt < _MAX_ATTEMPTS:
            fallback = _fallback_after(prepared.channel, prepared.contacts)
            if result.retryable or fallback is not None:
                delay = round(RETRY_DELAYS[prepared.attempt - 1] * uniform(0.9, 1.1))
                reason = result.safe_reason if result.retryable else "FALLBACK_SCHEDULED"
                store.finish_notice(conn, work, "READY", reason, delay=delay)
                return "retry"
        store.finish_notice(conn, work, "DEAD", result.safe_reason)
        return result.outcome.lower()


def poll_notice(db, transport):
    send_by = monotonic() + LEASE_SECONDS - SEND_TIMEOUT_SECONDS
    with db.transaction() as conn:
        work = store.claim_notice(conn)
        if work is None:
            return None
        prepared = _prepare(conn, work, getattr(transport, "fallback_channels", ()))

    if isinstance(prepared, _Prepared):
        # An attempt is durably marked in flight before the provider can receive it.
        if monotonic() >= send_by:
            return "stale-lease"
        provider_key = sha256(f"{work['event_key']}:{prepared.channel}".encode()).hexdigest()
        try:
            result = safe_delivery(transport(prepared.channel, prepared.contacts[prepared.channel], prepared.message, provider_key))
        except Exception:
            result = Delivery("UNKNOWN", "PROVIDER_OUTCOME_UNKNOWN")
        outcome = _complete(db, work, prepared, result)
    else:
        outcome = prepared
    if outcome in ("failed", "unknown"):
        logger.warning("feature=notification action=deliver outcome=%s notice_id=%s", outcome, work["id"])
    return outcome


class NoticeService:
    def __init__(self, db, *, clock=utc_now):
        self.db = db
        self.clock = clock

    def get(self, actor, notice_id):
        require_role(actor, "ADMIN")
        try:
            notice_id = uuid(notice_id)
        except Problem:
            raise Problem("VALIDATION", 400, "Use a valid notice identifier.") from None
        with self.db.transaction() as conn:
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            work = self._read(conn, notice_id)
            return notice_view(work, store.attempts(conn, notice_id), store.followup(conn, notice_id))

    def resolve(self, actor, notice_id, body, context):
        admin = require_role(actor, "ADMIN")
        notice_id = uuid(notice_id)
        disposition = body.get("disposition")
        if disposition not in ("MANUAL_CONTACT", "PROVIDER_RECONCILED"):
            raise validation("Choose a follow-up disposition.")
        reason = field_string(body.get("reason"), "the follow-up reason", max_length=500).strip()
        if "\x00" in reason or any(0xD800 <= ord(character) <= 0xDFFF for character in reason):
            raise validation("Check the follow-up reason.")

        def run(conn):
            work = self._read(conn, notice_id)
            outcome = notice_view(work, store.attempts(conn, notice_id), None)["status"]
            if work["work_state"] != "DEAD" or outcome not in ("FAILED", "UNKNOWN"):
                raise InvalidTransition("Only a failed or unknown delivery can be resolved.")
            now = self.clock()
            if not store.record_followup(conn, notice_id, admin, disposition, reason, now, context.request_id):
                raise InvalidTransition("This delivery follow-up has already been recorded.")
            response = work_item({**work, "status": "RESOLVED", "updated_at": now, "notice_outcome": outcome})
            response["safeNextAction"] = "No further delivery action is pending."
            return response

        with self.db.transaction() as conn:
            return command(conn, admin, "resolveNotificationFailure", context, [notice_id, disposition, reason], lambda: run(conn))

    @staticmethod
    def _read(conn, notice_id):
        work = store.read_notice(conn, notice_id)
        if work is None:
            raise ResourceNotFound("This notice was not found.")
        return work
