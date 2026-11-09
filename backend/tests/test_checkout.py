from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from time import monotonic, sleep
from uuid import uuid4

import pytest

from sweetcommerce.capacity.infrastructure import CapacityCommand
from sweetcommerce.db import one
from sweetcommerce.http import Problem
from sweetcommerce.identity.domain import Session
from sweetcommerce.order import OrderService

API = "/api/v1"
DAY = "2030-01-01"
ADDRESS = {
    "line1": "4 Fixture Lane", "city": "Kuala Lumpur", "postcode": "50000",
    "region": "Kuala Lumpur", "note": "Call at the gate",
}


def _command():
    return CapacityCommand(str(uuid4()), str(uuid4()))


def _submit_body(checkout, review, **changes):
    return {
        **checkout, "reviewId": review["reviewId"], "termsVersion": review["termsVersion"],
        "paymentMethod": "DUITNOW", **changes,
    }


def _expect(code, run, *args):
    with pytest.raises(Problem) as error:
        run(*args)
    assert error.value.code == code


@pytest.fixture
def checkout_fixture(db, sign_in, clock):
    def seed(*, max_units=8, existing_day=False, variant_id=None):
        signed_in, headers = sign_in()
        session = Session(
            account_id=signed_in["accountId"], role="CUSTOMER", csrf_token=signed_in["csrfToken"],
            expires_at=datetime.fromisoformat(signed_in["expiresAt"]),
        )
        variant, product, generation = variant_id or str(uuid4()), str(uuid4()), str(uuid4())
        with db.transaction() as conn:
            conn.execute("INSERT INTO product (id,name,status) VALUES (%s,'Mini Tart','LISTED')", (product,))
            conn.execute(
                """INSERT INTO variant (id,product_id,name,flavour,available,unit_minor,prep_minutes)
                   VALUES (%s,%s,'Box of tarts','Chocolate',true,450,30)""",
                (variant, product),
            )
            if not existing_day:
                conn.execute("INSERT INTO capacity_day (service_date,closed,max_units) VALUES (%s,false,%s)", (DAY, max_units))
            conn.execute("INSERT INTO cart (account_id,version) VALUES (%s,2)", (session.account_id,))
            conn.execute(
                "INSERT INTO cart_line (id,account_id,variant_id,quantity) VALUES (%s,%s,%s,3)",
                (generation, session.account_id, variant),
            )
        checkout = {
            "items": [{"variantId": variant, "quantity": 2}], "requestedHandoffAt": f"{DAY}T12:30:00+08:00",
            "fulfilment": "PICKUP", "cartVersion": 2, "contactName": "Fixture Customer",
            "phone": "+60100000001", "notificationEmail": "fixture@example.test",
        }
        config = {
            "terms": {"version": "fixture-v1", "text": "Fixture ordering terms."},
            "pickup": "Fixture pickup, Gate 2",
        }
        service = OrderService(
            db, lambda: config["terms"], lambda: config["pickup"],
            clock=clock, review_ttl_ms=60_000, duitnow_qr_url="/fixture-qr",
        )
        return session, headers, checkout, service, config
    return seed


