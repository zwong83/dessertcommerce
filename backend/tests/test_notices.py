import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from psycopg.types.json import Jsonb

from conftest import API
from sweetcommerce.clock import iso
from sweetcommerce.db import one, rows
from sweetcommerce.notices.application import poll_notice
from sweetcommerce.notices.domain import Delivery, RETRY_DELAYS, SEND_TIMEOUT_SECONDS, notice_message
from sweetcommerce.notices.transport import ChannelTransport
from sweetcommerce.settlement.infrastructure import enqueue_work
from test_event_settlement import _proof, _receipt, _seed
from test_expiry import TOP_UP, expiry_fixture

HOUR = timedelta(hours=1)
PHONE = "+60123456789"
EMAIL = "synthetic@example.test"
CONTRACT = Path(__file__).resolve().parents[2] / "output/SD/contracts/sweetcommerce-v1.0.4.1.openapi.json"


class SyntheticTransport:
    def __init__(self, *results, fallback_channels=()):
        self.results = iter(results)
        self.calls = []
        self.fallback_channels = fallback_channels

    def __call__(self, channel, destination, message, provider_key):
        self.calls.append((channel, destination, message, provider_key))
        return next(self.results)


def _event(db, now, *, owner=None, email=None):
    event = uuid4()
    number = "EV-" + event.hex.upper()
    with db.transaction() as conn:
        if owner is None:
            owner = uuid4()
            conn.execute("INSERT INTO account (id,role,phone_e164) VALUES (%s,'CUSTOMER',%s)", (owner, PHONE))
        conn.execute("""
            INSERT INTO event_application (id,event_number,account_id,submission_intent_id,submission_digest,status,
              event_date,start_at,expected_end_at,setup_ready_at,request_snapshot,created_at,updated_at)
            VALUES (%s,%s,%s,%s,'synthetic','APPLIED',%s,%s,%s,%s,%s,%s,%s)
        """, (event, number, owner, uuid4(), now.date(), now + HOUR, now + 2 * HOUR, now,
              Jsonb({"notificationEmail": email, "address": "Private address"}), now, now))
    return event, number


def _enqueue(db, source, now, milestone="EVENT_REQUEST_RECEIVED", **data):
    event_key = f"{milestone}:{source}:{uuid4()}"
    with db.transaction() as conn:
        for _ in range(2):
            enqueue_work(conn, event_key, "NOTICE", source, now, now, {"milestone": milestone, **data})
        return one(conn, "SELECT id FROM durable_work WHERE event_key=%s", (event_key,))["id"]


def _work(db, notice):
    with db.connection() as conn:
        return one(conn, "SELECT * FROM durable_work WHERE id=%s", (notice,))


def _attempts(db, notice):
    with db.connection() as conn:
        return rows(conn, "SELECT * FROM notice_attempt WHERE work_id=%s ORDER BY attempt_no", (notice,))


def _make_due(worker_db, notice):
    with worker_db.transaction() as conn:
        conn.execute("UPDATE durable_work SET not_before=clock_timestamp()-interval '1 second' WHERE id=%s", (notice,))


def _assert_contract(response, name):
    schema = json.loads(CONTRACT.read_text())["components"]["schemas"][name]
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(response.json())


def test_allowlisted_message_and_explicit_fallback_configuration(monkeypatch):
    monkeypatch.setenv("SWEETCOMMERCE_NOTICE_FALLBACK_CHANNELS", "sms, EMAIL")
    monkeypatch.setenv("SWEETCOMMERCE_NOTICE_ENDPOINT", "")
    assert ChannelTransport.from_environment().fallback_channels == ("SMS", "EMAIL")
    assert notice_message({
        "milestone": "EVENT_SUPPLEMENT_REQUESTED", "deadline": "2030-01-01T00:00:00Z", "outstandingMinor": 75,
        "caseId": str(uuid4()), "customerReason": "Private note", "address": "Private address", "proof": "Private evidence",
    }, "EV-SYNTHETIC") == {
        "milestone": "EVENT_SUPPLEMENT_REQUESTED", "reference": "EV-SYNTHETIC",
        "deadline": "2030-01-01T00:00:00.000Z", "outstandingMinor": 75,
    }
    with pytest.raises(ValueError):
        ChannelTransport(fallback_channels=("PUSH",))


