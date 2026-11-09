from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Barrier
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from psycopg.types.json import Jsonb

from conftest import API, ORIGIN
from test_api_contract import _assert_json_contract
from sweetcommerce.capacity.infrastructure import CapacityCommand
from sweetcommerce.db import iso, one, rows
from sweetcommerce.problems import Problem
from sweetcommerce.refunds.application import RefundService
from sweetcommerce.refunds.infrastructure import (
    create_full_refund_obligations,
    lock_parent_and_charge,
    money_totals,
    recent_refund_intents,
)
from sweetcommerce.worker import poll_expiry

PAYOUT = "2025-01-01T09:10:11.123456+08:00"


def _command():
    return CapacityCommand(str(uuid4()), str(uuid4()))


def _reserve(receipt, amount, version=1):
    return {"receiptId": str(receipt), "amountMinor": amount, "expectedVersion": version, "reason": "Return verified funds"}


def _post(intent, amount, version, reference):
    return {
        "refundIntentId": intent, "amountMinor": amount, "expectedVersion": version, "externalReference": reference,
        "refundedAt": PAYOUT, "reason": "Verified payout",
    }


@pytest.fixture
def refund_data(db, sign_in):
    session, headers = sign_in("ADMIN")
    admin = SimpleNamespace(account_id=UUID(session["accountId"]), role="ADMIN")
    owner = uuid4()
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO account (id,role,phone_e164) VALUES (%s,'CUSTOMER','+60112000002')",
            (owner,),
        )

    def seed(*amounts, rail="DUITNOW", order_status="ACCEPTED", charge_state="PAID"):
        order, review, charge = uuid4(), uuid4(), uuid4()
        receipt_ids = [uuid4() for _ in amounts]
        with db.transaction() as conn:
            conn.execute("""
                INSERT INTO checkout_review
                    (id,account_id,cart_version,review_digest,terms_version,review_snapshot,expires_at,updated_at)
                VALUES (%s,%s,1,%s,'1','{}',clock_timestamp(),clock_timestamp())
            """, (review, owner, bytes(32)))
            conn.execute("""
                INSERT INTO standard_order
                    (id,order_number,account_id,checkout_review_id,status,fulfilment,payment_method,
                     service_date,requested_handoff_at,fulfilment_snapshot,subtotal_minor,fee_minor,terms_version,
                     created_at,updated_at)
                VALUES (%s,%s,%s,%s,%s,'PICKUP',%s,'2025-01-01','2025-01-01T06:00Z',
                        '{"contactName":"Sample Customer","phone":"+60112000002","pickupDisplay":"Sample pickup",
                          "termsText":"Sample terms"}',%s,0,'1',
                        clock_timestamp(),clock_timestamp())
            """, (order, str(order), owner, review, order_status, rail, sum(amounts)))
            conn.execute("""
                INSERT INTO charge (id,order_id,category,state,expected_minor,created_at)
                VALUES (%s,%s,'STANDARD',%s,%s,clock_timestamp())
            """, (charge, order, charge_state, sum(amounts)))
            for receipt, amount in zip(receipt_ids, amounts, strict=True):
                conn.execute("""
                    INSERT INTO money_entry (id,charge_id,kind,rail,external_reference,amount_minor,occurred_at,actor_id)
                    VALUES (%s,%s,'RECEIPT',%s,%s,%s,'2025-01-01T01:00Z',%s)
                """, (receipt, charge, rail, str(receipt), amount, admin.account_id))
        return order, charge, receipt_ids

    return admin, headers, seed


