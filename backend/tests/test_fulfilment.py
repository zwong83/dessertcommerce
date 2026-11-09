from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from io import BytesIO
from threading import Barrier
from uuid import uuid4

import pytest
from PIL import Image

from sweetcommerce.db import one, rows
from sweetcommerce.fulfilment.application import FulfilmentService
from sweetcommerce.fulfilment.infrastructure import accept_order, locked_order
from sweetcommerce.identity.domain import Session
from sweetcommerce.problems import Problem
from sweetcommerce.proofs.application import ProofService

from conftest import MemoryObjects
from test_api_contract import _assert_json_contract
from test_checkout import ADDRESS, API, _command, _expect, _submit_body, checkout_fixture

WHATSAPP = "https://wa.me/60100000001"


def _proof_image() -> bytes:
    with BytesIO() as output:
        Image.new("RGB", (8, 8), "blue").save(output, format="PNG")
        return output.getvalue()


@pytest.fixture
def shop(db, clock, sign_in, checkout_fixture):
    customer, customer_headers, checkout, orders, config = checkout_fixture()
    signed_admin, admin_headers = sign_in("ADMIN")
    admin = Session(
        account_id=signed_admin["accountId"], role="ADMIN", csrf_token=signed_admin["csrfToken"],
        expires_at=datetime.fromisoformat(signed_admin["expiresAt"]),
    )
    service = FulfilmentService(db, "/fixture-qr", WHATSAPP, clock=clock, terms=lambda: config["terms"])

    def submit(mode="PICKUP", method="DUITNOW"):
        details = {**checkout, "fulfilment": mode}
        if mode != "PICKUP":
            details["address"] = ADDRESS
        review = orders.review_checkout(customer, details)
        return orders.submit_order(customer, _submit_body(details, review, paymentMethod=method), _command())

    def action(order, action, context=None, **fields):
        return service.change_standard_order(
            admin, order["id"], order["version"], {"action": action, **fields}, context or _command(),
        )

    def verified(order):
        with db.transaction() as conn:
            record = locked_order(conn, order["id"], None)
            charge = one(conn, "SELECT id, expected_minor FROM charge WHERE order_id = %s FOR UPDATE", (record["id"],))
            conn.execute(
                """INSERT INTO money_entry (id, charge_id, kind, rail, external_reference, amount_minor, occurred_at, actor_id)
                   VALUES (%s,%s,'RECEIPT','DUITNOW',%s,%s,%s,%s)""",
                (uuid4(), charge["id"], str(uuid4()), charge["expected_minor"], clock(), admin.account_id),
            )
            conn.execute("UPDATE charge SET state = 'PAID', version = version + 1 WHERE id = %s", (charge["id"],))
            accepted = accept_order(conn, record, actor_id=admin.account_id, now=clock())
            assert accept_order(conn, accepted, actor_id=admin.account_id, now=clock()) == accepted
        return service.get_own_order(customer, order["id"])

    return service, customer, admin, customer_headers, admin_headers, submit, action, verified, config