def test_provider_adapter_uses_bounded_call_and_quarantines_ambiguous_response():
    transport = ChannelTransport("https://provider.example.test/send", "synthetic")
    message = {"milestone": "EVENT_REQUEST_RECEIVED", "reference": "EV-SYNTHETIC"}

    class SyntheticOpener:
        def open(self, request, *, timeout):
            assert timeout == SEND_TIMEOUT_SECONDS
            assert request.get_header("Idempotency-key") == "synthetic-provider-key"
            assert json.loads(request.data) == {"channel": "WHATSAPP", "recipient": PHONE, **message}
            raise TimeoutError

    transport.opener = SyntheticOpener()
    assert transport("WHATSAPP", PHONE, message, "synthetic-provider-key") == Delivery("UNKNOWN", "PROVIDER_OUTCOME_UNKNOWN")


def test_initial_and_three_safe_retries_share_a_provider_key(db, worker_db, caplog):
    now = datetime.now(UTC)
    event, _ = _event(db, now, email=EMAIL)
    notice = _enqueue(db, event, now)
    transport = SyntheticTransport(*[Delivery("FAILED", "Private provider error", True)] * 4, fallback_channels=("EMAIL",))

    for seconds in RETRY_DELAYS:
        assert poll_notice(worker_db, transport) == "retry"
        scheduled = (_work(db, notice)["not_before"] - datetime.now(UTC)).total_seconds()
        assert seconds * 0.9 - 2 <= scheduled <= seconds * 1.1
        assert poll_notice(worker_db, transport) is None
        _make_due(worker_db, notice)
    assert poll_notice(worker_db, transport) == "failed"
    assert poll_notice(worker_db, transport) is None
    assert _work(db, notice)["attempt_count"] == 4
    assert _work(db, notice)["work_state"] == "DEAD"
    attempts = _attempts(db, notice)
    assert [attempt["attempt_no"] for attempt in attempts] == [1, 2, 3, 4]
    assert {attempt["safe_reason"] for attempt in attempts} == {"PROVIDER_REJECTED"}
    assert {call[0] for call in transport.calls} == {"WHATSAPP"}
    assert len({call[3] for call in transport.calls}) == 1
    assert "outcome=failed" in caplog.text and "Private provider error" not in caplog.text


def test_expired_in_flight_attempt_is_quarantined_and_old_completion_is_fenced(db, worker_db):
    now = datetime.now(UTC)
    event, _ = _event(db, now, email=EMAIL)
    notice = _enqueue(db, event, now)
    replacement = SyntheticTransport(Delivery("DELIVERED"), fallback_channels=("EMAIL",))

    def interrupted(channel, destination, message, key):
        assert len(_attempts(db, notice)) == 1
        assert poll_notice(worker_db, replacement) is None
        with worker_db.transaction() as conn:
            claim = one(conn, "SELECT lease_token FROM durable_work WHERE id=%s", (notice,))
            conn.execute("UPDATE durable_work SET lease_until=clock_timestamp()-interval '1 second' WHERE id=%s", (notice,))
            assert one(conn, "SELECT * FROM sweetcommerce.notice_recipient(%s,%s)", (notice, claim["lease_token"])) is None
        assert poll_notice(worker_db, replacement) == "unknown"
        return Delivery("DELIVERED")

    assert poll_notice(worker_db, interrupted) == "stale-lease"
    assert poll_notice(worker_db, replacement) is None
    assert replacement.calls == []
    assert _work(db, notice)["work_state"] == "DEAD"
    assert [(a["outcome"], a["safe_reason"]) for a in _attempts(db, notice)] == [("UNKNOWN", "LEASE_EXPIRED")]


@pytest.mark.parametrize(("configured", "email", "outcome", "channels"), [
    (("EMAIL",), EMAIL, "FAILED", ["WHATSAPP", "EMAIL"]),
    (("SMS",), None, "FAILED", ["WHATSAPP", "SMS"]),
    ((), EMAIL, "FAILED", ["WHATSAPP"]),
    (("EMAIL",), "not-an-email", "FAILED", ["WHATSAPP"]),
    (("EMAIL",), EMAIL, "UNKNOWN", ["WHATSAPP"]),
])
def test_fallback_requires_definitive_failure_and_eligible_configured_contact(db, worker_db, configured, email, outcome, channels):
    now = datetime.now(UTC)
    event, number = _event(db, now, email=email)
    notice = _enqueue(db, event, now, reference="untrusted reference", proof="private proof", address="private address",
                      bankIdentifier="private bank identifier", customerReason="private explanation")
    transport = SyntheticTransport(Delivery(outcome), Delivery("DELIVERED"), fallback_channels=configured)
    first = poll_notice(worker_db, transport)
    if len(channels) == 2:
        assert first == "retry"
        _make_due(worker_db, notice)
        assert poll_notice(worker_db, transport) == "delivered"
        assert transport.calls[0][3] != transport.calls[1][3]
    else:
        assert first == outcome.lower()
    assert poll_notice(worker_db, transport) is None
    assert [call[0] for call in transport.calls] == channels
    for channel, destination, message, _ in transport.calls:
        assert destination == (EMAIL if channel == "EMAIL" else PHONE)
        assert message == {"milestone": "EVENT_REQUEST_RECEIVED", "reference": number}


