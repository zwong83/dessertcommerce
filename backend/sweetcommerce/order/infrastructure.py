import hashlib
from datetime import datetime
from uuid import uuid4

from psycopg.types.json import Jsonb

from ..capacity.infrastructure import json_bytes
from ..db import iso, one, rows
from ..problems import Problem
from ..work.queue import milestone
from .domain import at_millisecond


def stale_review() -> Problem:
    return Problem("REVIEW_STALE", 409, "Review the current checkout before submitting.")


def missing() -> Problem:
    return Problem("NOT_FOUND", 404, "This resource was not found.")


def checkout_digest(checkout: dict) -> bytes:
    return hashlib.sha256(json_bytes(checkout)).digest()


def cart_selections(conn, actor_id: str, checkout: dict) -> tuple[list[dict], list[dict], int]:
    cart = one(conn, "SELECT version FROM cart WHERE account_id = %s", (actor_id,))
    if cart is None or cart["version"] != checkout["cartVersion"]:
        raise stale_review()

    selections = rows(
        conn,
        """SELECT l.id AS generation, l.quantity AS cart_quantity, v.id AS variant_id, p.id AS product_id,
                  p.status, v.available, v.prep_minutes, p.name AS product, v.name AS variant, v.flavour, v.unit_minor
             FROM cart_line l JOIN variant v ON v.id = l.variant_id JOIN product p ON p.id = v.product_id
            WHERE l.account_id = %s AND l.variant_id = ANY(%s::uuid[])""",
        (actor_id, [item["variantId"] for item in checkout["items"]]),
    )
    by_variant = {str(row["variant_id"]): row for row in selections}
    lines = []
    subtotal = 0
    for item in checkout["items"]:
        row = by_variant.get(item["variantId"])
        if row is None or item["quantity"] > row["cart_quantity"]:
            raise stale_review()
        subtotal += item["quantity"] * row["unit_minor"]
        lines.append({
            "productId": str(row["product_id"]),
            "generation": str(row["generation"]),
            "display": {
                **item,
                "product": row["product"],
                "variant": row["variant"],
                "flavour": row["flavour"],
                "unitMinor": row["unit_minor"],
            },
        })
    return selections, lines, subtotal