def test_concurrent_reservations_and_lost_payout_response(db, refund_data):
    admin, _, seed = refund_data
    order, charge, (receipt,) = seed(1000)
    service = RefundService(db)
    body = _reserve(receipt, 700)
    ready = Barrier(2, timeout=5)

    def attempt(context):
        ready.wait()
        try:
            return service.reserve_refund(admin, charge, body, context)
        except Problem as error:
            return error.code

    contexts = [_command(), _command()]
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(attempt, contexts))
    assert results.count("VERSION_CONFLICT") == 1
    winner = next(index for index, result in enumerate(results) if isinstance(result, dict))
    reserved = results[winner]
    assert reserved["charge"]["refundableMinor"] == 300
    with pytest.raises(Problem, match="available amount") as limited:
        service.reserve_refund(admin, charge, _reserve(receipt, 301, 2), _command())
    assert limited.value.code == "REFUND_LIMIT_EXCEEDED"

    intent = reserved["refundIntentId"]
    payout = _post(intent, 700, 2, "verified-bank-payout")
    key = _command()
    posted = service.record_refund(admin, charge, payout, key)
    assert (posted["state"], posted["refundedMinor"], posted["version"]) == ("PARTIALLY_REFUNDED", 700, 3)
    # A committed payout may have lost its HTTP response. Replay uses the original version and payload.
    assert service.record_refund(admin, charge, payout, key) == posted
    assert service.reserve_refund(admin, charge, body, contexts[winner]) == reserved
    with pytest.raises(Problem) as changed:
        service.record_refund(admin, charge, {**payout, "externalReference": "changed"}, key)
    assert changed.value.code == "IDEMPOTENCY_CONFLICT"
    with pytest.raises(Problem) as posted_intent:
        service.record_refund(admin, charge, {**payout, "expectedVersion": 3}, _command())
    assert posted_intent.value.code == "INVALID_TRANSITION"

    with db.connection() as conn:
        entry, = rows(conn, """SELECT * FROM money_entry WHERE charge_id = %s AND kind = 'REFUND'""", (charge,))
        assert entry["occurred_at"] == datetime.fromisoformat(PAYOUT)
        assert entry["recorded_at"] > entry["occurred_at"]
        assert (entry["actor_id"], entry["rail"], entry["amount_minor"]) == (admin.account_id, "DUITNOW", 700)
        assert one(conn, "SELECT refund_entry_id FROM refund_intent WHERE id = %s", (intent,))["refund_entry_id"] == entry["id"]
        assert one(conn, "SELECT status FROM standard_order WHERE id = %s", (order,))["status"] == "ACCEPTED"
        assert one(conn, "SELECT count(*) FROM audit_event WHERE action = 'RECORD_REFUND' AND request_id = %s",
                   (key.request_id,))["count"] == 1


def test_refund_routes_keep_uncertain_value_reserved_until_non_payout(client, sign_in, db, refund_data):
    _, admin, seed = refund_data
    _, charge, (receipt,) = seed(600)
    _, customer = sign_in()
    reserve_path = API + f"/admin/charges/{charge}/refund-intents"

    def request(path, body, key=None, headers=admin):
        return client.post(path, json=body, headers={**headers, "Idempotency-Key": key or str(uuid4())})

    body = _reserve(receipt, 600)
    assert request(reserve_path, body, headers=customer).json()["code"] == "FORBIDDEN"
    assert request(reserve_path, body, headers={**admin, "Origin": ORIGIN + ".invalid"}).json()["code"] == "ORIGIN_DENIED"
    assert request(reserve_path, {**body, "amountMinor": True}).status_code == 422
    response = request(reserve_path, body)
    assert response.status_code == 200, response.text
    _assert_json_contract(response, "reserveRefund")
    reserved = response.json()
    intent = reserved["refundIntentId"]
    reconcile_path = API + f"/admin/refund-intents/{intent}/reconcile"
    uncertain = {"outcome": "PAYOUT_UNCERTAIN", "reason": "Bank confirmation pending", "expectedChargeVersion": 2}
    uncertain_key = str(uuid4())
    result = request(reconcile_path, uncertain, uncertain_key)
    assert result.status_code == 200, result.text
    _assert_json_contract(result, "reconcileRefundIntent")
    assert result.json()["state"] == "UNCERTAIN"
    assert datetime.fromisoformat(result.json()["updatedAt"]) > datetime.fromisoformat(PAYOUT)
    assert request(reserve_path, _reserve(receipt, 1, 3)).json()["code"] == "REFUND_LIMIT_EXCEEDED"
    with db.connection() as conn:
        assert recent_refund_intents(conn, charge) == [result.json()]
        assert money_totals(conn, charge)["available"] == 0

    voided = request(reconcile_path, {
        "outcome": "CONFIRMED_NOT_PAID", "reason": "Bank confirms no funds left", "expectedChargeVersion": 3,
    })
    assert voided.status_code == 200 and voided.json()["state"] == "VOIDED"
    assert request(reconcile_path, uncertain, uncertain_key).json() == result.json()
    payout_path = API + f"/admin/charges/{charge}/refunds"
    assert request(payout_path, _post(intent, 600, 4, "voided-reference")).json()["code"] == "INVALID_TRANSITION"
    replacement = request(reserve_path, _reserve(receipt, 600, 4)).json()["refundIntentId"]
    payout = request(payout_path, _post(replacement, 600, 5, "verified-replacement"))
    assert payout.status_code == 200, payout.text
    _assert_json_contract(payout, "recordRefund")
    assert (payout.json()["state"], payout.json()["refundableMinor"]) == ("REFUNDED", 0)
    with db.connection() as conn:
        assert one(conn, "SELECT count(*) FROM money_entry WHERE kind = 'REFUND'")["count"] == 1