@pytest.mark.parametrize("quote_status", ["OFFERED", "SUPERSEDED"])
def test_quote_reminder_rechecks_active_quote(db, worker_db, quote_status):
    now = datetime.now(UTC)
    event, quote, _, _, cutoff, _ = _seed(db, now, status="QUOTED")
    with db.transaction() as conn:
        conn.execute("UPDATE event_quote SET status=%s WHERE id=%s", (quote_status, quote))
    notice = _enqueue(db, event, now, "EVENT_QUOTE_EXPIRY_REMINDER", quoteId=str(quote), revision=1, deadline=iso(cutoff))
    transport = SyntheticTransport(Delivery("DELIVERED"))
    current = quote_status == "OFFERED"
    assert poll_notice(worker_db, transport) == ("delivered" if current else "obsolete")
    assert len(_attempts(db, notice)) == int(current)


@pytest.mark.parametrize("state", ["current", "rescheduled", "cancelled", "settled", "under_review"])
def test_balance_reminder_rechecks_revision_state_and_timely_review(db, worker_db, state):
    now = datetime.now(UTC)
    due, cutoff = now - HOUR, now + HOUR
    event, quote, _, _, _, _ = _seed(db, now, status="QUOTED", cutoff=due - 2 * HOUR)
    charge = uuid4()
    with db.transaction() as conn:
        conn.execute("""
            UPDATE event_application SET status=%s,effective_balance_due_at=%s,effective_balance_grace_ends_at=%s,
              balance_deadline_revision=%s WHERE id=%s
        """, ("CANCELLED" if state == "cancelled" else "BOOKED", due, cutoff, 2 if state == "rescheduled" else 1, event))
        conn.execute("UPDATE event_quote SET status='CONFIRMED' WHERE id=%s", (quote,))
        conn.execute("""
            INSERT INTO charge (id,event_id,quote_id,category,state,expected_minor,due_at,created_at)
            VALUES (%s,%s,%s,'EVENT_BALANCE',%s,500,%s,%s)
        """, (charge, event, quote, "PAID" if state == "settled" else "OPEN", due, now))
    if state == "under_review":
        assert _proof(db, event, charge, now)[1] == "TIMELY"
    notice = _enqueue(db, event, now, "EVENT_BALANCE_DUE", chargeId=str(charge), revision=1,
                      deadline=iso(due), cutoff=iso(cutoff), phase="DUE")
    transport = SyntheticTransport(Delivery("DELIVERED"))
    assert poll_notice(worker_db, transport) == ("delivered" if state == "current" else "obsolete")
    assert len(_attempts(db, notice)) == int(state == "current")


@pytest.mark.parametrize("state", ["current", "under_review", "superseded_amount"])
def test_standard_top_up_rechecks_eligibility_without_extending_deadline(db, worker_db, expiry_fixture, state):
    proof_offset = -timedelta(minutes=4) if state == "under_review" else None
    order, charge, _, cutoff = expiry_fixture(kind=TOP_UP, proof_offset=proof_offset, deadline_delta=180)
    now = datetime.now(UTC)
    with db.transaction() as conn:
        admin = uuid4()
        conn.execute("INSERT INTO account (id,role,phone_e164) VALUES (%s,'ADMIN','+60123456780')", (admin,))
        conn.execute("UPDATE charge SET state='DISPUTED' WHERE id=%s", (charge,))
        conn.execute("""
            INSERT INTO money_entry (id,charge_id,kind,rail,external_reference,amount_minor,occurred_at,actor_id)
            VALUES (%s,%s,'RECEIPT','DUITNOW','synthetic-top-up-shortfall',%s,%s,%s)
        """, (uuid4(), charge, 448 if state == "superseded_amount" else 449, now, admin))
    notice = _enqueue(db, order, now, "STANDARD_TOP_UP", chargeId=str(charge), deadline=iso(cutoff), outstandingMinor=1)
    transport = SyntheticTransport(Delivery("DELIVERED"))
    assert poll_notice(worker_db, transport) == ("delivered" if state == "current" else "obsolete")
    assert len(transport.calls) == len(_attempts(db, notice)) == int(state == "current")
    if state == "current":
        assert transport.calls[0][2]["deadline"] == iso(cutoff)
    with db.connection() as conn:
        assert one(conn, "SELECT top_up_due_at FROM charge WHERE id=%s", (charge,))["top_up_due_at"] == cutoff