def test_fee_counteroffers_consent_and_capacity_recheck(db, shop, clock):
    service, customer, admin, _, _, submit, _, _, config = shop
    order = submit("MERCHANT_LALAMOVE")
    order_id = order["id"]
    next_day = "2030-01-02"
    counteroffer = "2030-01-02T13:00:00+08:00"
    with db.transaction() as conn:
        conn.execute("INSERT INTO capacity_day (service_date, closed, max_units) VALUES (%s,false,2)", (next_day,))

    def quote(version, **body):
        return service.quote_delivery_fee(admin, order_id, version, body, _command())

    def confirm(version, revision, terms, context=None):
        return service.confirm_delivery_fee(
            customer, order_id, version, {"feeVersion": revision, "termsVersion": terms}, context or _command(),
        )

    declined = quote(order["version"], serviceable=False, reason="Private unserviceable note")
    assert declined["feeOffer"]["serviceable"] is False
    assert declined["charge"] is None and declined["proofDueAt"] is None
    assert "Private" not in str(declined)
    _expect("INVALID_TRANSITION", confirm, declined["version"], 1, order["termsVersion"])

    offered = quote(declined["version"], serviceable=True, feeMinor=900, handoffAt=counteroffer, reason="Different slot")
    assert offered["feeOffer"]["offeredHandoffAt"] == "2030-01-02T05:00:00.000Z"
    assert offered["feeOffer"]["totalMinor"] == 1800
    assert offered["feeMinor"] is None and offered["promisedHandoffAt"] is None
    with db.transaction() as conn:
        assert one(conn, "SELECT count(*) FROM capacity_allocation")["count"] == 0
        conn.execute("UPDATE capacity_day SET closed=true WHERE service_date=%s", (next_day,))
    _expect("FEE_CHANGED", confirm, offered["version"], 1, order["termsVersion"])
    _expect("CAPACITY_UNAVAILABLE", confirm, offered["version"], 2, order["termsVersion"])
    config["terms"] = {"version": "fixture-v2", "text": "Updated terms."}
    _expect("TERMS_CHANGED", confirm, offered["version"], 2, order["termsVersion"])
    with db.transaction() as conn:
        assert one(conn, "SELECT count(*) FROM charge")["count"] == 0
        assert one(conn, "SELECT count(*) FROM durable_work WHERE kind = 'STANDARD_PROOF_EXPIRY'")["count"] == 0
        conn.execute("UPDATE capacity_day SET closed=false WHERE service_date=%s", (next_day,))

    fresh = quote(offered["version"], serviceable=True, feeMinor=800, handoffAt=counteroffer, reason="Current offer")
    clock.advance(minutes=5)
    key = _command()
    accepted_fee = confirm(fresh["version"], 3, "fixture-v2", key)
    assert confirm(fresh["version"], 3, "fixture-v2", key) == accepted_fee
    _expect("IDEMPOTENCY_CONFLICT", confirm, fresh["version"], 2, "fixture-v2", key)
    assert accepted_fee["status"] == "PENDING_PROOF"
    assert accepted_fee["proofDueAt"] == "2030-01-01T00:35:00.000Z"
    assert accepted_fee["charge"]["expectedMinor"] == accepted_fee["totalMinor"] == 1700
    assert accepted_fee["termsText"] == "Updated terms."
    with db.connection() as conn:
        assert rows(conn, "SELECT service_date::text AS day, state, quantity FROM capacity_allocation") == [
            {"day": next_day, "state": "HELD", "quantity": 2},
        ]
        assert one(conn, "SELECT count(*) FROM delivery_fee_offer")["count"] == 3
        assert one(conn, "SELECT count(*) FROM durable_work WHERE kind = 'STANDARD_PROOF_EXPIRY'")["count"] == 1
        notices = rows(
            conn,
            """SELECT event_key, payload FROM durable_work
                WHERE resource_id = %s AND kind = 'NOTICE' AND payload ? 'orderVersion'
                ORDER BY (payload->>'orderVersion')::integer""",
            (order_id,),
        )
        expected = [
            ("STANDARD_FEE_OFFERED", offered),
            ("STANDARD_FEE_OFFERED", fresh),
            ("STANDARD_AWAITING_PAYMENT", accepted_fee),
        ]
        assert notices == [
            {
                "event_key": f"{name}:{order_id}:{updated['version']}:CUSTOMER",
                "payload": {"milestone": name, "recipientRole": "CUSTOMER", "status": updated["status"],
                            "orderVersion": updated["version"]},
            }
            for name, updated in expected
        ]


