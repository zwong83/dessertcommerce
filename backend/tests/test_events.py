import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier
from types import SimpleNamespace
from uuid import uuid4

import psycopg
import pytest
from jsonschema import Draft202012Validator, FormatChecker

from sweetcommerce.capacity.infrastructure import CapacityCommand, calendar_event_windows
from sweetcommerce.db import one, rows
from sweetcommerce.events import infrastructure as store
from sweetcommerce.events.application import EventService
from sweetcommerce.events.domain import instant, wire
from sweetcommerce.problems import Problem

TERMS = {"version": "event-test-v1", "text": "Synthetic event terms with cancellation before transfer."}


def context(key=None):
    return CapacityCommand(str(key or uuid4()), str(uuid4()))


def request(day=8):
    return {
        "eventDate": f"2030-01-{day:02}",
        "startAt": f"2030-01-{day:02}T13:00:00+08:00",
        "expectedEndAt": f"2030-01-{day:02}T15:00:00+08:00",
        "setupReadyAt": f"2030-01-{day:02}T12:30:00+08:00",
        "venue": {"line1": "Test Venue", "city": "Test City", "postcode": "00000", "region": "Test Region"},
        "guestCount": 25, "budgetMinor": 10000, "occasion": "Celebration", "theme": "Blue",
        "specialRequirements": "None", "contactName": "Synthetic Contact", "phone": "+60123456789",
    }


def schedule(day):
    return {
        "eventStartAt": f"2030-01-{day:02}T13:00:00+08:00",
        "eventEndAt": f"2030-01-{day:02}T15:00:00+08:00",
        "setupReadyAt": f"2030-01-{day:02}T12:30:00+08:00",
        "teardownAt": f"2030-01-{day:02}T16:00:00+08:00",
    }


def window(day):
    return {"startAt": f"2030-01-{day:02}T12:00:00+08:00", "endAt": f"2030-01-{day:02}T16:30:00+08:00"}


def quote_body(*, total=101, day=8, deposit_due_at="2030-01-04T12:00:00+08:00"):
    return {
        "totalMinor": total, "depositDueAt": deposit_due_at, "balanceDueAt": f"2030-01-{day - 3:02}T13:00:00+08:00",
        "resourceWindow": window(day), "resourceAssessment": {"staffCount": 2, "notes": "Private merchant notes"},
        "schedule": schedule(day), "termsVersion": TERMS["version"], "packageSummary": "Dessert table",
        "serviceSummary": "Setup and teardown", "equipment": [{"name": "Cake stand", "quantity": 3}],
        "extraChargeTerms": "Agreed itemized waiting and equipment damage.",
    }


def consent(event):
    quote = event["quote"]
    return {"quoteId": quote["id"], "quoteVersion": quote["version"], "termsVersion": quote["termsVersion"]}


@pytest.fixture
def event_fixture(db, clock):
    def actor(role, number):
        value = SimpleNamespace(account_id=str(uuid4()), role=role)
        with db.transaction() as conn:
            conn.execute("INSERT INTO account (id, role, phone_e164) VALUES (%s, %s, %s)", (
                value.account_id, role, f"+6010000000{number}",
            ))
        return value

    service = EventService(db, terms=lambda: TERMS.copy(), duitnow_qr_url="https://shop.example.test/synthetic-qr", clock=clock)
    return service, actor("CUSTOMER", 1), actor("ADMIN", 2), actor("CUSTOMER", 3)


def submit_quote(service, customer, admin, *, body=None):
    event = service.submit_event_request(customer, request(), context())
    return service.issue_event_quote(admin, event["id"], body or quote_body(), event["version"], context())


def reject(code, operation):
    with pytest.raises(Problem) as raised:
        operation()
    assert raised.value.code == code