def insert_review(conn, review_id: str, actor_id: str, checkout: dict, terms_version: str,
                  snapshot: dict, expires_at: str, now: str) -> None:
    conn.execute(
        """INSERT INTO checkout_review
                  (id, account_id, cart_version, review_digest, terms_version, review_snapshot, expires_at, updated_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
        (review_id, actor_id, checkout["cartVersion"], checkout_digest(checkout), terms_version,
         Jsonb(snapshot), expires_at, now),
    )


def locked_review(conn, actor_id: str, review_id: str) -> dict:
    review = one(
        conn,
        """SELECT status, expires_at, updated_at, review_digest, terms_version, review_snapshot
             FROM checkout_review WHERE account_id = %s AND id = %s FOR UPDATE""",
        (actor_id, review_id),
    )
    if review is None:
        raise missing()
    return review


def review_for_outcome(conn, actor_id: str, review_id: str) -> dict:
    # Wait for any submit already holding the row before reporting a terminal expiry.
    review = one(
        conn,
        "SELECT status, expires_at, updated_at FROM checkout_review WHERE account_id = %s AND id = %s FOR SHARE",
        (actor_id, review_id),
    )
    if review is None:
        raise missing()
    return review


def submitted_order(conn, actor_id: str, review_id: str) -> dict:
    order = one(
        conn,
        "SELECT id, payment_method FROM standard_order WHERE account_id = %s AND checkout_review_id = %s",
        (actor_id, review_id),
    )
    if order is None:
        raise RuntimeError("Submitted checkout review has no order")
    return order


def lock_checkout_products(conn, checkout: dict) -> None:
    conn.execute(
        """SELECT p.id FROM product p WHERE p.id IN (SELECT product_id FROM variant WHERE id = ANY(%s::uuid[]))
            ORDER BY p.id FOR SHARE""",
        ([item["variantId"] for item in checkout["items"]],),
    )


def lock_cart(conn, actor_id: str) -> None:
    conn.execute("SELECT account_id FROM cart WHERE account_id = %s FOR SHARE", (actor_id,))


def insert_order(conn, order_id: str, actor_id: str, checkout: dict, submission: dict, snapshot: dict, *,
                 status: str, date: str, deadline: str | None, created_at: str) -> None:
    conn.execute(
        """INSERT INTO standard_order (id, order_number, account_id, checkout_review_id, status, fulfilment, payment_method,
                  service_date, requested_handoff_at, fulfilment_snapshot, subtotal_minor, fee_minor, terms_version,
                  proof_due_at, created_at, updated_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (order_id, "SC-" + order_id.upper(), actor_id, submission["reviewId"], status, checkout["fulfilment"],
         submission["paymentMethod"], date, checkout["requestedHandoffAt"], Jsonb(snapshot["fulfilment"]),
         snapshot["subtotalMinor"], snapshot["feeMinor"], submission["termsVersion"], deadline, created_at, created_at),
    )
    lines = [
        {
            "variant_id": line["display"]["variantId"],
            "product_id": line["productId"],
            "generation": line["generation"],
            "quantity": line["display"]["quantity"],
            "unit_minor": line["display"]["unitMinor"],
            "display": line["display"],
        }
        for line in snapshot["lines"]
    ]
    conn.execute(
        """INSERT INTO standard_order_line
                  (order_id, variant_id, product_id, cart_line_generation, quantity, unit_minor, display_snapshot)
           SELECT %s, x.variant_id, x.product_id, x.generation, x.quantity, x.unit_minor, x.display
             FROM jsonb_to_recordset(%s) AS x(variant_id uuid, product_id uuid, generation uuid,
                                              quantity integer, unit_minor bigint, display jsonb)""",
        (order_id, Jsonb(lines)),
    )


def insert_charge(conn, order_id: str, subtotal_minor: int, deadline: str, created_at: str) -> str:
    charge_id = str(uuid4())
    conn.execute(
        """INSERT INTO charge (id, order_id, category, state, expected_minor, due_at, created_at)
           VALUES (%s,%s,'STANDARD','OPEN',%s,%s,%s)""",
        (charge_id, order_id, subtotal_minor, deadline, created_at),
    )
    return charge_id


def schedule_expiry(conn, order_id: str, charge_id: str, deadline: str, created_at: str) -> None:
    conn.execute(
        """INSERT INTO durable_work (id, event_key, kind, resource_id, work_state, not_before, payload, created_at)
           VALUES (%s,%s,'STANDARD_PROOF_EXPIRY',%s,'READY',%s,%s,%s)""",
        (uuid4(), f"STANDARD_PROOF_EXPIRY:{order_id}:1", order_id, deadline,
         Jsonb({"deadline": deadline, "chargeId": charge_id}), created_at),
    )


def record_submission(conn, review_id: str, actor_id: str, order_id: str, status: str,
                      created_at: str, request_id: str) -> None:
    milestone(conn, order_id, "STANDARD_ORDER_SUBMITTED", 1, created_at)
    milestone(conn, order_id, "MERCHANT_ORDER_INTAKE", 1, created_at, recipient="MERCHANT")
    if status == "PENDING_PROOF":
        milestone(conn, order_id, "STANDARD_AWAITING_PAYMENT", 1, created_at)
    conn.execute(
        "UPDATE checkout_review SET status = 'SUBMITTED', consumed_at = %s, updated_at = %s WHERE id = %s",
        (created_at, created_at, review_id),
    )
    conn.execute(
        """INSERT INTO audit_event (id, actor_id, feature, resource_id, action, occurred_at, request_id, safe_change)
           VALUES (%s,%s,'ORDER',%s,'SUBMIT',%s,%s,%s)""",
        (uuid4(), actor_id, order_id, created_at, request_id, Jsonb({"status": status})),
    )


def resolve_review(conn, review_id: str, state: str, updated_at: str) -> None:
    conn.execute(
        "UPDATE checkout_review SET status = %s, updated_at = %s WHERE id = %s",
        (state, updated_at, review_id),
    )


def own_order(conn, actor_id: str, order_id: str, now: datetime, qr_url: str | None, whatsapp_url=None) -> dict:
    from ..fulfilment.projection import order_detail
    return order_detail(conn, order_id, now, qr_url, whatsapp_url, owner_id=actor_id)


def command_outcome(conn, actor_id: str, operation: str, key: str) -> dict:
    if operation in ("submitEventRequest", "acceptEventQuote", "cancelEventRequest"):
        from ..events.infrastructure import command_outcome as event_outcome
        return event_outcome(conn, actor_id, operation, key)
    receipt = one(conn, """
        SELECT result_reference, created_at FROM command_receipt
        WHERE actor_id = %s AND operation = %s AND idem_key = %s
    """, (actor_id, operation, key))
    if receipt is None:
        raise missing()
    result = receipt["result_reference"]
    if operation == "submitChargeProof":
        resource_type, resource_id = "PROOF", result.get("id")
    elif operation == "setCartQuantity":
        resource_type, resource_id = "CART", actor_id
    else:
        resource_type, resource_id = "ORDER", result.get("orderId")
    if resource_id is None:
        raise missing()
    return {"resourceType": resource_type, "resourceId": str(resource_id), "completedAt": iso(receipt["created_at"])}