def test_cash_acceptance_generation_handoff_and_no_show_race(db, shop, clock):
    service, customer, _, _, _, submit, action, _, _ = shop
    cash = submit(method="CASH")
    account = customer.account_id
    replacement = uuid4()
    with db.transaction() as conn:
        assert one(conn, "SELECT allocated_units FROM capacity_day")["allocated_units"] == 0
        conn.execute("UPDATE cart_line SET id = %s WHERE account_id = %s", (replacement, account))

    key = _command()
    accepted = action(cash, "ACCEPT_CASH", key)
    assert action(cash, "ACCEPT_CASH", key) == accepted
    assert accepted["charge"]["state"] == "OPEN"
    assert accepted["promisedHandoffAt"] == accepted["requestedHandoffAt"]
    _expect("INVALID_TRANSITION", action, accepted, "HANDOFF")
    _expect("INVALID_TRANSITION", lambda: action(accepted, "MARK_NO_SHOW", reason="Uncollected"))
    ready = action(action(accepted, "START_PREPARATION"), "MARK_READY")
    clock.advance(hours=5)
    barrier = Barrier(2)
    handoff_key = _command()
    no_show_key = _command()

    def compete(name, context, fields):
        barrier.wait(timeout=5)
        try:
            return action(ready, name, context, **fields)
        except Problem as exc:
            return exc.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        pickup = pool.submit(compete, "HANDOFF", handoff_key, {})
        no_show = pool.submit(compete, "MARK_NO_SHOW", no_show_key, {"reason": "Uncollected"})
        results = [pickup.result(), no_show.result()]
    assert results.count("VERSION_CONFLICT") == 1
    final = next(result for result in results if isinstance(result, dict))
    assert final["status"] in ("COMPLETED", "NO_SHOW")
    if final["status"] == "COMPLETED":
        assert action(ready, "HANDOFF", handoff_key) == final
        assert final["charge"]["paidMinor"] == 900
        assert final["handoffAt"] is not None
    else:
        assert action(ready, "MARK_NO_SHOW", no_show_key, reason="Uncollected") == final
        assert final["handoffAt"] is None
        assert final["charge"]["state"] == "CANCELLED"
    with db.connection() as conn:
        assert one(conn, "SELECT count(*) FROM money_entry")["count"] == int(final["status"] == "COMPLETED")
        assert one(conn, "SELECT state FROM capacity_allocation")["state"] == "USED"
        assert one(conn, "SELECT id, quantity FROM cart_line") == {"id": replacement, "quantity": 3}
        assert one(conn, "SELECT version FROM cart")["version"] == 2


def test_incidents_recovery_and_adjustments_preserve_original_facts(db, shop, clock):
    service, customer, admin, _, _, submit, action, verified, _ = shop
    accepted = verified(submit("CUSTOMER_LALAMOVE"))
    assert accepted["feeMinor"] == 0
    with db.connection() as conn:
        assert one(conn, "SELECT quantity FROM cart_line")["quantity"] == 1
        assert one(conn, "SELECT version FROM cart")["version"] == 3
        assert one(conn, "SELECT state FROM capacity_allocation")["state"] == "COMMITTED"
    clock.advance(minutes=1)
    arrival = action(accepted, "RECORD_DRIVER_ARRIVAL", driverArrivedAt=clock().isoformat())
    assert arrival["driverArrivedAt"] is not None
    assert arrival["handoffAt"] is None
    ready = action(action(arrival, "START_PREPARATION"), "MARK_READY")
    incident = action(ready, "RECORD_INCIDENT", reason="Private pre-handoff notes")
    assert incident["readyAt"] == ready["readyAt"] and incident["handoffAt"] is None
    assert "Private" not in str(incident)
    handed_off = action(incident, "HANDOFF")
    assert handed_off["status"] == "HANDED_OFF"
    clock.advance(minutes=1)
    failed_delivery = action(handed_off, "RECORD_INCIDENT", reason="Private post-handoff notes")
    assert failed_delivery["handoffAt"] == handed_off["handoffAt"]
    order_id = accepted["id"]

    consent = {"agreedAt": clock().isoformat(), "channel": "WHATSAPP", "reference": "fixture-agreement-21"}
    recovery = {
        "recoveryKind": "REDELIVERY", "requiresNewProduction": True, "reason": "Consented remake",
        "consent": consent, "proposedHandoffAt": "2030-01-01T14:00:00+08:00",
    }
    with db.transaction() as conn:
        conn.execute("UPDATE capacity_day SET max_units=2")
    _expect(
        "CAPACITY_UNAVAILABLE", service.reschedule_standard_order, admin, order_id, failed_delivery["version"],
        recovery, _command(),
    )
    assert service.get_own_order(customer, order_id) == failed_delivery
    with db.transaction() as conn:
        assert one(conn, "SELECT count(*) FROM order_recovery_agreement")["count"] == 0
        conn.execute("UPDATE capacity_day SET max_units=4")

    revised = service.reschedule_standard_order(admin, order_id, failed_delivery["version"], recovery, _command())
    assert revised["status"] == "ACCEPTED"
    assert revised["promisedHandoffAt"] == "2030-01-01T06:00:00.000Z"
    assert revised["handoffAt"] == handed_off["handoffAt"]
    assert revised["readyAt"] == ready["readyAt"]
    assert revised["driverArrivedAt"] == arrival["driverArrivedAt"]
    charge = {"amountMinor": 300, "reason": "Extra delivery", "consent": consent}
    _expect(
        "VALIDATION", service.create_delivery_adjustment, admin, order_id, revised["version"],
        {**charge, "consent": {**consent, "agreedAt": "2030-01-02T00:00:00Z"}}, _command(),
    )
    key = _command()
    adjustment = service.create_delivery_adjustment(admin, order_id, revised["version"], charge, key)
    assert service.create_delivery_adjustment(admin, order_id, revised["version"], charge, key) == adjustment
    assert adjustment["expectedMinor"] == 300 and adjustment["category"] == "STANDARD_ADJUSTMENT"
    latest = service.get_own_order(customer, order_id)
    assert latest["totalMinor"] == 900
    assert latest["adjustments"] == [adjustment]
    merchant = service.get_merchant_order(admin, order_id)
    assert "phone" not in merchant and merchant["contactPhone"] == latest["phone"]
    assert any(event["safeReason"] == "Private post-handoff notes" for event in merchant["recentHistory"])
    with db.connection() as conn:
        assert rows(conn, "SELECT state, generation FROM capacity_allocation ORDER BY generation") == [
            {"state": "USED", "generation": 1}, {"state": "COMMITTED", "generation": 2},
        ]
        assert one(conn, "SELECT allocated_units FROM capacity_day")["allocated_units"] == 4
        assert one(conn, """SELECT a.extra_minor, a.consent_reference
                                FROM charge c JOIN order_recovery_agreement a ON a.id=c.recovery_agreement_id
                               WHERE c.category='STANDARD_ADJUSTMENT'""") == {
            "extra_minor": 300, "consent_reference": consent["reference"],
        }