def test_cross_charge_duplicate_reference_leaves_intent_available_to_reconcile(db, refund_data):
    admin, _, seed = refund_data
    service = RefundService(db)
    _, first, (first_receipt,) = seed(500, rail="CASH")
    _, second, (second_receipt,) = seed(500, rail="CASH")
    with pytest.raises(Problem) as foreign_receipt:
        service.reserve_refund(admin, first, _reserve(second_receipt, 500), _command())
    assert foreign_receipt.value.code == "NOT_FOUND"
    first_intent = service.reserve_refund(admin, first, _reserve(first_receipt, 500), _command())["refundIntentId"]
    second_intent = service.reserve_refund(admin, second, _reserve(second_receipt, 500), _command())["refundIntentId"]
    with pytest.raises(Problem) as foreign_intent:
        service.record_refund(admin, first, _post(second_intent, 500, 2, "wrong-charge"), _command())
    assert foreign_intent.value.code == "NOT_FOUND"

    # A payout reference can match a receipt reference. It cannot match another payout on the same rail.
    reference = str(first_receipt)
    service.record_refund(admin, first, _post(first_intent, 500, 2, reference), _command())
    uncertain = service.reconcile_refund_intent(admin, second_intent, {
        "outcome": "PAYOUT_UNCERTAIN", "expectedChargeVersion": 2, "reason": "Waiting for a verified reference",
    }, _command())
    assert uncertain["state"] == "UNCERTAIN"
    with pytest.raises(Problem) as duplicate:
        service.record_refund(admin, second, _post(second_intent, 500, 3, reference), _command())
    assert duplicate.value.code == "INVALID_TRANSITION"
    future = {**_post(second_intent, 500, 3, "future"), "refundedAt": (datetime.fromisoformat(PAYOUT) + timedelta(days=36500)).isoformat()}
    with pytest.raises(Problem) as invalid_time:
        service.record_refund(admin, second, future, _command())
    assert invalid_time.value.code == "VALIDATION"
    with db.connection() as conn:
        assert one(conn, "SELECT version FROM charge WHERE id = %s", (second,))["version"] == 3
        assert recent_refund_intents(conn, second)[0]["state"] == "UNCERTAIN"
        assert money_totals(conn, second) == {"paid": 500, "refunded": 0, "available": 0, "required": 0}
    posted = service.record_refund(admin, second, _post(second_intent, 500, 3, "confirmed-cash-payout"), _command())
    assert posted["state"] == "REFUNDED"