def test_lead_boundary_owned_paging_and_durable_intent(db, dsns, clock, event_fixture):
    service, customer, _, other = event_fixture
    clock.current = instant("2030-01-01T22:00:00+08:00")
    same = context()
    start = Barrier(2)

    def concurrent_intake(_):
        start.wait()
        return service.submit_event_request(customer, request(), same)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, replay = pool.map(concurrent_intake, range(2))
    assert first == replay
    clock.advance(microseconds=1)
    reject("VALIDATION", lambda: service.submit_event_request(customer, request(), context()))
    later = service.submit_event_request(customer, request(9), context())
    foreign = service.submit_event_request(other, request(9), same)
    reject("NOT_FOUND", lambda: service.get_own_event(customer, foreign["id"]))
    reject("VALIDATION", lambda: service.submit_event_request(customer, request(9) | {"guestCount": True}, context()))

    # Simulate expiration of the short-lived shared receipt in the isolated database.
    with psycopg.connect(dsns["migration"]) as conn:
        conn.execute("TRUNCATE sweetcommerce.command_receipt")
    assert service.submit_event_request(customer, request(), same)["id"] == first["id"]
    reject("IDEMPOTENCY_CONFLICT", lambda: service.submit_event_request(customer, request(9), same))
    assert service.get_own_command_outcome(customer, "submitEventRequest", same.idempotency_key)["resourceId"] == first["id"]
    page = service.list_own_events(customer, 1)
    assert [item["id"] for item in page["items"]] == [later["id"]]
    final = service.list_own_events(customer, 1, page["nextCursor"])
    assert [item["id"] for item in final["items"]] == [first["id"]]
    assert final["nextCursor"] is None
    with db.connection() as conn:
        assert one(conn, """
            SELECT count(*) AS n FROM durable_work
            WHERE resource_id = %s AND payload->>'milestone' = 'EVENT_REQUEST_RECEIVED'
        """, (first["id"],))["n"] == 1


def test_quote_supersession_split_and_exact_cutoff(db, clock, event_fixture):
    service, customer, admin, _ = event_fixture
    issued = submit_quote(service, customer, admin, body=quote_body(total=2))
    assert (issued["quote"]["depositMinor"], issued["quote"]["balanceMinor"]) == (1, 1)
    assert instant(issued["quote"]["depositDueAt"]) == clock.current + timedelta(days=3)
    for total in (0, 1):
        reject("VALIDATION", lambda: service.issue_event_quote(
            admin, issued["id"], quote_body(total=total), issued["version"], context(),
        ))
    replacement = service.issue_event_quote(
        admin, issued["id"], quote_body(total=3, deposit_due_at="2030-01-03T12:00:00+08:00"), issued["version"], context(),
    )
    assert (replacement["quote"]["depositMinor"], replacement["quote"]["balanceMinor"]) == (2, 1)
    assert replacement["quote"]["depositDueAt"] == "2030-01-03T04:00:00Z"
    reject("VERSION_CONFLICT", lambda: service.accept_event_quote(
        customer, issued["id"], consent(issued), replacement["version"], context(),
    ))
    reject("TERMS_CHANGED", lambda: service.accept_event_quote(
        customer, issued["id"], consent(replacement) | {"termsVersion": "stale"}, replacement["version"], context(),
    ))
    clock.current = instant(replacement["quote"]["depositDueAt"])
    reject("QUOTE_EXPIRED", lambda: service.accept_event_quote(
        customer, issued["id"], consent(replacement), replacement["version"], context(),
    ))
    with db.connection() as conn:
        assert [record["status"] for record in rows(conn, """
            SELECT w.status FROM resource_window w JOIN event_quote q ON q.id = w.quote_id
            WHERE q.event_id = %s ORDER BY q.version
        """, (issued["id"],))] == ["RELEASED", "HELD"]
        assert not store.charges_for_event(conn, issued["id"])


def test_concurrent_overlap_and_informational_alternative(db, event_fixture):
    service, customer, admin, other = event_fixture
    events = [service.submit_event_request(actor, request(), context()) for actor in (customer, other)]
    proposed = service.change_event_booking(admin, events[0]["id"], {
        "action": "PROPOSE_ALTERNATE_DATE", "alternativeSchedule": schedule(9), "reason": "Alternative for travel.",
    }, events[0]["version"], context())
    assert proposed["status"] == "APPLIED" and proposed["effectiveSchedule"] is None and not proposed["charges"]
    assert instant(proposed["alternativeSchedule"]["eventStartAt"]) == instant(schedule(9)["eventStartAt"])
    with db.connection() as conn:
        assert one(conn, "SELECT count(*) AS n FROM resource_window")["n"] == 0
    start = Barrier(2)

    def try_issue(event):
        start.wait()
        try:
            service.issue_event_quote(admin, event["id"], quote_body(day=9), event["version"], context())
            return "ISSUED"
        except Problem as problem:
            return problem.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(try_issue, (proposed, events[1]))) == ["CAPACITY_UNAVAILABLE", "ISSUED"]
    with db.connection() as conn:
        assert one(conn, "SELECT count(*) AS n FROM resource_window WHERE status = 'HELD'")["n"] == 1
        calendar = calendar_event_windows(conn, "2030-01-08", "2030-01-10")
        assert list(calendar) == ["2030-01-09"]
        assert [item["status"] for item in calendar["2030-01-09"]] == ["HELD"]