def test_cancellation_blocks_recorded_evidence_and_obligates_refund(db, shop, clock):
    service, customer, admin, _, _, submit, action, verified, _ = shop
    first = submit()
    cancel = service.cancel_own_order
    with pytest.raises(Problem, match=WHATSAPP) as denied:
        cancel(customer, first["id"], first["version"], {"noTransferSent": False}, _command())
    assert denied.value.code == "INVALID_TRANSITION"

    with db.transaction() as conn:
        locked_order(conn, first["id"], None)
        conn.execute(
            """INSERT INTO payment_proof
                      (id, charge_id, object_key, content_digest, byte_count, media_type, state, review_disposition, received_at)
               VALUES (%s,%s,%s,%s,20,'image/png','REJECTED','TIMELY',%s)""",
            (uuid4(), first["charge"]["id"], "fixture-proof", b"fixture", clock()),
        )
    _expect("INVALID_TRANSITION", cancel, customer, first["id"], first["version"], {"noTransferSent": True}, _command())
    assert service.get_own_order(customer, first["id"])["status"] == "PENDING_PROOF"

    second = submit()
    key = _command()
    args = (customer, second["id"], second["version"], {"noTransferSent": True}, key)
    cancelled = cancel(*args)
    assert cancel(*args) == cancelled
    assert cancelled["status"] == "CANCELLED" and cancelled["charge"]["state"] == "CANCELLED"

    paid = action(verified(submit()), "START_PREPARATION")
    key = _command()
    disposition = {"cancellationBasis": "MERCHANT_UNABLE", "reason": "Production unavailable"}
    closed = action(paid, "CANCEL", key, **disposition)
    assert action(paid, "CANCEL", key, **disposition) == closed
    assert closed["status"] == "CANCELLED" and closed["charge"]["requiredRefundMinor"] == 900
    with db.connection() as conn:
        assert one(conn, "SELECT count(*) FROM money_entry WHERE kind='REFUND'")["count"] == 0
        assert one(conn, "SELECT count(*) FROM full_refund_obligation")["count"] == 1
        assert rows(conn, "SELECT state FROM capacity_allocation ORDER BY state") == [
            {"state": "HELD"}, {"state": "RELEASED"}, {"state": "USED"},
        ]


