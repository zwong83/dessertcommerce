from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from uuid import uuid4

from psycopg.types.json import Jsonb

from sweetcommerce.cart import CartService
from sweetcommerce.db import one
from sweetcommerce.identity import Session

EMPTY_CART = {"version": 1, "lines": [], "referenceSubtotalMinor": 0}


def listed_variant(db):
    product, variant = uuid4(), uuid4()
    with db.transaction() as conn:
        conn.execute("INSERT INTO product (id,name,category,status) VALUES (%s,'Tart','Mini','LISTED')", (product,))
        conn.execute(
            """INSERT INTO variant (id,product_id,name,flavour,available,unit_minor,prep_minutes)
               VALUES (%s,%s,'Small','Chocolate',true,450,0)""",
            (variant, product),
        )
    return str(variant)


def test_cart_http_preserves_ownership_replay_and_line_generation(db, client, sign_in):
    variant = listed_variant(db)
    phone = "+60100001391"
    session, access = sign_in(phone=phone)
    account_id = session["accountId"]
    cart_path = "/api/v1/cart"
    item_path = f"{cart_path}/items/{variant}"

    assert client.get(cart_path, headers={"Cookie": ""}).status_code == 401
    assert client.get(cart_path, headers=access).json() == EMPTY_CART

    def headers_for(version):
        return {
            **access,
            "If-Match": f'"{version}"',
            "Idempotency-Key": str(uuid4()),
        }

    headers = headers_for(1)
    wrong_csrf = client.put(item_path, headers={**headers, "X-CSRF-Token": "wrong"}, json={"quantity": 2})
    assert (wrong_csrf.status_code, wrong_csrf.json()["code"]) == (403, "FORBIDDEN")
    wrong_origin = client.put(item_path, headers={**headers, "Origin": "https://other.example.test"}, json={"quantity": 2})
    assert (wrong_origin.status_code, wrong_origin.json()["code"]) == (403, "ORIGIN_DENIED")
    invalid_version = client.put(item_path, headers={**headers, "If-Match": "1"}, json={"quantity": 2})
    assert (invalid_version.status_code, invalid_version.json()["message"]) == (422, "Refresh the cart version.")
    invalid_quantity = client.put(item_path, headers=headers, json={"quantity": True})
    assert (invalid_quantity.status_code, invalid_quantity.json()["code"]) == (422, "VALIDATION")

    with ThreadPoolExecutor(max_workers=2) as workers:
        competing_headers = headers_for(1)
        attempts = [
            (candidate, workers.submit(client.put, item_path, headers=candidate, json={"quantity": 2}))
            for candidate in (headers, competing_headers)
        ]
        results = sorted(
            ((candidate, attempt.result()) for candidate, attempt in attempts),
            key=lambda result: result[1].status_code,
        )
    (winning_headers, success), (_, stale) = results
    assert (success.status_code, stale.status_code, stale.json()["code"]) == (200, 409, "VERSION_CONFLICT")
    expected = {
        "version": 2,
        "lines": [{"variantId": variant, "quantity": 2, "product": "Tart", "variant": "Small", "unitMinor": 450, "available": True}],
        "referenceSubtotalMinor": 900,
    }
    assert success.json() == expected

    replay = client.put(
        f"{cart_path}/items/{variant.upper()}",
        headers={**winning_headers, "Idempotency-Key": winning_headers["Idempotency-Key"].upper()},
        json={"quantity": 2.0},
    )
    assert replay.status_code == 200 and replay.json() == expected
    conflict = client.put(item_path, headers=winning_headers, json={"quantity": 3})
    assert (conflict.status_code, conflict.json()["code"]) == (409, "IDEMPOTENCY_CONFLICT")
    stale = client.put(item_path, headers=headers_for(1), json={"quantity": 3})
    assert (stale.status_code, stale.json()["code"]) == (409, "VERSION_CONFLICT")

    second, other_device = sign_in(phone=phone)
    assert second["accountId"] == account_id
    assert client.get(cart_path, headers=other_device).json() == expected
    _, foreign = sign_in(phone="+60100001392")
    assert client.get(cart_path, headers=foreign).json() == EMPTY_CART

    with db.connection() as conn:
        original = one(conn, "SELECT id FROM cart_line WHERE account_id = %s", (account_id,))["id"]
    assert client.put(item_path, headers=headers_for(2), json={"quantity": -1}).status_code == 422
    removed = client.put(item_path, headers=headers_for(2), json={"quantity": 0})
    assert removed.json() == {**EMPTY_CART, "version": 3}
    replacement = client.put(item_path, headers=headers_for(3), json={"quantity": 1})
    assert replacement.status_code == 200 and replacement.json()["version"] == 4
    with db.transaction() as conn:
        assert one(conn, "SELECT id FROM cart_line WHERE account_id = %s", (account_id,))["id"] != original
        conn.execute("UPDATE variant SET available = false WHERE id = %s", (variant,))

    unavailable = client.put(item_path, headers=headers_for(4), json={"quantity": 2})
    assert (unavailable.status_code, unavailable.json()["message"]) == (422, "This selection is no longer available.")
    current = client.get(cart_path, headers=access).json()
    assert current["version"] == 4 and current["lines"][0]["available"] is False
    assert client.put(item_path, headers=winning_headers, json={"quantity": 2}).json() == expected
    with db.connection() as conn:
        assert one(
            conn,
            """SELECT count(*) AS count FROM capacity_allocation a
               JOIN standard_order o ON o.id = a.order_id WHERE o.account_id = %s""",
            (account_id,),
        )["count"] == 0


def test_cart_replays_a_typescript_receipt_before_version_and_availability_checks(db):
    account_id, key = uuid4(), uuid4()
    variant_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    # SHA-256 of JSON.stringify([variant_id, 2, "1"]) in the TypeScript service.
    digest = bytes.fromhex("81f79efa515335c130fa87ed30ef46c1965466396c363ac9c20e81560e452052")
    snapshot = {
        "version": 2,
        "lines": [{"variantId": variant_id, "quantity": 2, "product": "Tart", "variant": "Small", "unitMinor": 450, "available": True}],
        "referenceSubtotalMinor": 900,
    }
    with db.transaction() as conn:
        conn.execute("INSERT INTO account (id,role,phone_e164) VALUES (%s,'CUSTOMER','+60100001393')", (account_id,))
        conn.execute("INSERT INTO cart (account_id,version) VALUES (%s,8)", (account_id,))
        conn.execute(
            """INSERT INTO command_receipt (actor_id,operation,idem_key,request_digest,result_reference,created_at)
               VALUES (%s,'setCartQuantity',%s,%s,%s,clock_timestamp())""",
            (account_id, key, digest, Jsonb(snapshot)),
        )
    service = CartService(db)
    principal = Session(str(account_id), "CUSTOMER", "", datetime(2030, 1, 1, tzinfo=UTC))
    assert service.set_quantity(
        principal, variant_id=variant_id.upper(), quantity=2.0, expected_version="1", idempotency_key=str(key)
    ) == snapshot
    assert service.get(principal) == {**EMPTY_CART, "version": 8}