def test_accept_and_cancel_replay_and_payment_evidence(db, clock, event_fixture):
    service, customer, admin, other = event_fixture
    offered = submit_quote(service, customer, admin)
    action = context()
    accepted = service.accept_event_quote(customer, offered["id"], consent(offered), offered["version"], action)
    assert accepted["status"] == "AWAITING_DEPOSIT" and accepted["effectiveSchedule"] is None
    assert "before sending any transfer" in accepted["quote"]["termsText"]
    service.terms = lambda: {"version": "new-terms", "text": "Synthetic updated terms."}
    assert service.accept_event_quote(customer, offered["id"], consent(offered), offered["version"], action) == accepted
    service.terms = lambda: TERMS.copy()
    assert service.get_own_command_outcome(customer, "acceptEventQuote", action.idempotency_key)["resourceId"] == offered["id"]
    reject("NOT_FOUND", lambda: service.get_own_command_outcome(other, "acceptEventQuote", action.idempotency_key))
    assert [(charge["category"], charge["expectedMinor"]) for charge in accepted["charges"]] == [("EVENT_DEPOSIT", 51)]
    reject("VALIDATION", lambda: service.cancel_event_request(
        customer, offered["id"], {"noTransferSent": False}, accepted["version"], context(),
    ))
    cancel = context()
    cancelled = service.cancel_event_request(customer, offered["id"], {"noTransferSent": True}, accepted["version"], cancel)
    assert cancelled["status"] == "CANCELLED" and cancelled["charges"][0]["state"] == "CANCELLED"
    assert service.cancel_event_request(customer, offered["id"], {"noTransferSent": True}, accepted["version"], cancel) == cancelled

    next_offer = submit_quote(service, customer, admin)
    next_accept = service.accept_event_quote(customer, next_offer["id"], consent(next_offer), next_offer["version"], context())
    with db.transaction() as conn:
        _proof(conn, next_accept["charges"][0]["id"], clock.current, state="REJECTED")
    reject("INVALID_TRANSITION", lambda: service.cancel_event_request(
        customer, next_offer["id"], {"noTransferSent": True}, next_accept["version"], context(),
    ))
    reject("INVALID_TRANSITION", lambda: service.change_event_booking(admin, next_offer["id"], {
        "action": "CANCEL", "cancellationBasis": "CUSTOMER_REQUEST", "noTransferSent": True, "reason": "Customer called.",
    }, next_accept["version"], context()))


def _proof(conn, charge_id, now, *, state="REVIEW"):
    proof_id = uuid4()
    conn.execute("""
        INSERT INTO payment_proof
            (id, charge_id, object_key, content_digest, byte_count, media_type, state, review_disposition, received_at)
        VALUES (%s, %s, %s, %s, 8, 'image/png', %s, 'TIMELY', %s)
    """, (proof_id, charge_id, str(proof_id), uuid4().bytes * 2, state, now))
    return str(proof_id)


def _receipt(db, clock, admin, charge):
    from sweetcommerce.settlement.application import SettlementService

    with db.transaction() as conn:
        proof_id = _proof(conn, charge["id"], clock.current)
    settlement = SettlementService(db, clock=clock)
    return settlement.confirm_receipt(admin, charge["id"], {
        "expectedVersion": charge["version"], "amountMinor": charge["expectedMinor"],
        "externalReference": f"synthetic-{uuid4()}", "receivedAt": wire(clock.current), "proofId": proof_id,
    }, context())


def _book(db, clock, service, customer, admin, *, pay_balance=False):
    issued = submit_quote(service, customer, admin)
    awaiting = service.accept_event_quote(customer, issued["id"], consent(issued), issued["version"], context())
    _receipt(db, clock, admin, awaiting["charges"][0])
    booked = service.get_merchant_event(admin, awaiting["id"])
    if pay_balance:
        _receipt(db, clock, admin, next(charge for charge in booked["charges"] if charge["category"] == "EVENT_BALANCE"))
        booked = service.get_merchant_event(admin, awaiting["id"])
    return booked


