from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from sweetcommerce.capacity.infrastructure import CapacityCommand
from sweetcommerce.db import one
from sweetcommerce.eventsettlement import (
    confirm_receipt,
    enqueue_balance_work,
    mark_proof_review,
    payment_cutoff,
    proof_disposition,
    request_supplement,
    resolve_infeasible_deposit,
)
from sweetcommerce.problems import Problem
from sweetcommerce.settlement.infrastructure import enqueue_work
from sweetcommerce.worker.application import apply_expiry
from sweetcommerce.worker.domain import Claim

HOUR = timedelta(hours=1)
DAY = timedelta(days=1)


def _seed(db, now, *, status="AWAITING_DEPOSIT", cutoff=None):
    cutoff = cutoff or now + HOUR
    balance_due = cutoff + DAY
    starts = balance_due + 3 * DAY
    owner, admin, event_id, quote_id, deposit_id = (uuid4() for _ in range(5))
    with db.transaction() as conn:
        conn.execute("""
            INSERT INTO account (id,role,phone_e164) VALUES (%s,'CUSTOMER','+601000000001'),(%s,'ADMIN','+601000000002')
        """, (owner, admin))
        conn.execute("""
            INSERT INTO event_application (id,event_number,account_id,submission_intent_id,submission_digest,status,
                event_date,start_at,expected_end_at,setup_ready_at,request_snapshot,created_at,updated_at)
            VALUES (%s,'EV-TEST',%s,%s,'abc',%s,%s,%s,%s,%s,'{}',%s,%s)
        """, (event_id, owner, uuid4(), status, starts.date(), starts, starts + HOUR, starts - HOUR,
              cutoff - DAY, cutoff - DAY))
        conn.execute("""
            INSERT INTO event_quote (id,event_id,version,status,total_minor,deposit_minor,balance_minor,issued_at,
                deposit_due_at,balance_due_at,event_start_at,event_end_at,setup_ready_at,teardown_at,quote_snapshot,
                terms_version)
            VALUES (%s,%s,1,%s,1000,500,500,%s,%s,%s,%s,%s,%s,%s,'{}','terms')
        """, (quote_id, event_id, "OFFERED" if status == "QUOTED" else "CUSTOMER_ACCEPTED", cutoff - DAY, cutoff,
              balance_due, starts, starts + HOUR, starts - HOUR, starts + 2 * HOUR))
        conn.execute("""
            INSERT INTO resource_window (quote_id,starts_at,ends_at,status,assessed_by,assessment_note,planned_staff)
            VALUES (%s,%s,%s,'HELD',%s,'Synthetic manual assessment',1)
        """, (quote_id, starts - HOUR, starts + 2 * HOUR, admin))
        if status != "QUOTED":
            conn.execute("""
                INSERT INTO charge (id,event_id,quote_id,category,state,expected_minor,due_at,created_at)
                VALUES (%s,%s,%s,'EVENT_DEPOSIT','OPEN',500,%s,%s)
            """, (deposit_id, event_id, quote_id, cutoff, cutoff - DAY))
    return event_id, quote_id, deposit_id, admin, cutoff, balance_due


def _target(conn, event_id, charge_id):
    event = one(conn, "SELECT * FROM event_application WHERE id = %s FOR UPDATE", (event_id,))
    charge = one(conn, "SELECT * FROM charge WHERE id = %s FOR UPDATE", (charge_id,))
    return event, charge


def _proof(db, event_id, charge_id, now):
    proof_id = uuid4()
    with db.transaction() as conn:
        event, charge = _target(conn, event_id, charge_id)
        disposition = proof_disposition(conn, event, charge, now)
        conn.execute("""
            INSERT INTO payment_proof (id,charge_id,object_key,content_digest,byte_count,media_type,state,
                                       review_disposition,received_at)
            VALUES (%s,%s,%s,%s,64,'image/png','REVIEW',%s,%s)
        """, (proof_id, charge_id, f"synthetic/{proof_id}", proof_id.bytes, disposition, now))
        if disposition == "TIMELY":
            mark_proof_review(conn, event, charge, now)
    return proof_id, disposition


def _receipt(db, event_id, charge_id, admin, now, proof_id, *, amount=500, clock=None, **changes):
    with db.transaction() as conn:
        event, charge = _target(conn, event_id, charge_id)
        details = {
            "externalReference": str(proof_id), "amountMinor": amount, "receivedAt": now.isoformat(),
            "expectedVersion": charge["version"], "postingMode": "NORMAL", "proofId": proof_id, **changes,
        }
        return confirm_receipt(conn, event, charge, admin, details, now, CapacityCommand(str(uuid4()), "event-test"),
                               clock=clock)