def test_http_scoped_pagination_and_versioned_commands(client, sign_in, shop, clock):
    _, _, _, customer_headers, admin_headers, submit, _, verified, _ = shop
    first = submit(method="CASH")
    second = submit("MERCHANT_LALAMOVE")
    _, foreign = sign_in()
    orders = f"{API}/orders"
    assert client.get(orders, headers=foreign).json() == {"items": [], "nextCursor": None}
    assert client.get(orders, headers=admin_headers).status_code == 403
    page_response = client.get(orders, params={"limit": 1}, headers=customer_headers)
    _assert_json_contract(page_response, "listOwnOrders")
    page = page_response.json()
    follow = client.get(orders, params={"limit": 1, "cursor": page["nextCursor"]}, headers=customer_headers).json()
    assert {page["items"][0]["id"], follow["items"][0]["id"]} == {first["id"], second["id"]}
    assert follow["nextCursor"] is None
    assert client.get(orders, params={"cursor": page["nextCursor"]}, headers=foreign).status_code == 400
    assert client.get(orders, params={"cursor": "bad"}, headers=customer_headers).status_code == 400

    merchant = f"{API}/admin/orders/{first['id']}"
    assert client.get(merchant, headers=customer_headers).status_code == 403
    detail = client.get(merchant, headers=admin_headers)
    assert detail.status_code == 200, detail.text
    _assert_json_contract(detail, "getMerchantOrder")
    assert detail.json()["contactPhone"] == first["phone"]
    cancellation_order = submit(method="CASH")
    headers = {**admin_headers, "Idempotency-Key": str(uuid4()), "If-Match": f'"{first["version"]}"'}
    body = {"action": "ACCEPT_CASH"}
    assert client.post(merchant + "/actions", json=body, headers={**headers, "Origin": "https://other.test"}).status_code == 403
    assert client.post(merchant + "/actions", json=body, headers={**headers, "X-CSRF-Token": "bad"}).status_code == 403
    response = client.post(merchant + "/actions", json=body, headers=headers)
    assert response.status_code == 200, response.text
    _assert_json_contract(response, "changeStandardOrder")
    assert response.json()["status"] == "ACCEPTED"
    assert client.post(merchant + "/actions", json=body, headers=headers).json() == response.json()
    stale = client.post(merchant + "/actions", json=body, headers={**headers, "Idempotency-Key": str(uuid4())})
    assert stale.json()["code"] == "VERSION_CONFLICT"

    blocked = client.post(
        f"{orders}/{second['id']}/cancel", json={"noTransferSent": True},
        headers={**foreign, "Idempotency-Key": str(uuid4()), "If-Match": f'"{second["version"]}"'},
    )
    assert blocked.status_code == 404

    def post(path, operation, order, headers, body):
        result = client.post(
            path, json=body,
            headers={**headers, "Idempotency-Key": str(uuid4()), "If-Match": f'"{order["version"]}"'},
        )
        assert result.status_code == 200, result.text
        _assert_json_contract(result, operation)
        return result.json()

    cancelled = post(
        f"{orders}/{cancellation_order['id']}/cancel", "cancelOwnOrder", cancellation_order,
        customer_headers, {"noTransferSent": True},
    )
    assert cancelled["status"] == "CANCELLED"
    delivery = f"{API}/admin/orders/{second['id']}"
    offered = post(
        delivery + "/fee", "quoteDeliveryFee", second, admin_headers,
        {"serviceable": True, "handoffAt": second["requestedHandoffAt"], "feeMinor": 200, "reason": "Fixture offer"},
    )
    confirmed = post(
        f"{orders}/{second['id']}/confirm-fee", "confirmDeliveryFee", offered, customer_headers,
        {"feeVersion": offered["feeVersion"], "termsVersion": offered["feeOffer"]["termsVersion"]},
    )
    accepted = verified(confirmed)
    agreement = {"agreedAt": clock().isoformat(), "channel": "PHONE", "reference": "fixture call"}
    revised = post(
        delivery + "/reschedule", "rescheduleStandardOrder", accepted, admin_headers,
        {"proposedHandoffAt": "2030-01-01T06:00:00Z", "requiresNewProduction": False,
         "reason": "Consented later handoff", "consent": agreement, "recoveryKind": "RESCHEDULE"},
    )
    adjustment = post(
        delivery + "/delivery-adjustments", "createDeliveryAdjustment", revised, admin_headers,
        {"amountMinor": 150, "reason": "Consented extra", "consent": agreement},
    )
    current = client.get(f"{orders}/{second['id']}", headers=customer_headers).json()
    assert current["totalMinor"] == confirmed["totalMinor"]
    assert current["adjustments"][0]["id"] == adjustment["id"]
    assert "UPLOAD_PROOF" in current["adjustments"][0]["allowedActions"]
    proof_response = client.post(
        f"{API}/charges/{adjustment['id']}/proof", content=_proof_image(),
        headers={**customer_headers, "Idempotency-Key": str(uuid4()), "Content-Type": "application/octet-stream",
                 "X-File-Media-Type": "image/png"},
    )
    assert proof_response.status_code == 201, proof_response.text
    _assert_json_contract(proof_response, "submitChargeProof")
    assert proof_response.json()["reviewDisposition"] == "TIMELY"
    projected = client.get(f"{orders}/{second['id']}", headers=customer_headers).json()
    assert projected["status"] == revised["status"]
    assert projected["charge"]["state"] == "PAID"
    assert projected["adjustments"][0]["state"] == "PROOF_REVIEW"