def test_agreed_reschedule_validates_due_before_swap(db, clock, event_fixture):
    service, customer, admin, _ = event_fixture
    original = _book(db, clock, service, customer, admin)
    balance = next(charge for charge in original["charges"] if charge["category"] == "EVENT_BALANCE")
    replacement = {
        "schedule": schedule(12), "resourceWindow": window(12),
        "consent": {"agreedAt": wire(clock.current), "channel": "PHONE", "reference": "Synthetic consent"},
        "reason": "Agreed replacement date", "obligationDisposition": "KEEP_APPROVED_TERMS",
        "balancePlan": {"state": "AGREED_OUTSTANDING", "chargeId": balance["id"],
                        "dueAt": "2030-01-09T13:00:00+08:00", "graceEndsAt": "2030-01-10T13:00:00+08:00"},
    }
    bad = replacement | {"balancePlan": replacement["balancePlan"] | {"graceEndsAt": "2030-01-10T12:59:00+08:00"}}
    reject("VALIDATION", lambda: service.reschedule_event_booking(admin, original["id"], bad, original["version"], context()))
    before = clock.current
    clock.current = instant(replacement["balancePlan"]["dueAt"])
    reject("VALIDATION", lambda: service.reschedule_event_booking(
        admin, original["id"], replacement, original["version"], context(),
    ))
    clock.current = before
    assert service.get_merchant_event(admin, original["id"]) == original
    moved = service.reschedule_event_booking(admin, original["id"], replacement, original["version"], context())
    assert moved["effectiveBalanceDueAt"] == "2030-01-09T05:00:00Z"
    assert moved["effectiveBalanceGraceEndsAt"] == "2030-01-10T05:00:00Z"
    assert moved["balanceDeadlineRevision"] == original["balanceDeadlineRevision"] + 1
    assert moved["quote"] == original["quote"] and moved["request"] == original["request"]
    assert moved["effectiveSchedule"]["eventStartAt"] == "2030-01-12T05:00:00Z"
    with db.connection() as conn:
        assert one(conn, """
            SELECT count(*) AS n FROM durable_work WHERE kind = 'EVENT_BALANCE_DUE' AND resource_id = %s
              AND payload->>'revision' = %s
        """, (moved["id"], str(moved["balanceDeadlineRevision"])))["n"] == 2


def test_overdue_cancellation_requires_strict_cutoff_and_no_pending_balance(db, clock, event_fixture):
    service, customer, admin, _ = event_fixture
    booked = _book(db, clock, service, customer, admin)
    balance = next(charge for charge in booked["charges"] if charge["category"] == "EVENT_BALANCE")
    body = {
        "action": "CANCEL", "cancellationBasis": "BALANCE_OVERDUE", "reason": "Bank account checked.",
        "noBalanceFundsReceived": True,
    }

    def cancel(payload):
        return service.change_event_booking(admin, booked["id"], payload, booked["version"], context())

    clock.current = instant(booked["effectiveBalanceGraceEndsAt"])
    reject("INVALID_TRANSITION", lambda: cancel(body))
    clock.advance(microseconds=1)
    reject("VALIDATION", lambda: cancel(body | {"noBalanceFundsReceived": False}))
    with db.transaction() as conn:
        proof = _proof(conn, balance["id"], clock.current - timedelta(seconds=1))
    reject("INVALID_TRANSITION", lambda: cancel(body))
    with db.transaction() as conn:
        conn.execute("UPDATE payment_proof SET state = 'REJECTED' WHERE id = %s", (proof,))
    cancelled = cancel(body)
    assert cancelled["status"] == "CANCELLED"
    assert next(charge for charge in cancelled["charges"] if charge["category"] == "EVENT_DEPOSIT")["paidMinor"] == 51
    with db.connection() as conn:
        assert one(conn, "SELECT status FROM resource_window WHERE quote_id = %s", (booked["quote"]["id"],))["status"] == "RELEASED"
        audit = one(conn, """
            SELECT safe_change FROM audit_event WHERE resource_id = %s AND reason_code = 'BALANCE_OVERDUE'
        """, (booked["id"],))
        assert audit["safe_change"] == {"noBalanceFundsReceived": True}


