from base64 import b64decode
from uuid import uuid4

from sweetcommerce.db import one

from test_checkout import checkout_fixture

API = "/api/v1"
PNG = b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2uoAAAAASUVORK5CYII=")


def _write(headers, key=None, **extra):
    return {**headers, "Idempotency-Key": key or str(uuid4()), **extra}


def _order(checkout_fixture):
    actor, headers, checkout, service, _ = checkout_fixture()
    review = service.review_checkout(actor, checkout)
    from test_checkout import _command, _submit_body
    order = service.submit_order(actor, _submit_body(checkout, review), _command())
    return order, headers


def _proof(db, charge_id, now):
    with db.transaction() as conn:
        return str(one(conn, """
            INSERT INTO payment_proof (id,charge_id,object_key,content_digest,byte_count,media_type,state,
                review_disposition,received_at)
            VALUES (%s,%s,%s,%s,3,'image/png','REVIEW','TIMELY',%s) RETURNING id
        """, (uuid4(), charge_id, str(uuid4()), uuid4().bytes, now))["id"])


def test_verified_top_up_uses_original_deadline_and_accepts_once(db, client, sign_in, clock, checkout_fixture):
    order, customer = _order(checkout_fixture)
    _, admin = sign_in("ADMIN")
    charge_id = order["charge"]["id"]
    path = f"{API}/admin/charges/{charge_id}"
    clock.advance(minutes=1)
    initial = _proof(db, charge_id, clock())
    body = {"externalReference": "verified-initial", "amountMinor": 400, "receivedAt": clock().isoformat(),
            "proofId": initial, "expectedVersion": 1}
    partial = client.post(path + "/receipts", json=body, headers=_write(admin))
    assert partial.status_code == 200, partial.text
    assert partial.json()["state"] == "DISPUTED"

    request_path = f"{API}/admin/proofs/{initial}/reject"
    request = {"decision": "REQUEST_SUPPLEMENT", "reason": "Verified shortfall", "customerSafeReason": "500 sen remaining."}
    key = str(uuid4())
    first = client.post(request_path, json=request, headers=_write(admin, key))
    assert first.status_code == 200, first.text
    charge = client.get(path, headers=admin).json()
    cutoff = charge["charge"]["topUp"]["dueAt"]
    case_id = charge["cases"][0]["id"]
    assert charge["charge"]["topUp"]["outstandingMinor"] == 500
    clock.advance(minutes=29, seconds=59)
    assert client.post(request_path, json=request, headers=_write(admin, key)).json() == first.json()
    assert client.get(path, headers=admin).json()["charge"]["topUp"]["dueAt"] == cutoff
    timely = _proof(db, charge_id, clock())
    clock.advance(seconds=2)
    owned = client.get(f"{API}/orders/{order['id']}", headers=customer)
    assert owned.json()["charge"]["topUp"]["status"] == "UNDER_REVIEW"
    charge = client.get(path, headers=admin).json()["charge"]
    body = {"externalReference": "verified-top-up", "amountMinor": 500, "receivedAt": clock().isoformat(),
            "proofId": timely, "expectedVersion": charge["version"], "settlementCaseId": case_id, "postingMode": "SUPPLEMENT"}
    key = str(uuid4())
    exact = client.post(path + "/receipts", json=body, headers=_write(admin, key))
    assert exact.status_code == 200, exact.text
    assert exact.json()["state"] == "PAID" and exact.json()["topUp"] is None
    assert client.post(path + "/receipts", json=body, headers=_write(admin, key)).json() == exact.json()
    assert client.get(f"{API}/orders/{order['id']}", headers=customer).json()["status"] == "ACCEPTED"
    with db.connection() as conn:
        assert one(conn, "SELECT count(*) AS n FROM money_entry WHERE charge_id=%s", (charge_id,))["n"] == 2
        assert one(conn, "SELECT state FROM capacity_allocation WHERE order_id=%s", (order["id"],))["state"] == "COMMITTED"
        assert one(conn, "SELECT quantity FROM cart_line WHERE account_id=(SELECT account_id FROM standard_order WHERE id=%s)",
                   (order["id"],))["quantity"] == 1
        assert one(conn, "SELECT count(*) AS n FROM durable_work WHERE kind='NOTICE' AND payload->>'milestone'='STANDARD_TOP_UP'")["n"] == 1


def test_exact_cutoff_receipt_creates_case_and_never_reopens(db, client, sign_in, clock, checkout_fixture):
    order, customer = _order(checkout_fixture)
    _, admin = sign_in("ADMIN")
    charge_id = order["charge"]["id"]
    path = f"{API}/admin/charges/{charge_id}"
    clock.advance(minutes=30)
    body = {"externalReference": "late-transfer", "amountMinor": 900,
            "receivedAt": clock().isoformat(), "expectedVersion": 1}
    late = client.post(path + "/receipts", json=body, headers=_write(admin))
    assert late.status_code == 200, late.text
    assert late.json()["state"] == "EXPIRED" and late.json()["paidMinor"] == 900
    assert client.get(path, headers=admin).json()["cases"][0]["reason"] == "LATE_PROOF"
    assert client.get(f"{API}/orders/{order['id']}", headers=customer).json()["status"] == "EXPIRED"
    assert client.get(path, headers=customer).status_code == 403
    assert client.get(f"{API}/admin/work?kind=PAYMENT_EXCEPTION", headers=admin).json()["items"][0]["target"]["chargeId"] == charge_id
    with db.connection() as conn:
        assert one(conn, "SELECT state FROM capacity_allocation WHERE order_id=%s", (order["id"],))["state"] == "RELEASED"


def test_funds_verified_after_promised_handoff_require_disposition(db, client, sign_in, clock, checkout_fixture):
    order, customer = _order(checkout_fixture)
    _, admin = sign_in("ADMIN")
    charge_id = order["charge"]["id"]
    proof = _proof(db, charge_id, clock())
    clock.advance(hours=5)
    result = client.post(f"{API}/admin/charges/{charge_id}/receipts",
                         json={"externalReference": "late-review", "amountMinor": 900, "proofId": proof,
                               "receivedAt": clock().isoformat(), "expectedVersion": 1}, headers=_write(admin))
    assert result.status_code == 200, result.text
    assert result.json()["paidMinor"] == 900
    assert client.get(f"{API}/orders/{order['id']}", headers=customer).json()["status"] in ("EXCEPTION", "EXPIRED")
    cases = client.get(f"{API}/admin/charges/{charge_id}", headers=admin).json()["cases"]
    assert cases[0]["reason"] == "STANDARD_FULFILMENT_INFEASIBLE"