def _run_work(db, worker_db, event_id, kind, key, now, payload):
    with db.transaction() as conn:
        enqueue_work(conn, key, kind, event_id, now, now, payload)
    with worker_db.transaction() as conn:
        token = uuid4()
        work = one(conn, """
            UPDATE durable_work SET work_state = 'LEASED', lease_token = %s,
              lease_until = clock_timestamp() + interval '30 seconds'
            WHERE event_key = %s
            RETURNING id, resource_id, kind, payload_version, payload
        """, (token, key))
    return apply_expiry(worker_db, Claim(**work, token=token))


@pytest.mark.parametrize("decision", ["FEASIBLE_24H", "RESCHEDULE_OR_REFUND"])
def test_late_deposit_requires_disposition_and_preserves_verified_money(db, decision):
    start = datetime(2030, 1, 1, tzinfo=UTC)
    event_id, quote, deposit, admin, cutoff, due = _seed(db, start)
    proof, disposition = _proof(db, event_id, deposit, cutoff - timedelta(microseconds=1))
    assert disposition == "TIMELY"
    now = due + HOUR
    with pytest.raises(Problem) as error:
        _receipt(db, event_id, deposit, admin, due, proof, clock=lambda conn: now)
    assert error.value.code == "DEPOSIT_DISPOSITION_REQUIRED"
    with db.connection() as conn:
        assert one(conn, "SELECT count(*) AS n FROM money_entry")["n"] == 0
        assert one(conn, "SELECT state FROM payment_proof WHERE id = %s", (proof,))["state"] == "REVIEW"

    result = _receipt(db, event_id, deposit, admin, now, proof,
                      lateDepositDecision={"disposition": decision, "reason": "Synthetic merchant decision"})
    assert result["state"] == "PAID"
    with db.connection() as conn:
        event = one(conn, "SELECT * FROM event_application WHERE id = %s", (event_id,))
        balance = one(conn, "SELECT * FROM charge WHERE category = 'EVENT_BALANCE'")
        assert one(conn, "SELECT count(*) AS n FROM money_entry")["n"] == 1
        assert event["effective_balance_grace_ends_at"] is None
        if decision == "FEASIBLE_24H":
            assert event["status"] == "BOOKED"
            assert event["booked_at"] == now
            assert payment_cutoff(event, balance) == now + DAY
            assert event["balance_deadline_revision"] == 2
            assert one(conn, "SELECT status FROM resource_window WHERE quote_id = %s", (quote,))["status"] == "BOOKED"
        else:
            assert event["status"] == "EXCEPTION"
            assert event["booked_at"] is None
            assert payment_cutoff(event, balance) is None
            assert one(conn, "SELECT kind FROM settlement_case WHERE status = 'OPEN'")["kind"] == "EVENT_FULFILMENT_INFEASIBLE"


def test_infeasible_deposit_refund_disposition_releases_only_after_verified_refund(db):
    now = datetime(2030, 1, 1, tzinfo=UTC)
    event_id, quote, deposit, admin, _, due = _seed(db, now)
    proof, _ = _proof(db, event_id, deposit, now)
    _receipt(db, event_id, deposit, admin, due + HOUR, proof,
             lateDepositDecision={"disposition": "RESCHEDULE_OR_REFUND", "reason": "Synthetic inability"})
    context = CapacityCommand(str(uuid4()), "event-test")
    with pytest.raises(Problem) as error, db.transaction() as conn:
        event, charge = _target(conn, event_id, deposit)
        resolve_infeasible_deposit(conn, event, charge, admin, due + HOUR, "Synthetic refund", context)
    assert error.value.code == "INVALID_TRANSITION"

    with db.transaction() as conn:
        assert one(conn, "SELECT status FROM resource_window WHERE quote_id = %s", (quote,))["status"] == "HELD"
        conn.execute("""
            INSERT INTO money_entry (id,charge_id,kind,rail,external_reference,amount_minor,occurred_at,actor_id)
            VALUES (%s,%s,'REFUND','DUITNOW','synthetic-verified-payout',500,%s,%s)
        """, (uuid4(), deposit, due + HOUR, admin))
        conn.execute("UPDATE charge SET state = 'REFUNDED' WHERE id = %s", (deposit,))
        event, charge = _target(conn, event_id, deposit)
        resolve_infeasible_deposit(conn, event, charge, admin, due + HOUR, "Synthetic refund", context)
        assert one(conn, "SELECT status FROM resource_window WHERE quote_id = %s", (quote,))["status"] == "RELEASED"
        assert one(conn, "SELECT status FROM event_application WHERE id = %s", (event_id,))["status"] == "CANCELLED"
        assert one(conn, "SELECT state FROM charge WHERE id = %s", (deposit,))["state"] == "REFUNDED"