def test_merchant_inability_obligations_are_atomic_and_net_of_prior_payouts(client, db, refund_data):
    admin, headers, seed = refund_data
    order, charge, (first, second) = seed(1000, 400, order_status="PREPARING")
    service = RefundService(db)
    initial = service.reserve_refund(admin, charge, _reserve(first, 250), _command())["refundIntentId"]
    service.record_refund(admin, charge, _post(initial, 250, 2, "prior-payout"), _command())
    pending = service.reserve_refund(admin, charge, _reserve(first, 200, 3), _command())["refundIntentId"]
    with db.transaction() as conn:
        product, variant = uuid4(), uuid4()
        conn.execute("UPDATE standard_order SET accepted_at = created_at WHERE id = %s", (order,))
        conn.execute("INSERT INTO product (id,name,status) VALUES (%s,'Tart','LISTED')", (product,))
        conn.execute("""
            INSERT INTO variant (id,product_id,name,flavour,available,unit_minor,prep_minutes)
            VALUES (%s,%s,'Mini','Lemon',true,1400,30)
        """, (variant, product))
        conn.execute("""
            INSERT INTO standard_order_line (order_id,variant_id,product_id,quantity,unit_minor,display_snapshot)
            VALUES (%s,%s,%s,1,1400,%s)
        """, (order, variant, product, Jsonb({
            "variantId": str(variant), "quantity": 1, "unitMinor": 1400,
            "product": "Tart", "variant": "Mini", "flavour": "Lemon",
        })))
        conn.execute("INSERT INTO capacity_day (service_date,closed,max_units,allocated_units) VALUES ('2025-01-01',false,10,1)")
        conn.execute("""
            INSERT INTO capacity_allocation (order_id,service_date,product_id,quantity,state,generation)
            VALUES (%s,'2025-01-01',%s,1,'USED',1)
        """, (order, product))

    with pytest.raises(RuntimeError, match="simulate cancelled transaction"):
        with db.transaction() as conn:
            lock_parent_and_charge(conn, charge)
            conn.execute("UPDATE standard_order SET status = 'CANCELLED' WHERE id = %s", (order,))
            create_full_refund_obligations(conn, charge, admin.account_id, "MERCHANT_UNABLE")
            raise RuntimeError("simulate cancelled transaction")

    with db.connection() as conn:
        assert one(conn, "SELECT status FROM standard_order WHERE id = %s", (order,))["status"] == "PREPARING"
        assert money_totals(conn, charge)["required"] == 0
    path = API + f"/admin/orders/{order}/actions"
    cancel_headers = {**headers, "If-Match": '"1"', "Idempotency-Key": str(uuid4())}
    body = {"action": "CANCEL", "cancellationBasis": "MERCHANT_UNABLE", "reason": "Production unavailable"}
    cancelled = client.post(path, headers=cancel_headers, json=body)
    assert cancelled.status_code == 200, cancelled.text
    after_cancel = cancelled.json()
    assert after_cancel["status"] == "CANCELLED"
    assert after_cancel["charge"]["requiredRefundMinor"] == 1150
    assert client.post(path, headers=cancel_headers, json=body).json() == after_cancel
    with db.connection() as conn:
        obligations = rows(conn, "SELECT receipt_id,amount_minor FROM full_refund_obligation")
        assert {item["receipt_id"]: item["amount_minor"] for item in obligations} == {first: 750, second: 400}
        assert money_totals(conn, charge) == {"paid": 1400, "refunded": 250, "available": 950, "required": 1150}
        assert one(conn, "SELECT state FROM capacity_allocation WHERE order_id = %s", (order,))["state"] == "USED"
        privileges = one(conn, """
            SELECT has_table_privilege('money_entry', 'UPDATE') AS can_update,
                   has_table_privilege('money_entry', 'DELETE') AS can_delete,
                   has_function_privilege('sweetcommerce_worker', 'sweetcommerce.lock_receipt(uuid,uuid)', 'EXECUTE') AS worker_lock
        """)
        assert not any(privileges.values())
    payout = _post(pending, 200, after_cancel["charge"]["version"], "remaining-payout")
    charge_view = service.record_refund(admin, charge, payout, _command())
    assert (charge_view["refundableMinor"], charge_view["requiredRefundMinor"]) == (950, 950)