def test_checkout_http_concurrent_replay_and_owned_historical_snapshot(db, client, sign_in, checkout_fixture):
    session, headers, checkout, _, _ = checkout_fixture()
    _, foreign = sign_in()
    review_path = API + "/checkout/review"
    order_path = API + "/orders"
    key = str(uuid4())
    headers = {**headers, "Idempotency-Key": key}
    assert client.post(review_path, json=checkout, headers={**headers, "X-CSRF-Token": "wrong"}).json()["code"] == "FORBIDDEN"
    assert client.post(review_path, json=checkout, headers={**headers, "Origin": "https://elsewhere.test"}).json()["code"] == "ORIGIN_DENIED"

    response = client.post(review_path, json=checkout, headers=headers)
    assert response.status_code == 200
    review = response.json()
    assert review["paymentMethods"] == ["DUITNOW", "CASH"]
    assert review["eligible"] is True
    assert review["requestedHandoffAt"] == f"{DAY}T04:30:00.000Z"
    assert review["subtotalMinor"] == review["totalMinor"] == 900
    assert review["feeMinor"] == 0
    assert review["items"] == [{
        **checkout["items"][0], "product": "Mini Tart", "variant": "Box of tarts",
        "flavour": "Chocolate", "unitMinor": 450,
    }]
    with db.connection() as conn:
        assert one(conn, "SELECT allocated_units FROM capacity_day")["allocated_units"] == 0

    body = _submit_body(checkout, review)
    with ThreadPoolExecutor(max_workers=2) as threads:
        attempts = [threads.submit(client.post, order_path, json=body, headers=headers) for _ in range(2)]
        responses = [attempt.result() for attempt in attempts]
    assert [item.status_code for item in responses] == [201, 201]
    order = responses[0].json()
    assert order == responses[1].json()
    assert order["status"] == "PENDING_PROOF"
    assert order["proofDueAt"] == "2030-01-01T00:30:00.000Z"
    assert order["charge"]["expectedMinor"] == 900
    assert order["charge"]["dueAt"] == order["proofDueAt"]
    assert responses[0].headers["cache-control"] == "no-store"
    assert responses[0].headers["x-request-id"]

    with db.transaction() as conn:
        assert one(conn, """
            SELECT a.quantity, a.state, d.allocated_units, d.version, l.cart_line_generation = cl.id AS saved_generation,
                   cl.quantity AS cart_quantity
              FROM capacity_allocation a JOIN capacity_day d USING (service_date)
              JOIN standard_order_line l ON l.order_id = a.order_id
              JOIN cart_line cl ON cl.account_id = %s AND cl.variant_id = l.variant_id
        """, (session.account_id,)) == {
            "quantity": 2, "state": "HELD", "allocated_units": 2, "version": 2, "saved_generation": True, "cart_quantity": 3,
        }
        assert one(conn, "SELECT count(*) FROM command_receipt WHERE operation = 'submitOrder'")["count"] == 1
        assert one(conn, "SELECT count(*) FROM standard_order")["count"] == 1
        job = one(conn, "SELECT kind,not_before,payload FROM durable_work WHERE kind <> 'NOTICE'")
        assert job == {
            "kind": "STANDARD_PROOF_EXPIRY", "not_before": datetime.fromisoformat(order["proofDueAt"]),
            "payload": {"deadline": order["proofDueAt"], "chargeId": order["charge"]["id"]},
        }
        assert one(conn, "SELECT request_id FROM audit_event WHERE action = 'SUBMIT'")["request_id"] in {
            item.headers["x-request-id"] for item in responses
        }

        conn.execute("UPDATE variant SET name = 'New box', flavour = 'New flavour', unit_minor = 500 WHERE id = %s",
                     (checkout["items"][0]["variantId"],))
        conn.execute("UPDATE product SET name = 'New product', status = 'ARCHIVED'")
        conn.execute("UPDATE standard_order SET status = 'ACCEPTED', version = version + 1 WHERE id = %s", (order["id"],))
        conn.execute("UPDATE charge SET state = 'PAID', version = version + 1 WHERE id = %s", (order["charge"]["id"],))
        conn.execute(
            """INSERT INTO money_entry (id,charge_id,kind,rail,external_reference,amount_minor,occurred_at,actor_id)
               VALUES (%s,%s,'RECEIPT','DUITNOW',%s,900,clock_timestamp(),%s)""",
            (uuid4(), order["charge"]["id"], str(uuid4()), session.account_id),
        )

    command_path = f"{API}/commands/{key}?operation=submitOrder"
    detail_path = f"{order_path}/{order['id']}"
    outcome_path = f"{API}/checkout/reviews/{review['reviewId']}/outcome"
    assert client.get(detail_path, headers=foreign).status_code == 404
    assert client.get(outcome_path, headers=foreign).status_code == 404
    assert client.get(command_path, headers=foreign).status_code == 404
    command = client.get(command_path, headers=headers).json()
    assert (command["resourceType"], command["resourceId"]) == ("ORDER", order["id"])
    assert client.get(outcome_path, headers=headers).json()["orderId"] == order["id"]
    changed = client.post(order_path, json={**body, "contactName": "Other contact"}, headers=headers)
    assert changed.json()["code"] == "IDEMPOTENCY_CONFLICT"
    historical = client.get(detail_path, headers=headers).json()
    for field in ("items", "number", "contactName", "phone", "notificationEmail", "requestedHandoffAt",
                  "pickupDisplay", "subtotalMinor", "feeMinor", "totalMinor", "termsVersion", "termsText"):
        assert historical[field] == order[field]
    assert (historical["status"], historical["charge"]["paidMinor"], historical["charge"]["qrUrl"]) == ("ACCEPTED", 900, None)
    assert client.post(order_path, json=body, headers={**headers, "Idempotency-Key": str(uuid4())}).json() == historical
    assert client.put(detail_path, json=body, headers=headers).status_code == 404