@pytest.mark.parametrize("change", ["current", "amount", "case", "cutoff"])
def test_supplement_rechecks_current_shortfall_open_case_and_original_cutoff(db, worker_db, change):
    now = datetime.now(UTC)
    event, _, charge, admin, cutoff, _ = _seed(db, now)
    proof, _ = _proof(db, event, charge, now)
    assert _receipt(db, event, charge, admin, now, proof, amount=450)["state"] == "DISPUTED"
    with db.transaction() as conn:
        case = one(conn, "SELECT id FROM settlement_case WHERE charge_id=%s AND status='OPEN'", (charge,))["id"]
        if change == "case":
            conn.execute("UPDATE settlement_case SET status='RESOLVED',resolved_at=%s,resolved_by=%s WHERE id=%s",
                         (now, admin, case))
    notice = _enqueue(db, event, now, "EVENT_SUPPLEMENT_REQUESTED", chargeId=str(charge), caseId=str(case), revision=1,
                      deadline=iso(cutoff + HOUR if change == "cutoff" else cutoff),
                      outstandingMinor=49 if change == "amount" else 50, customerReason="Private payment note")
    transport = SyntheticTransport(Delivery("DELIVERED"))
    assert poll_notice(worker_db, transport) == ("delivered" if change == "current" else "obsolete")
    assert len(_attempts(db, notice)) == int(change == "current")
    if change == "current":
        assert transport.calls[0][2] == {"milestone": "EVENT_SUPPLEMENT_REQUESTED", "reference": "EV-TEST",
                                          "deadline": iso(cutoff), "outstandingMinor": 50}


@pytest.mark.parametrize(("outcome", "disposition"), [("FAILED", "MANUAL_CONTACT"), ("UNKNOWN", "PROVIDER_RECONCILED")])
def test_merchant_followup_contract_role_audit_and_replay(db, worker_db, client, sign_in, outcome, disposition):
    customer, customer_headers = sign_in()
    admin, admin_headers = sign_in("ADMIN")
    now = datetime.now(UTC)
    event, _ = _event(db, now, owner=customer["accountId"], email=EMAIL)
    notice = _enqueue(db, event, now)
    path = f"{API}/admin/notices/{notice}"
    headers = {**admin_headers, "Idempotency-Key": str(uuid4())}
    body = {"disposition": disposition, "reason": "Synthetic follow-up evidence"}
    assert client.get(path, headers=customer_headers).status_code == 403
    assert client.post(path + "/resolve", headers=customer_headers, json=body).status_code == 403
    assert client.post(path + "/resolve", headers=headers, json=body).status_code == 409
    transport = SyntheticTransport(Delivery(outcome))
    assert poll_notice(worker_db, transport) == outcome.lower()

    detail = client.get(path, headers=admin_headers)
    assert detail.status_code == 200, detail.text
    _assert_contract(detail, "NoticeDetail")
    assert detail.json()["status"] == outcome and detail.json()["attempts"][0]["outcome"] == outcome
    assert EMAIL not in detail.text
    resolved = client.post(path + "/resolve", headers=headers, json=body)
    assert resolved.status_code == 200, resolved.text
    _assert_contract(resolved, "WorkItem")
    assert resolved.json()["status"] == "RESOLVED" and resolved.json()["noticeOutcome"] == outcome
    assert client.post(path + "/resolve", headers=headers, json=body).json() == resolved.json()
    assert client.post(path + "/resolve", headers=headers, json={**body, "reason": "Different reason"}).json()["code"] == "IDEMPOTENCY_CONFLICT"
    assert client.post(path + "/resolve", headers={**headers, "Idempotency-Key": str(uuid4())}, json=body).status_code == 409
    after = client.get(path, headers=admin_headers).json()
    assert after["status"] == "RESOLVED" and after["resolvedAt"] == resolved.json()["updatedAt"]
    assert after["attempts"] == detail.json()["attempts"]
    assert poll_notice(worker_db, transport) is None and len(transport.calls) == 1
    with db.connection() as conn:
        audit = rows(conn, "SELECT actor_id,action,reason_code,safe_change FROM audit_event WHERE resource_id=%s", (notice,))
        assert audit == [{"actor_id": UUID(admin["accountId"]), "action": "RESOLVE_NOTIFICATION_FAILURE",
                          "reason_code": disposition, "safe_change": {"disposition": disposition}}]
        assert one(conn, "SELECT reason FROM notice_followup WHERE work_id=%s", (notice,))["reason"] == body["reason"]
        assert one(conn, "SELECT status FROM event_application WHERE id=%s", (event,))["status"] == "APPLIED"
