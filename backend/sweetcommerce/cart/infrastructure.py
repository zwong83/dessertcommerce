from hashlib import sha256
from json import dumps
from uuid import uuid4

from psycopg.types.json import Jsonb

from ..db import one, rows
from .domain import Cart, CartLine


def request_digest(variant_id: str, quantity: int, expected_version: str) -> bytes:
    return sha256(dumps([variant_id, quantity, expected_version], separators=(",", ":")).encode()).digest()


def owned_cart(conn, account_id) -> Cart:
    cart_rows = rows(
        conn,
        """SELECT c.version, l.variant_id, l.quantity, p.name AS product, v.name AS variant, v.unit_minor,
                  (v.available AND p.status = 'LISTED') AS available
           FROM cart c LEFT JOIN cart_line l ON l.account_id = c.account_id
           LEFT JOIN variant v ON v.id = l.variant_id LEFT JOIN product p ON p.id = v.product_id
           WHERE c.account_id = %s ORDER BY l.id LIMIT 100""",
        (account_id,),
    )
    lines: list[CartLine] = [
        {
            "variantId": str(row["variant_id"]),
            "quantity": row["quantity"],
            "product": row["product"],
            "variant": row["variant"],
            "unitMinor": row["unit_minor"],
            "available": row["available"],
        }
        for row in cart_rows
        if all(row[field] is not None for field in ("variant_id", "quantity", "product", "variant", "unit_minor", "available"))
    ]
    return {
        "version": cart_rows[0]["version"] if cart_rows else 1,
        "lines": lines,
        "referenceSubtotalMinor": sum(line["unitMinor"] * line["quantity"] for line in lines),
    }


def lock_cart(conn, account_id) -> int:
    conn.execute("INSERT INTO cart (account_id) VALUES (%s) ON CONFLICT DO NOTHING", (account_id,))
    return one(conn, "SELECT version FROM cart WHERE account_id = %s FOR UPDATE", (account_id,))["version"]


def find_receipt(conn, account_id, key):
    return one(
        conn,
        """SELECT request_digest, result_reference FROM command_receipt
           WHERE actor_id = %s AND operation = 'setCartQuantity' AND idem_key = %s""",
        (account_id, key),
    )


def remove_line(conn, account_id, variant_id):
    conn.execute("DELETE FROM cart_line WHERE account_id = %s AND variant_id = %s", (account_id, variant_id))


def is_sellable(conn, variant_id) -> bool:
    variant = one(
        conn,
        """SELECT (v.available AND p.status = 'LISTED') AS available
           FROM variant v JOIN product p ON p.id = v.product_id WHERE v.id = %s FOR SHARE OF v,p""",
        (variant_id,),
    )
    return variant is not None and variant["available"]


def cart_is_full(conn, account_id, variant_id) -> bool:
    return one(
        conn,
        """SELECT count(*) FILTER (WHERE variant_id <> %s) >= 100 AS full
           FROM cart_line WHERE account_id = %s""",
        (variant_id, account_id),
    )["full"]


def upsert_line(conn, account_id, variant_id, quantity):
    conn.execute(
        """INSERT INTO cart_line (id, account_id, variant_id, quantity) VALUES (%s,%s,%s,%s)
           ON CONFLICT (account_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity""",
        (uuid4(), account_id, variant_id, quantity),
    )


def bump_cart_version(conn, account_id):
    conn.execute(
        "UPDATE cart SET version = version + 1, updated_at = clock_timestamp() WHERE account_id = %s",
        (account_id,),
    )


def insert_receipt(conn, account_id, key, digest, cart):
    conn.execute(
        """INSERT INTO command_receipt
           (actor_id, operation, idem_key, request_digest, result_reference, created_at)
           VALUES (%s,'setCartQuantity',%s,%s,%s,clock_timestamp())""",
        (account_id, key, digest, Jsonb(cart)),
    )
