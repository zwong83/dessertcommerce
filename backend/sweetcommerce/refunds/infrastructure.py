from uuid import uuid4

from ..db import one, rows
from ..order.infrastructure import missing
from ..settlement.domain import invalid_transition, refund_view


def lock_parent_and_charge(conn, charge_id):
    link = one(conn, "SELECT * FROM charge WHERE id = %s", (charge_id,))
    if link is None:
        raise missing()
    if link["order_id"] is not None:
        key = "order_id"
        parent = one(conn, "SELECT id, status FROM standard_order WHERE id = %s FOR UPDATE", (link[key],))
    elif link.get("event_id") is not None:
        key = "event_id"
        parent = one(conn, "SELECT id, status FROM event_application WHERE id = %s FOR UPDATE", (link[key],))
    else:
        raise missing()
    if parent is None:
        raise missing()

    charge = one(conn, "SELECT * FROM charge WHERE id = %s FOR UPDATE", (charge_id,))
    if charge is None or charge.get(key) != parent["id"]:
        raise missing()
    return parent, charge


def lock_receipt(conn, charge_id, receipt_id):
    # The API role has no UPDATE privilege on the append-only ledger.
    if one(conn, "SELECT sweetcommerce.lock_receipt(%s, %s) AS id", (charge_id, receipt_id))["id"] is None:
        raise missing()
    return one(conn, """
        SELECT id, rail, amount_minor, settlement_case_id
          FROM money_entry WHERE id = %s
    """, (receipt_id,))


def receipt_refunds(conn, receipt_id):
    return one(conn, """
        SELECT COALESCE(SUM(m.amount_minor), 0)::bigint AS posted,
               COALESCE(SUM(i.amount_minor) FILTER (WHERE i.status IN ('RESERVED','UNCERTAIN')), 0)::bigint AS reserved
          FROM refund_intent i LEFT JOIN money_entry m ON m.id = i.refund_entry_id
         WHERE i.receipt_id = %s
    """, (receipt_id,))


def create_full_refund_obligations(conn, charge_id, actor_id, reason):
    """Call in the cancellation transaction with the parent and charge already locked."""
    receipts = rows(conn, """
        SELECT id FROM money_entry WHERE charge_id = %s AND kind = 'RECEIPT' ORDER BY id
    """, (charge_id,))
    for item in receipts:
        receipt = lock_receipt(conn, charge_id, item["id"])
        remaining = receipt["amount_minor"] - receipt_refunds(conn, receipt["id"])["posted"]
        if remaining > 0:
            conn.execute("""
                INSERT INTO full_refund_obligation (receipt_id, amount_minor, reason, actor_id, recorded_at)
                VALUES (%s,%s,%s,%s,clock_timestamp()) ON CONFLICT (receipt_id) DO NOTHING
            """, (receipt["id"], remaining, reason, actor_id))


def money_totals(conn, charge_id):
    return one(conn, """
        WITH receipts AS (
          SELECT m.amount_minor, obligation.amount_minor AS required,
                 COALESCE(r.posted, 0) AS posted, COALESCE(r.reserved, 0) AS reserved
            FROM money_entry m
            LEFT JOIN full_refund_obligation obligation ON obligation.receipt_id = m.id
            LEFT JOIN LATERAL (
              SELECT SUM(p.amount_minor) AS posted,
                     SUM(i.amount_minor) FILTER (WHERE i.status IN ('RESERVED','UNCERTAIN')) AS reserved
                FROM refund_intent i LEFT JOIN money_entry p ON p.id = i.refund_entry_id
               WHERE i.receipt_id = m.id
            ) r ON true
           WHERE m.charge_id = %(charge)s AND m.kind = 'RECEIPT'
        )
        SELECT COALESCE(SUM(amount_minor), 0)::bigint AS paid,
               COALESCE((SELECT SUM(amount_minor) FROM money_entry
                          WHERE charge_id = %(charge)s AND kind = 'REFUND'), 0)::bigint AS refunded,
               COALESCE(SUM(GREATEST(0, amount_minor - posted - reserved)), 0)::bigint AS available,
               COALESCE(SUM(GREATEST(0, LEAST(required, amount_minor - posted)))
                        FILTER (WHERE required IS NOT NULL), 0)::bigint AS required
          FROM receipts
    """, {"charge": charge_id})


def intent_target(conn, intent_id):
    target = one(conn, """
        SELECT i.receipt_id, m.charge_id
          FROM refund_intent i JOIN money_entry m ON m.id = i.receipt_id
         WHERE i.id = %s AND m.kind = 'RECEIPT'
    """, (intent_id,))
    if target is None:
        raise missing()
    return target


def lock_intent(conn, intent_id, receipt_id):
    intent = one(conn, """
        SELECT id, receipt_id, amount_minor, status, updated_at
          FROM refund_intent WHERE id = %s AND receipt_id = %s FOR UPDATE
    """, (intent_id, receipt_id))
    if intent is None:
        raise missing()
    return intent


def recent_refund_intents(conn, charge_id):
    return [refund_view(intent) for intent in rows(conn, """
        SELECT i.id, i.receipt_id, i.amount_minor, i.status, i.updated_at
          FROM refund_intent i JOIN money_entry m ON m.id = i.receipt_id
         WHERE m.charge_id = %s
         ORDER BY (i.status = 'UNCERTAIN') DESC, i.updated_at DESC, i.id DESC LIMIT 20
    """, (charge_id,))]


def reserve_intent(conn, receipt_id, actor_id, amount, reason, now):
    return one(conn, """
        INSERT INTO refund_intent (id, receipt_id, amount_minor, status, requested_by, reason, created_at, updated_at)
        VALUES (%s,%s,%s,'RESERVED',%s,%s,%s,%s)
        RETURNING id, receipt_id, amount_minor, status, updated_at
    """, (uuid4(), receipt_id, amount, actor_id, reason, now, now))


def append_payout(conn, charge_id, receipt, actor_id, details, now):
    entry = one(conn, """
        INSERT INTO money_entry
            (id, charge_id, kind, rail, external_reference, amount_minor, occurred_at,
             actor_id, reason, settlement_case_id, recorded_at)
        VALUES (%s,%s,'REFUND',%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (rail, kind, external_reference) DO NOTHING RETURNING id
    """, (uuid4(), charge_id, receipt["rail"], details["externalReference"], details["amountMinor"],
          details["refundedAt"], actor_id, details["reason"], receipt["settlement_case_id"], now))
    if entry is None:
        raise invalid_transition("That payout movement has already been recorded.")
    return entry["id"]


def dispose_intent(conn, intent_id, state, reason, now, *, entry_id=None):
    return one(conn, """
        UPDATE refund_intent SET status = %s, disposition_reason = %s, updated_at = %s, refund_entry_id = %s
         WHERE id = %s RETURNING id, receipt_id, amount_minor, status, updated_at
    """, (state, reason, now, entry_id, intent_id))