@pytest.mark.parametrize("evidence", ["offered", "at_cutoff", "timely"])
def test_quote_expiry_preserves_only_timely_review(db, worker_db, evidence):
    now = datetime.now(UTC)
    event, quote, deposit, admin, cutoff, _ = _seed(
        db, now, status="QUOTED" if evidence == "offered" else "AWAITING_DEPOSIT", cutoff=now - HOUR,
    )
    if evidence != "offered":
        received_at = cutoff - timedelta(microseconds=1) if evidence == "timely" else cutoff
        proof, disposition = _proof(db, event, deposit, received_at)
        assert disposition == ("TIMELY" if evidence == "timely" else "RECONCILIATION_ONLY")

    payload = {"quoteId": str(quote), "deadline": cutoff.isoformat()}
    result = _run_work(db, worker_db, event, "EVENT_QUOTE_EXPIRY", "quote-expiry", now, payload)
    assert result == ("preserved" if evidence == "timely" else "expired")
    with db.connection() as conn:
        expected = "HELD" if evidence == "timely" else "RELEASED"
        assert one(conn, "SELECT status FROM resource_window WHERE quote_id = %s", (quote,))["status"] == expected
    if evidence == "at_cutoff":
        result = _receipt(db, event, deposit, admin, now, proof, postingMode="RECONCILIATION")
        assert result["state"] == "EXPIRED"
        assert result["paidMinor"] == 500


def test_shortfall_keeps_original_cutoff_and_settles_timely_supplement_once(db):
    now = datetime(2030, 1, 1, tzinfo=UTC)
    event_id, _, deposit, admin, cutoff, due = _seed(db, now)
    first, _ = _proof(db, event_id, deposit, now)
    assert _receipt(db, event_id, deposit, admin, now, first, amount=450)["state"] == "DISPUTED"
    with db.transaction() as conn:
        event, charge = _target(conn, event_id, deposit)
        proof = one(conn, "SELECT * FROM payment_proof WHERE id = %s", (first,))
        for _ in range(2):
            request_supplement(conn, event, charge, proof, admin, now, "Synthetic shortfall",
                               CapacityCommand(str(uuid4()), "event-test"))
        work = one(conn, "SELECT payload FROM durable_work WHERE payload->>'milestone' = 'EVENT_SUPPLEMENT_REQUESTED'")
        assert work["payload"]["outstandingMinor"] == 50
        assert datetime.fromisoformat(work["payload"]["deadline"]) == cutoff
        assert one(conn, "SELECT count(*) AS n FROM durable_work")["n"] == 1
        case = one(conn, "SELECT id FROM settlement_case WHERE kind = 'AMOUNT_MISMATCH'")
    second, disposition = _proof(db, event_id, deposit, cutoff - timedelta(microseconds=1))
    assert disposition == "TIMELY"
    result = _receipt(db, event_id, deposit, admin, cutoff + HOUR, second, amount=50,
                      postingMode="SUPPLEMENT", settlementCaseId=case["id"])
    assert result["state"] == "PAID"
    assert result["paidMinor"] == 500
    with db.connection() as conn:
        event = one(conn, "SELECT * FROM event_application WHERE id = %s", (event_id,))
        assert event["effective_balance_due_at"] == due
        assert event["effective_balance_grace_ends_at"] == due + DAY
        assert one(conn, "SELECT status FROM settlement_case WHERE id = %s", (case["id"],))["status"] == "RESOLVED"


def test_balance_only_counts_eligible_funds_and_uses_current_grace(db):
    now = datetime(2030, 1, 1, tzinfo=UTC)
    event_id, _, deposit, admin, _, due = _seed(db, now)
    proof, _ = _proof(db, event_id, deposit, now)
    _receipt(db, event_id, deposit, admin, now, proof)
    with db.connection() as conn:
        balance = one(conn, "SELECT id FROM charge WHERE category = 'EVENT_BALANCE'")["id"]

    # Reconciliation-only funds must never complete an otherwise exact net total.
    first, disposition = _proof(db, event_id, balance, due + HOUR)
    assert disposition == "TIMELY"
    result = _receipt(db, event_id, balance, admin, due + HOUR, first, amount=100, postingMode="RECONCILIATION")
    assert result["state"] == "DISPUTED"
    with db.transaction() as conn:
        case = one(conn, """
            INSERT INTO settlement_case (id,charge_id,kind,status,opened_at)
            VALUES (%s,%s,'AMOUNT_MISMATCH','OPEN',%s) RETURNING id
        """, (uuid4(), balance, due + HOUR))
    with pytest.raises(Problem) as error, db.transaction() as conn:
        event, charge = _target(conn, event_id, balance)
        proof = one(conn, "SELECT * FROM payment_proof WHERE id = %s", (first,))
        request_supplement(conn, event, charge, proof, admin, due + HOUR, "Synthetic shortfall",
                           CapacityCommand(str(uuid4()), "event-test"))
    assert error.value.code == "INVALID_TRANSITION"
    second, disposition = _proof(db, event_id, balance, due + DAY - timedelta(microseconds=1))
    assert disposition == "TIMELY"
    result = _receipt(db, event_id, balance, admin, due + DAY + HOUR, second, amount=400,
                      postingMode="SUPPLEMENT", settlementCaseId=case["id"])
    assert result["state"] == "DISPUTED"
    assert result["paidMinor"] == 500
    with db.connection() as conn:
        assert one(conn, "SELECT status FROM event_application WHERE id = %s", (event_id,))["status"] == "BOOKED"