def test_checkout_fee_and_cash_wait_without_hold_and_qr_stops_at_cutoff(db, clock, checkout_fixture):
    actor, _, checkout, service, _ = checkout_fixture()
    merchant = {**checkout, "fulfilment": "MERCHANT_LALAMOVE", "address": ADDRESS}
    reviewed = service.review_checkout(actor, merchant)
    assert (reviewed["feeMinor"], reviewed["totalMinor"], reviewed["pickupDisplay"]) == (None, None, None)
    assert reviewed["address"] == ADDRESS
    _expect("VALIDATION", service.submit_order, actor, _submit_body(merchant, reviewed, paymentMethod="CASH"), _command())
    fee = service.submit_order(actor, _submit_body(merchant, reviewed), _command())
    cash = service.submit_order(actor, _submit_body(checkout, service.review_checkout(actor, checkout), paymentMethod="CASH"), _command())
    assert [fee["status"], cash["status"]] == ["AWAITING_FEE", "AWAITING_CASH"]
    for waiting in [fee, cash]:
        assert (waiting["proofDueAt"], waiting["charge"], waiting["promisedHandoffAt"]) == (None, None, None)
    with db.connection() as conn:
        assert one(conn, "SELECT allocated_units,version FROM capacity_day") == {"allocated_units": 0, "version": 3}
        assert one(conn, "SELECT count(*) FROM durable_work WHERE kind <> 'NOTICE'")["count"] == 0

    own_delivery = {**merchant, "fulfilment": "CUSTOMER_LALAMOVE"}
    reviewed = service.review_checkout(actor, own_delivery)
    assert "pay Lalamove separately" in reviewed["instructions"]
    order = service.submit_order(actor, _submit_body(own_delivery, reviewed), _command())
    assert order["status"] == "PENDING_PROOF"
    assert order["feeMinor"] == 0
    assert order["charge"]["qrUrl"] == "/fixture-qr"
    clock.advance(30 * 60 * 1000 - 1)
    assert service.get_own_order(actor, order["id"])["charge"]["qrUrl"] == "/fixture-qr"
    clock.advance(1)
    assert service.get_own_order(actor, order["id"])["charge"]["qrUrl"] is None


def test_checkout_stale_review_or_capacity_change_rolls_back_all_writes(db, checkout_fixture):
    actor, _, checkout, service, config = checkout_fixture()
    review = service.review_checkout(actor, checkout)
    body = _submit_body(checkout, review)
    _expect("REVIEW_STALE", service.submit_order, actor, {**body, "notificationEmail": "new@example.test"}, _command())
    config["terms"]["text"] = "New text under the same version"
    _expect("TERMS_CHANGED", service.submit_order, actor, body, _command())
    body = _submit_body(checkout, service.review_checkout(actor, checkout))
    config["pickup"] = "Another pickup point"
    _expect("REVIEW_STALE", service.submit_order, actor, body, _command())
    body = _submit_body(checkout, service.review_checkout(actor, checkout))
    with db.transaction() as conn:
        conn.execute("UPDATE variant SET flavour = 'Vanilla'")
    _expect("REVIEW_STALE", service.submit_order, actor, body, _command())
    body = _submit_body(checkout, service.review_checkout(actor, checkout))
    with db.transaction() as conn:
        conn.execute("UPDATE capacity_day SET closed = true")
    _expect("CAPACITY_UNAVAILABLE", service.submit_order, actor, body, _command())
    ineligible = service.review_checkout(actor, checkout)
    assert not ineligible["eligible"] and ineligible["paymentMethods"] == []
    with db.transaction() as conn:
        conn.execute("UPDATE capacity_day SET closed = false")
    _expect("REVIEW_STALE", service.submit_order, actor, _submit_body(checkout, ineligible), _command())
    with db.transaction() as conn:
        conn.execute("UPDATE cart SET version = version + 1")
    _expect("REVIEW_STALE", service.submit_order, actor, body, _command())
    with db.connection() as conn:
        for table in ("standard_order", "charge", "capacity_allocation", "command_receipt"):
            assert one(conn, f"SELECT count(*) FROM {table}")["count"] == 0


def _wait_for_review_contenders(db, expected):
    limit = monotonic() + 3
    while monotonic() < limit:
        with db.connection() as conn:
            waiting = one(conn, """
                SELECT count(*) FROM pg_stat_activity
                 WHERE wait_event_type = 'Lock' AND query LIKE %s
            """, ("%FROM checkout_review WHERE account_id = $1 AND id = $2 FOR UPDATE%",))
        if waiting["count"] >= expected:
            return
        sleep(0.01)
    pytest.fail("Checkout contenders did not reach the row lock")