def test_merchant_inability_keeps_paid_facts_and_reserves_remaining_obligation(db, clock, event_fixture):
    from sweetcommerce.refunds.application import RefundService

    service, customer, admin, _ = event_fixture
    with db.connection() as conn:
        clock.current = one(conn, "SELECT clock_timestamp() AS now")["now"] - timedelta(days=1)
    booked = _book(db, clock, service, customer, admin, pay_balance=True)
    deposit = next(charge for charge in booked["charges"] if charge["category"] == "EVENT_DEPOSIT")
    with db.connection() as conn:
        receipt = one(conn, "SELECT id FROM money_entry WHERE charge_id = %s", (deposit["id"],))
    refunds = RefundService(db)
    reserved = refunds.reserve_refund(admin, deposit["id"], {
        "receiptId": str(receipt["id"]), "amountMinor": 20, "expectedVersion": deposit["version"],
        "reason": "Synthetic agreed partial payout",
    }, context())
    refunds.record_refund(admin, deposit["id"], {
        "refundIntentId": reserved["refundIntentId"], "amountMinor": 20,
        "externalReference": f"synthetic-{uuid4()}", "expectedVersion": reserved["charge"]["version"],
        "reason": "Synthetic verified payout", "refundedAt": wire(clock.current + timedelta(hours=1)),
    }, context())
    reject("INVALID_TRANSITION", lambda: service.cancel_event_request(
        customer, booked["id"], {"noTransferSent": True}, booked["version"], context(),
    ))
    action = {"action": "CANCEL", "cancellationBasis": "MERCHANT_UNABLE", "reason": "Synthetic private reason"}
    intent = context()
    cancelled = service.change_event_booking(admin, booked["id"], action, booked["version"], intent)
    assert service.change_event_booking(admin, booked["id"], action, booked["version"], intent) == cancelled
    assert cancelled["status"] == "CANCELLED"
    assert {charge["category"]: charge["requiredRefundMinor"] for charge in cancelled["charges"]} == {
        "EVENT_DEPOSIT": 31, "EVENT_BALANCE": 50,
    }
    assert "Synthetic private reason" not in json.dumps(service.get_merchant_event(admin, booked["id"]))
    with db.connection() as conn:
        assert one(conn, "SELECT count(*) AS n FROM full_refund_obligation")["n"] == 2


def test_settled_reschedule_and_reasoned_force_majeure(db, clock, event_fixture):
    service, customer, admin, _ = event_fixture
    booked = _book(db, clock, service, customer, admin, pay_balance=True)
    balance = next(charge for charge in booked["charges"] if charge["category"] == "EVENT_BALANCE")
    plan = {
        "schedule": schedule(12), "resourceWindow": window(12),
        "consent": {"agreedAt": wire(clock.current), "channel": "WHATSAPP", "reference": "Synthetic agreement"},
        "reason": "Agreed replacement date", "obligationDisposition": "KEEP_APPROVED_TERMS",
        "balancePlan": {"state": "SETTLED", "chargeId": balance["id"]},
    }
    moved = service.reschedule_event_booking(admin, booked["id"], plan, booked["version"], context())
    assert moved["status"] == "PROCEEDING" and moved["effectiveBalanceDueAt"] is None
    assert next(charge for charge in moved["charges"] if charge["category"] == "EVENT_BALANCE") == balance
    action = {"action": "CANCEL", "cancellationBasis": "FORCE_MAJEURE"}
    reject("VALIDATION", lambda: service.change_event_booking(admin, moved["id"], action, moved["version"], context()))
    cancelled = service.change_event_booking(
        admin, moved["id"], action | {"reason": "Venue closed. Customer agreed to cancel."}, moved["version"], context(),
    )
    assert cancelled["status"] == "CANCELLED"
    assert {charge["category"]: charge["paidMinor"] for charge in cancelled["charges"]} == {
        "EVENT_DEPOSIT": 51, "EVENT_BALANCE": 50,
    }
    with db.connection() as conn:
        assert one(conn, "SELECT resource_status FROM event_schedule_change WHERE event_id = %s", (moved["id"],))[
            "resource_status"
        ] == "RELEASED"
        assert one(conn, "SELECT count(*) AS n FROM full_refund_obligation")["n"] == 0


