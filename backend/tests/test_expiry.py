from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

import pytest
from psycopg.types.json import Jsonb

from sweetcommerce.db import iso, one
from sweetcommerce.worker import apply_expiry, claim_expiry, poll_expiry
from sweetcommerce.worker import application
from sweetcommerce.worker.domain import Claim

DAY = "2030-01-01"
INITIAL = "STANDARD_PROOF_EXPIRY"
TOP_UP = "STANDARD_TOP_UP_EXPIRY"


def _job(conn, order, charge, deadline, *, kind=INITIAL, not_before=None, version=1):
    work = uuid4()
    conn.execute(
        """INSERT INTO durable_work (id,event_key,kind,resource_id,work_state,not_before,payload,payload_version,created_at)
           VALUES (%s,%s,%s,%s,'READY',%s,%s,%s,clock_timestamp())""",
        (work, str(work), kind, order, not_before or deadline,
         Jsonb({"deadline": iso(deadline), "chargeId": str(charge)}), version),
    )
    return work


@pytest.fixture
def expiry_fixture(db):
    account, product = uuid4(), uuid4()
    with db.transaction() as conn:
        conn.execute("INSERT INTO account (id,role,phone_e164) VALUES (%s,'CUSTOMER','+60123456789')", (account,))
        conn.execute("INSERT INTO product (id,name,status) VALUES (%s,'Sample','LISTED')", (product,))
        conn.execute("INSERT INTO capacity_day (service_date,closed,max_units) VALUES (%s,false,10)", (DAY,))
        now = one(conn, "SELECT date_trunc('milliseconds', clock_timestamp()) AS now")["now"]

    def seed(*, proof_offset=None, kind=INITIAL, deadline_delta=-30, early=False):
        order, review, charge = uuid4(), uuid4(), uuid4()
        deadline = now + timedelta(seconds=deadline_delta)
        initial = deadline - timedelta(hours=1) if kind == TOP_UP else deadline
        order_status = "PAYMENT_REVIEW" if proof_offset is not None else "PENDING_PROOF"
        charge_state = "PROOF_REVIEW" if proof_offset is not None else "OPEN"
        with db.transaction() as conn:
            conn.execute(
                """INSERT INTO checkout_review (id,account_id,cart_version,review_digest,terms_version,review_snapshot,expires_at,updated_at)
                   VALUES (%s,%s,1,%s,'1','{}',%s,%s)""",
                (review, account, bytes(32), initial, initial),
            )
            conn.execute(
                """INSERT INTO standard_order (id,order_number,account_id,checkout_review_id,status,fulfilment,payment_method,
                          service_date,requested_handoff_at,fulfilment_snapshot,subtotal_minor,fee_minor,terms_version,
                          proof_due_at,created_at,updated_at)
                   VALUES (%s,%s,%s,%s,%s,'PICKUP','DUITNOW',%s,'2030-01-01T04:00:00Z','{}',450,0,'1',%s,%s,%s)""",
                (order, str(order), account, review, order_status, DAY, initial, initial, initial),
            )
            conn.execute(
                """INSERT INTO charge (id,order_id,category,state,expected_minor,due_at,created_at)
                   VALUES (%s,%s,'STANDARD',%s,450,%s,%s)""",
                (charge, order, charge_state, initial, initial),
            )
            if kind == TOP_UP:
                conn.execute(
                    """UPDATE charge SET top_up_requested_at = %s, top_up_due_at = %s, top_up_outstanding_minor = 1
                        WHERE id = %s""",
                    (deadline - timedelta(minutes=30), deadline, charge),
                )
            conn.execute(
                """INSERT INTO capacity_allocation (order_id,service_date,product_id,quantity,state,generation)
                   VALUES (%s,%s,%s,1,'HELD',1)""",
                (order, DAY, product),
            )
            conn.execute("UPDATE capacity_day SET allocated_units = allocated_units + 1 WHERE service_date = %s", (DAY,))
            if proof_offset is not None:
                conn.execute(
                    """INSERT INTO payment_proof (id,charge_id,object_key,content_digest,byte_count,media_type,state,
                              review_disposition,received_at)
                       VALUES (%s,%s,%s,%s,8,'image/png','REVIEW','TIMELY',%s)""",
                    (uuid4(), charge, str(uuid4()), bytes(32), deadline + proof_offset),
                )
            work = _job(conn, order, charge, deadline, kind=kind, not_before=now if early else None)
        return order, charge, work, deadline
    return seed


def _lapse(db, work_id):
    with db.transaction() as conn:
        conn.execute("UPDATE durable_work SET lease_until = clock_timestamp() - interval '1 second' WHERE id = %s", (work_id,))