def test_cash_pickup_posts_receipt_once_and_no_show_posts_none(db, shop, clock):
    service, customer, _, _, _, submit, action, _, _ = shop
    pickup_order = submit(method="CASH")
    no_show_order = submit(method="CASH")
    pickup = action(pickup_order, "ACCEPT_CASH")
    no_show = action(no_show_order, "ACCEPT_CASH")
    ready = action(action(pickup, "START_PREPARATION"), "MARK_READY")
    key = _command()
    collected = action(ready, "HANDOFF", key)
    assert collected == action(ready, "HANDOFF", key)
    assert collected["status"] == "COMPLETED" and collected["handoffAt"] is not None
    assert collected["charge"]["state"] == "PAID" and collected["charge"]["paidMinor"] == 900

    clock.advance(hours=5)
    missed = action(no_show, "MARK_NO_SHOW", reason="Pickup uncollected")
    assert missed["status"] == "NO_SHOW" and missed["handoffAt"] is None
    assert missed["charge"]["paidMinor"] == 0
    with db.connection() as conn:
        assert rows(conn, "SELECT rail, amount_minor FROM money_entry") == [{"rail": "CASH", "amount_minor": 900}]
        assert one(conn, "SELECT allocated_units FROM capacity_day")["allocated_units"] == 2
        notices = rows(
            conn,
            """SELECT payload->>'milestone' AS name FROM durable_work
                WHERE resource_id = %s AND kind = 'NOTICE' AND payload ? 'orderVersion'
                ORDER BY (payload->>'orderVersion')::integer""",
            (pickup["id"],),
        )
        assert [notice["name"] for notice in notices] == [
            "STANDARD_CASH_ACCEPTED", "STANDARD_PREPARING", "STANDARD_READY", "STANDARD_COMPLETED",
        ]
    assert service.get_own_order(customer, pickup["id"]) == collected


def test_payment_proof_and_customer_cancellation_share_parent_lock(db, shop, clock):
    service, customer, _, _, _, submit, _, _, _ = shop
    order = submit()
    proof_service = ProofService(db, MemoryObjects(), clock=clock)
    image = _proof_image()
    ready = Barrier(2)

    def submit_proof():
        ready.wait(timeout=5)
        return proof_service.submit_charge_proof(customer, order["charge"]["id"], image, "image/png", _command())

    def cancel():
        ready.wait(timeout=5)
        try:
            return service.cancel_own_order(customer, order["id"], order["version"], {"noTransferSent": True}, _command())
        except Problem as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        proof_request, cancel_request = pool.submit(submit_proof), pool.submit(cancel)
        proof, cancellation = proof_request.result(), cancel_request.result()

    current = service.get_own_order(customer, order["id"])
    if current["status"] == "CANCELLED":
        assert cancellation["status"] == "CANCELLED"
        assert proof["reviewDisposition"] == "RECONCILIATION_ONLY"
        with db.connection() as conn:
            assert one(conn, "SELECT state FROM capacity_allocation")["state"] == "RELEASED"
            assert one(conn, "SELECT kind FROM settlement_case")["kind"] == "LATE_PROOF"
    else:
        assert current["status"] == "PAYMENT_REVIEW" and cancellation == "VERSION_CONFLICT"
        assert proof["reviewDisposition"] == "TIMELY"
        with db.connection() as conn:
            assert one(conn, "SELECT state FROM capacity_allocation")["state"] == "HELD"
        _expect(
            "INVALID_TRANSITION", service.cancel_own_order, customer, order["id"], current["version"],
            {"noTransferSent": True}, _command(),
        )