def test_paid_service_history_and_separate_extras(db, clock, event_fixture):
    service, customer, admin, _ = event_fixture
    event = _book(db, clock, service, customer, admin, pay_balance=True)
    assert event["status"] == "PROCEEDING"
    equipment_id = event["quote"]["equipment"][0]["id"]
    clock.current = datetime(2030, 1, 8, 10, tzinfo=UTC)

    def change(current, action, **body):
        return service.change_event_booking(admin, current["id"], {"action": action, **body}, current["version"], context())

    event = change(event, "RECORD_EQUIPMENT_OUT", at="2030-01-08T04:00:00Z",
                   equipmentOut=[{"equipmentId": equipment_id, "taken": 3}])
    event = change(event, "RECORD_SETUP", at="2030-01-08T04:30:00Z")
    event = change(event, "RECORD_ACTUAL_END", at="2030-01-08T07:30:00Z")
    event = change(event, "RECORD_TEARDOWN", at="2030-01-08T08:00:00Z")
    check = {"equipmentId": equipment_id, "name": "Cake stand", "returned": 2, "damaged": 1, "lost": 1}
    reject("VALIDATION", lambda: change(
        event, "RECORD_EQUIPMENT_CHECK", at="2030-01-08T08:15:00Z", equipmentCheck=[check | {"lost": 2}],
    ))
    event = change(event, "RECORD_EQUIPMENT_CHECK", at="2030-01-08T08:15:00Z", equipmentCheck=[check])
    merchant = service.get_merchant_event(admin, event["id"])
    assert [(line["returned"], line["damaged"], line["lost"]) for line in merchant["equipmentLedger"]] == [(2, 1, 1)]
    invoice = {"action": "ISSUE_EXTRAS", "extras": [{"item": "Cake stand", "amountMinor": 20, "reason": "Damaged"}]}
    key = context()
    event_before_invoice = event
    event = service.change_event_booking(admin, event["id"], invoice, event["version"], key)
    assert service.change_event_booking(admin, event["id"], invoice, event_before_invoice["version"], key) == event
    assert event["extraInvoices"][0]["dueAt"] == "2030-01-10T07:30:00Z"
    assert next(charge for charge in event["charges"] if charge["category"] == "EVENT_BALANCE")["paidMinor"] == 50
    reject("INVALID_TRANSITION", lambda: change(event, "COMPLETE"))
    extra = next(charge for charge in event["charges"] if charge["category"] == "EVENT_EXTRA")
    _receipt(db, clock, admin, extra)
    completed = service.get_own_event(customer, event["id"])
    assert completed["status"] == "COMPLETED"
    assert next(charge for charge in completed["charges"] if charge["category"] == "EVENT_EXTRA")["paidMinor"] == 20


def test_role_scoping_and_contract_response(client, sign_in):
    contract_path = Path(__file__).resolve().parents[2] / "output/SD/contracts/sweetcommerce-v1.0.4.1.openapi.json"
    contract = json.loads(contract_path.read_text())
    path = "/api/v1/events"
    assert client.get(path).status_code == 401
    _, customer = sign_in()
    _, other = sign_in()
    _, admin = sign_in("ADMIN")
    key = str(uuid4())
    headers = customer | {"Idempotency-Key": key}
    assert client.post(path, json=request(), headers=headers | {"Origin": "https://foreign.example.test"}).status_code == 403
    created = client.post(path, json=request(), headers=headers)
    assert created.status_code == 201
    event_id = created.json()["id"]
    outcome_path = f"/api/v1/commands/{key}?operation=submitEventRequest"
    assert client.get(outcome_path, headers=customer).json()["resourceId"] == event_id
    assert client.get(outcome_path, headers=other).status_code == 404
    assert client.get(f"{path}/{event_id}", headers=other).status_code == 404
    admin_path = f"/api/v1/admin/events/{event_id}"
    assert client.get(admin_path, headers=customer).status_code == 403
    issued = client.post(f"{admin_path}/quotes", json=quote_body() | {"termsVersion": "synthetic-v1"}, headers=admin | {
        "Idempotency-Key": str(uuid4()), "If-Match": '"1"',
    })
    assert issued.status_code == 200
    owned = client.get(f"{path}/{event_id}", headers=customer)
    merchant = client.get(admin_path, headers=admin)
    for response, schema in ((owned, "Event"), (merchant, "AdminEvent")):
        assert response.status_code == 200
        Draft202012Validator(
            {"components": contract["components"], "$ref": f"#/components/schemas/{schema}"},
            format_checker=FormatChecker(),
        ).validate(response.json())
    assert "Private merchant notes" not in owned.text
    assert merchant.json()["merchantPlan"]["assessmentNotes"] == "Private merchant notes"