def test_expiry_reclaims_expired_lease_fences_duplicates_and_preserves_timely_proof(db, worker_db, expiry_fixture):
    order, charge, work, deadline = expiry_fixture(proof_offset=timedelta(0))
    first = claim_expiry(worker_db)
    assert isinstance(first, Claim) and first.id == work
    assert claim_expiry(worker_db) is None
    _lapse(worker_db, work)
    new = claim_expiry(worker_db)
    assert new.id == first.id and new.token != first.token
    assert apply_expiry(worker_db, first) == "stale-lease"
    assert apply_expiry(worker_db, new) == "expired"
    assert apply_expiry(worker_db, new) == "stale-lease"

    waiting_order, _, _, _ = expiry_fixture(proof_offset=timedelta(microseconds=-1))
    with db.transaction() as conn:
        duplicate = _job(conn, order, charge, deadline, not_before=deadline - timedelta(seconds=1))
    with ThreadPoolExecutor(max_workers=2) as threads:
        outcomes = list(threads.map(poll_expiry, [worker_db] * 2))
    assert sorted(outcomes) == ["obsolete", "preserved"]
    with db.connection() as conn:
        assert one(conn, "SELECT status,version FROM standard_order WHERE id = %s", (order,)) == {
            "status": "EXPIRED", "version": 2,
        }
        assert one(conn, "SELECT state,version FROM charge WHERE id = %s", (charge,)) == {
            "state": "EXPIRED", "version": 2,
        }
        assert one(conn, "SELECT status FROM standard_order WHERE id = %s", (waiting_order,))["status"] == "PAYMENT_REVIEW"
        assert one(conn, "SELECT allocated_units,version FROM capacity_day") == {"allocated_units": 1, "version": 2}
        assert one(conn, "SELECT count(*) FROM audit_event WHERE action = 'PROOF_EXPIRED'")["count"] == 1
        assert one(conn, "SELECT work_state,attempt_count,lease_token,lease_until FROM durable_work WHERE id = %s", (work,)) == {
            "work_state": "SUCCEEDED", "attempt_count": 2, "lease_token": None, "lease_until": None,
        }
        assert one(conn, "SELECT work_state FROM durable_work WHERE id = %s", (duplicate,))["work_state"] == "SUCCEEDED"


def test_early_work_defers_to_original_deadline_and_invalid_revision_is_dead(db, worker_db, expiry_fixture):
    order, charge, early, deadline = expiry_fixture(deadline_delta=3_600, early=True)
    assert poll_expiry(worker_db) == "deferred"
    assert poll_expiry(worker_db) is None
    with db.transaction() as conn:
        assert one(conn, "SELECT work_state,not_before,lease_token FROM durable_work WHERE id = %s", (early,)) == {
            "work_state": "READY", "not_before": deadline, "lease_token": None,
        }
        invalid = _job(conn, order, charge, deadline, not_before=deadline - timedelta(hours=2), version=2)
    assert poll_expiry(worker_db) == "invalid"
    with db.connection() as conn:
        assert one(conn, "SELECT work_state,last_safe_error FROM durable_work WHERE id = %s", (invalid,)) == {
            "work_state": "DEAD", "last_safe_error": "INVALID_EXPIRY_PAYLOAD",
        }
        assert one(conn, "SELECT status FROM standard_order WHERE id = %s", (order,))["status"] == "PENDING_PROOF"


@pytest.mark.parametrize("offset, result", [(-1, "expired"), (0, "preserved")])
def test_top_up_excludes_proofs_before_its_own_window(db, worker_db, expiry_fixture, offset, result):
    proof_offset = timedelta(minutes=-30, microseconds=offset)
    order, charge, _, deadline = expiry_fixture(proof_offset=proof_offset, kind=TOP_UP)
    with db.transaction() as conn:
        _job(conn, order, charge, deadline - timedelta(hours=1))
    assert poll_expiry(worker_db) == "obsolete"
    assert poll_expiry(worker_db) == result


def test_expiry_failure_rolls_back_all_effects_and_reclaimed_job_retries(db, worker_db, expiry_fixture, monkeypatch):
    order, _, work, _ = expiry_fixture()
    claim = claim_expiry(worker_db)

    def fail_after_order_update(conn, claim, order, charge, released):
        record_expiry(conn, claim, order, charge, released)
        raise RuntimeError("worker interrupted")

    record_expiry = application.store.record_expiry
    with monkeypatch.context() as patch:
        patch.setattr(application.store, "record_expiry", fail_after_order_update)
        with pytest.raises(RuntimeError, match="worker interrupted"):
            apply_expiry(worker_db, claim)

    with db.connection() as conn:
        assert one(conn, "SELECT work_state,attempt_count FROM durable_work WHERE id = %s", (work,)) == {
            "work_state": "LEASED", "attempt_count": 1,
        }
        assert one(conn, "SELECT status FROM standard_order WHERE id = %s", (order,))["status"] == "PENDING_PROOF"
        assert one(conn, "SELECT allocated_units FROM capacity_day")["allocated_units"] == 1
        assert one(conn, "SELECT count(*) FROM audit_event WHERE action = 'PROOF_EXPIRED'")["count"] == 0
    _lapse(worker_db, work)
    assert poll_expiry(worker_db) == "expired"