def test_refund_does_not_preempt_expiry_of_an_active_shortfall(db, worker_db, refund_data):
    admin, _, seed = refund_data
    order, charge, (receipt,) = seed(600, order_status="PAYMENT_REVIEW", charge_state="DISPUTED")
    deadline = datetime.fromisoformat("2025-01-01T01:30:00+00:00")
    with db.transaction() as conn:
        conn.execute("""
            UPDATE charge SET expected_minor = 1000, top_up_requested_at = %s,
                              top_up_due_at = %s, top_up_outstanding_minor = 400 WHERE id = %s
        """, (deadline - timedelta(minutes=30), deadline, charge))
        conn.execute("""
            INSERT INTO durable_work (id,event_key,kind,resource_id,work_state,not_before,payload,created_at)
            VALUES (%s,%s,'STANDARD_TOP_UP_EXPIRY',%s,'READY',%s,%s,clock_timestamp())
        """, (uuid4(), str(uuid4()), order, deadline, Jsonb({"deadline": iso(deadline), "chargeId": str(charge)})))
    service = RefundService(db)
    intent = service.reserve_refund(admin, charge, _reserve(receipt, 200), _command())["refundIntentId"]
    posted = service.record_refund(admin, charge, _post(intent, 200, 2, "shortfall-refund"), _command())
    assert posted["state"] == "DISPUTED"
    assert poll_expiry(worker_db) == "expired"
    with db.connection() as conn:
        assert one(conn, "SELECT state,version FROM charge WHERE id = %s", (charge,)) == {"state": "EXPIRED", "version": 4}
        assert money_totals(conn, charge)["refunded"] == 200


def test_shared_refund_routes_accept_event_balance_charge(client, db, refund_data):
    admin, headers, _ = refund_data
    event, quote, charge, receipt = (uuid4() for _ in range(4))
    with db.transaction() as conn:
        customer = one(conn, "SELECT id FROM account WHERE role = 'CUSTOMER'")["id"]
        conn.execute("""
            INSERT INTO event_application
                (id,event_number,account_id,submission_intent_id,submission_digest,status,event_date,
                 start_at,expected_end_at,setup_ready_at,request_snapshot,created_at,updated_at)
            VALUES (%s,%s,%s,%s,%s,'CANCELLED','2025-01-15','2025-01-15T04:00Z','2025-01-15T06:00Z',
                    '2025-01-15T03:00Z','{}',clock_timestamp(),clock_timestamp())
        """, (event, str(event), customer, uuid4(), bytes(32)))
        conn.execute("""
            INSERT INTO event_quote
                (id,event_id,version,status,total_minor,deposit_minor,balance_minor,issued_at,
                 deposit_due_at,balance_due_at,event_start_at,event_end_at,setup_ready_at,teardown_at,quote_snapshot,terms_version)
            VALUES (%s,%s,1,'CANCELLED',1600,800,800,'2024-12-01T01:00Z','2024-12-15T01:00Z','2025-01-12T01:00Z',
                    '2025-01-15T04:00Z','2025-01-15T06:00Z','2025-01-15T03:00Z','2025-01-15T07:00Z','{}','1')
        """, (quote, event))
        conn.execute("""
            INSERT INTO charge (id,event_id,quote_id,category,state,expected_minor,created_at)
            VALUES (%s,%s,%s,'EVENT_BALANCE','PAID',800,clock_timestamp())
        """, (charge, event, quote))
        conn.execute("""
            INSERT INTO money_entry (id,charge_id,kind,rail,external_reference,amount_minor,occurred_at,actor_id)
            VALUES (%s,%s,'RECEIPT','DUITNOW',%s,800,'2024-12-31T01:00Z',%s)
        """, (receipt, charge, str(receipt), admin.account_id))
        lock_parent_and_charge(conn, charge)
        create_full_refund_obligations(conn, charge, admin.account_id, "MERCHANT_UNABLE")

    def submit(path, body):
        response = client.post(API + path, json=body, headers={**headers, "Idempotency-Key": str(uuid4())})
        assert response.status_code == 200, response.text
        return response.json()

    path = f"/admin/charges/{charge}"
    reserved = submit(path + "/refund-intents", _reserve(receipt, 800))
    assert reserved["charge"]["category"] == "EVENT_BALANCE"
    assert reserved["charge"]["requiredRefundMinor"] == 800
    intent = reserved["refundIntentId"]
    assert submit(f"/admin/refund-intents/{intent}/reconcile", {
        "outcome": "PAYOUT_UNCERTAIN", "reason": "Awaiting confirmation", "expectedChargeVersion": 2,
    })["state"] == "UNCERTAIN"
    posted = submit(path + "/refunds", _post(intent, 800, 3, "verified-event-payout"))
    assert (posted["state"], posted["requiredRefundMinor"]) == ("REFUNDED", 0)
    with db.connection() as conn:
        assert one(conn, "SELECT status,version FROM event_application WHERE id = %s", (event,)) == {
            "status": "CANCELLED", "version": 1,
        }