def test_exact_verified_but_infeasible_order_can_be_rescheduled_after_refund_resolution(db, shop, clock):
    service, customer, admin, _, _, submit, _, _, _ = shop
    pending = submit()
    receipt, refund = uuid4(), uuid4()
    charge = pending["charge"]["id"]
    with db.transaction() as conn:
        conn.execute(
            """INSERT INTO money_entry
                      (id, charge_id, kind, rail, external_reference, amount_minor, occurred_at, actor_id)
               VALUES (%s,%s,'RECEIPT','DUITNOW',%s,900,%s,%s)""",
            (receipt, charge, str(receipt), clock(), admin.account_id),
        )
        conn.execute("UPDATE charge SET state='DISPUTED' WHERE id=%s", (charge,))
        conn.execute("UPDATE standard_order SET status='EXCEPTION' WHERE id=%s", (pending["id"],))
        for kind in ("STANDARD_FULFILMENT_INFEASIBLE", "AMOUNT_MISMATCH"):
            conn.execute(
                """INSERT INTO settlement_case (id, charge_id, kind, status, opened_at)
                   VALUES (%s,%s,%s,'OPEN',%s)""",
                (uuid4(), charge, kind, clock()),
            )
        conn.execute(
            """INSERT INTO refund_intent (id, receipt_id, amount_minor, status, requested_by, reason, created_at, updated_at)
               VALUES (%s,%s,900,'UNCERTAIN',%s,'Fixture payout',%s,%s)""",
            (refund, receipt, admin.account_id, clock(), clock()),
        )
    body = {
        "proposedHandoffAt": "2030-01-01T06:00:00Z", "requiresNewProduction": True, "reason": "Agreed recovery",
        "consent": {"agreedAt": clock().isoformat(), "channel": "PHONE", "reference": "fixture call"},
        "recoveryKind": "RESCHEDULE",
    }
    args = (admin, pending["id"], pending["version"], body, _command())
    _expect("INVALID_TRANSITION", service.reschedule_standard_order, *args)
    with db.transaction() as conn:
        assert one(conn, "SELECT count(*) FROM order_recovery_agreement")["count"] == 0
        conn.execute("UPDATE refund_intent SET status='VOIDED' WHERE id=%s", (refund,))
    accepted = service.reschedule_standard_order(*args)
    assert accepted["status"] == "ACCEPTED" and accepted["charge"]["state"] == "PAID"
    assert accepted["charge"]["paidMinor"] == pending["totalMinor"]
    assert service.get_own_order(customer, pending["id"]) == accepted
    with db.connection() as conn:
        assert rows(conn, "SELECT state, generation FROM capacity_allocation ORDER BY generation") == [
            {"state": "RELEASED", "generation": 1}, {"state": "COMMITTED", "generation": 2},
        ]
        assert one(conn, "SELECT count(*) FROM settlement_case WHERE status='RESOLVED'")["count"] == 2


@pytest.mark.parametrize(
    ("method", "name"), [("CASH", "STANDARD_CASH_REJECTED"), ("DUITNOW", "STANDARD_REJECTED")],
)
def test_merchant_rejection_records_one_lifecycle_notice(db, shop, method, name):
    _, _, _, _, _, submit, action, _, _ = shop
    order = submit(method=method)
    key = _command()
    rejected = action(order, "REJECT", key, reason="Private capacity note")
    assert action(order, "REJECT", key, reason="Private capacity note") == rejected
    assert rejected["status"] == "REJECTED"
    with db.connection() as conn:
        assert rows(
            conn,
            """SELECT event_key, payload FROM durable_work
                WHERE resource_id = %s AND kind = 'NOTICE' AND payload->>'milestone' = %s""",
            (order["id"], name),
        ) == [{
            "event_key": f"{name}:{order['id']}:{rejected['version']}:CUSTOMER",
            "payload": {"milestone": name, "recipientRole": "CUSTOMER", "status": "REJECTED",
                        "orderVersion": rejected["version"]},
        }]
        assert one(conn, "SELECT allocated_units FROM capacity_day")["allocated_units"] == 0