def test_exact_balance_and_separate_extra_complete_event(db):
    now = datetime(2030, 1, 1, tzinfo=UTC)
    event_id, _, deposit, admin, _, due = _seed(db, now)
    proof, _ = _proof(db, event_id, deposit, now)
    _receipt(db, event_id, deposit, admin, now, proof)
    with db.connection() as conn:
        balance = one(conn, "SELECT id FROM charge WHERE category = 'EVENT_BALANCE'")["id"]
    proof, disposition = _proof(db, event_id, balance, due + HOUR)
    assert disposition == "TIMELY"
    assert _receipt(db, event_id, balance, admin, due + DAY + HOUR, proof)["state"] == "PAID"
    extra_id = uuid4()
    actual_end = due + 3 * DAY
    with db.transaction() as conn:
        assert one(conn, "SELECT status FROM event_application WHERE id = %s", (event_id,))["status"] == "PROCEEDING"
        conn.execute("""
            UPDATE event_application SET status = 'ADDITIONAL_BILL', actual_end_at = %s, actual_teardown_at = %s
            WHERE id = %s
        """, (actual_end, actual_end + HOUR, event_id))
        conn.execute("""
            INSERT INTO charge (id,event_id,category,state,expected_minor,due_at,created_at)
            VALUES (%s,%s,'EVENT_EXTRA','OPEN',125,%s,%s)
        """, (extra_id, event_id, actual_end + 2 * DAY, actual_end + HOUR))
    proof, disposition = _proof(db, event_id, extra_id, actual_end + DAY)
    assert disposition == "TIMELY"
    assert _receipt(db, event_id, extra_id, admin, actual_end + DAY, proof, amount=125)["state"] == "PAID"
    with db.connection() as conn:
        assert one(conn, "SELECT status FROM event_application WHERE id = %s", (event_id,))["status"] == "COMPLETED"
        assert one(conn, "SELECT state FROM charge WHERE id = %s", (balance,))["state"] == "PAID"
        assert one(conn, "SELECT amount_minor FROM money_entry WHERE charge_id = %s", (extra_id,))["amount_minor"] == 125


def test_balance_worker_rechecks_revision_and_only_flags_followup(db, worker_db):
    now = datetime.now(UTC)
    event_id, _, deposit, admin, cutoff, _ = _seed(db, now, cutoff=now - 4 * DAY)
    proof, _ = _proof(db, event_id, deposit, cutoff - HOUR)
    _receipt(db, event_id, deposit, admin, cutoff - HOUR, proof)
    with db.transaction() as conn:
        balance = one(conn, "SELECT id FROM charge WHERE category = 'EVENT_BALANCE'")["id"]
        event = one(conn, """
            UPDATE event_application SET balance_deadline_revision = 2 WHERE id = %s RETURNING *
        """, (event_id,))
        enqueue_balance_work(conn, event, now)
        effective = event["effective_balance_grace_ends_at"]
    payload = {"chargeId": str(balance), "deadline": effective.isoformat(), "phase": "CUTOFF"}
    assert _run_work(db, worker_db, event_id, "EVENT_BALANCE_DUE", "old-balance", now, {**payload, "revision": 1}) == "obsolete"
    assert _run_work(db, worker_db, event_id, "EVENT_BALANCE_DUE", "current-balance", now, {**payload, "revision": 2}) == "flagged"
    with db.connection() as conn:
        assert one(conn, "SELECT status FROM event_application WHERE id = %s", (event_id,))["status"] == "BALANCE_GRACE"
        assert one(conn, "SELECT status FROM resource_window")["status"] == "BOOKED"
        assert one(conn, "SELECT state FROM charge WHERE id = %s", (balance,))["state"] == "OPEN"
        assert one(conn, """
            SELECT count(*) AS n FROM durable_work WHERE payload->>'milestone' = 'MERCHANT_EVENT_BALANCE_FOLLOWUP'
        """)["n"] == 1