@pytest.mark.parametrize("submit_first", [True, False])
def test_submit_and_abandon_serialize_in_both_directions(db, checkout_fixture, submit_first):
    actor, _, checkout, service, _ = checkout_fixture()
    review = service.review_checkout(actor, checkout)
    body = _submit_body(checkout, review)
    review_id = review["reviewId"]
    submit = (service.submit_order, actor, body, _command())
    abandon = (service.abandon_or_resolve_checkout, actor, review_id, _command())
    with ThreadPoolExecutor(max_workers=2) as threads:
        with db.transaction() as conn:
            conn.execute("SELECT id FROM checkout_review WHERE id = %s FOR UPDATE", (review_id,))
            first = threads.submit(*(submit if submit_first else abandon))
            _wait_for_review_contenders(db, 1)
            second = threads.submit(*(abandon if submit_first else submit))
            _wait_for_review_contenders(db, 2)
        winner = first.result()
        outcome = service.get_checkout_outcome(actor, review_id)
        if submit_first:
            assert outcome == second.result()
            assert (outcome["state"], outcome["orderId"]) == ("SUBMITTED", winner["id"])
        else:
            assert outcome == winner and outcome["state"] == "ABANDONED"
            _expect("REVIEW_STALE", second.result)
    with db.connection() as conn:
        assert one(conn, "SELECT count(*) FROM standard_order")["count"] == int(submit_first)


def test_competing_reviews_cannot_oversell_capacity(db, checkout_fixture):
    first = checkout_fixture(max_units=2)
    second = checkout_fixture(existing_day=True)
    requests = []
    for actor, _, checkout, service, _ in (first, second):
        review = service.review_checkout(actor, checkout)
        assert review["eligible"]
        requests.append((service.submit_order, actor, _submit_body(checkout, review), _command()))
    with ThreadPoolExecutor(max_workers=2) as threads:
        attempts = [threads.submit(*request) for request in requests]
        failures = [attempt.exception() for attempt in attempts]
    assert failures.count(None) == 1
    assert next(error for error in failures if error is not None).code == "CAPACITY_UNAVAILABLE"
    with db.connection() as conn:
        for table in ("standard_order", "charge", "capacity_allocation", "command_receipt"):
            assert one(conn, f"SELECT count(*) FROM {table}")["count"] == 1
        assert one(conn, "SELECT count(*) FROM durable_work WHERE kind <> 'NOTICE'")["count"] == 1


def test_review_expires_at_exact_cutoff_and_abandon_persists_terminal_state(db, clock, checkout_fixture):
    actor, _, checkout, service, _ = checkout_fixture()
    review = service.review_checkout(actor, checkout)
    review_id = review["reviewId"]
    clock.advance(60_000)
    expired = {"state": "EXPIRED", "orderId": None, "updatedAt": review["expiresAt"]}
    assert service.get_checkout_outcome(actor, review_id) == expired
    with db.connection() as conn:
        assert one(conn, "SELECT status FROM checkout_review")["status"] == "OPEN"
    context = _command()
    assert service.abandon_or_resolve_checkout(actor, review_id, context) == expired
    assert service.abandon_or_resolve_checkout(actor, review_id, context) == expired
    _expect("REVIEW_STALE", service.submit_order, actor, _submit_body(checkout, review), _command())
    _expect("NOT_FOUND", service.get_own_command_outcome, actor, "abandonOrResolveCheckout", context.idempotency_key)
    with db.connection() as conn:
        assert one(conn, "SELECT status FROM checkout_review")["status"] == "EXPIRED"
        assert one(conn, "SELECT count(*) FROM standard_order")["count"] == 0


def test_checkout_resumes_typescript_reviews_and_command_receipts(db, checkout_fixture):
    variant_id = "a0000000-0000-0000-0000-000000000001"
    review_id = "b0000000-0000-0000-0000-000000000001"
    actor, _, checkout, service, _ = checkout_fixture(variant_id=variant_id)
    checkout.update(
        items=[{"variantId": variant_id.upper(), "quantity": 2.0}],
        requestedHandoffAt=f"{DAY}T12:30:00.12345600+08:00",
        fulfilment="CUSTOMER_LALAMOVE",
        contactName="雯 🍰",
        address={**ADDRESS, "line2": "Level 3"},
    )
    review = service.review_checkout(actor, checkout)
    assert review["requestedHandoffAt"] == f"{DAY}T04:30:00.123456Z"
    # These digests come from the original TypeScript parser and JSON.stringify.
    review_digest = bytes.fromhex("5b57e0ab642302d5d581d67a27b79ae4622ff38c4ca90a5e712a56a1e7acfe47")
    command_digest = bytes.fromhex("b6faa02b1225eefb4a8abc3446ce72d795c8df9b1a6c70ce2013fa9bc9b51d2b")
    with db.transaction() as conn:
        assert one(conn, "SELECT review_digest FROM checkout_review")["review_digest"] == review_digest
        conn.execute("UPDATE checkout_review SET id = %s, review_digest = %s", (review_id, review_digest))
    body = _submit_body(checkout, {**review, "reviewId": review_id.upper()})
    context = _command()
    order = service.submit_order(actor, body, context)
    with db.connection() as conn:
        assert one(conn, "SELECT request_digest FROM command_receipt")["request_digest"] == command_digest
    assert service.submit_order(actor, body, context) == order
