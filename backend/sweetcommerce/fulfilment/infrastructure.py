from datetime import datetime
from uuid import uuid4

from psycopg import sql
from psycopg.types.json import Jsonb

from ..capacity.domain import can_fit_capacity, is_handoff_eligible, myt_date, product_demand
from ..capacity.infrastructure import (
    database_time, lock_policy, read_days, read_limits, read_policy, read_variants,
)
from ..capacity.order import (
    allocate_capacity, bump_capacity_impact, commit_held_capacity, lock_capacity_dates, release_capacity,
)
from ..db import iso, one, rows
from ..order.infrastructure import lock_checkout_products, missing
from ..problems import Problem
from ..refunds.infrastructure import create_full_refund_obligations
from ..work.queue import milestone
from .domain import require


def locked_order(conn, order_id: str, owner_id: str | None) -> dict:
    if owner_id is None:
        order = one(conn, "SELECT * FROM standard_order WHERE id = %s FOR UPDATE", (order_id,))
    else:
        order = one(
            conn, "SELECT * FROM standard_order WHERE id = %s AND account_id = %s FOR UPDATE", (order_id, owner_id),
        )
    if order is None:
        raise missing()
    return order


def update_order(conn, order: dict, now: datetime, **fields) -> dict:
    # Columns come from the application commands, while all values are bound parameters.
    assignments = sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(name)) for name in fields)
    return one(
        conn,
        sql.SQL("UPDATE standard_order SET {}, version = version + 1, updated_at = %s WHERE id = %s RETURNING *")
        .format(assignments),
        (*fields.values(), now, order["id"]),
    )


_NOTICE_ACTIONS = {
    "CONFIRM_DELIVERY_FEE": "STANDARD_AWAITING_PAYMENT",
    "ACCEPT_CASH": "STANDARD_CASH_ACCEPTED",
    "START_PREPARATION": "STANDARD_PREPARING",
    "MARK_READY": "STANDARD_READY",
    "COMPLETE": "STANDARD_COMPLETED",
    "CANCEL": "STANDARD_CANCELLED",
}


def _enqueue_lifecycle_notice(conn, order: dict, action: str, now: datetime, change: dict) -> None:
    name = _NOTICE_ACTIONS.get(action)
    if action == "QUOTE_DELIVERY_FEE" and change["serviceable"]:
        name = "STANDARD_FEE_OFFERED"
    elif action == "REJECT":
        name = "STANDARD_CASH_REJECTED" if order["payment_method"] == "CASH" else "STANDARD_REJECTED"
    elif action == "HANDOFF":
        name = "STANDARD_COMPLETED" if change["toStatus"] == "COMPLETED" else "STANDARD_HANDED_OFF"
    if name is not None:
        milestone(conn, order["id"], name, change["orderVersion"], now,
                  status=change["toStatus"], orderVersion=change["orderVersion"])


def audit(conn, order: dict, actor_id, action: str, now: datetime, request_id: str, *,
          reason_code: str | None = None, change: dict | None = None) -> None:
    conn.execute(
        """INSERT INTO audit_event
                  (id, actor_id, feature, resource_id, action, occurred_at, request_id, reason_code, safe_change)
           VALUES (%s,%s,'ORDER',%s,%s,%s,%s,%s,%s)""",
        (uuid4(), actor_id, order["id"], action, now, request_id, reason_code, Jsonb(change or {})),
    )
    _enqueue_lifecycle_notice(conn, order, action, now, change or {})


def accept_order(conn, order, *, actor_id, now, allocation_already_committed=False) -> dict:
    """Accept under the caller's parent lock after payment eligibility is established."""
    if order["accepted_at"] is not None:
        return order
    now = datetime.fromisoformat(now) if isinstance(now, str) else now
    handoff = order["promised_handoff_at"] or order["requested_handoff_at"]
    if order["payment_method"] == "CASH":
        require(
            order["status"] == "AWAITING_CASH" and order["fulfilment"] == "PICKUP",
            "This order is not awaiting Cash pickup acceptance.",
        )
        if not allocation_already_committed:
            allocate_capacity(conn, order["id"], handoff, "COMMITTED", clock=lambda: now)
        conn.execute(
            """INSERT INTO charge (id, order_id, category, state, expected_minor, created_at)
               VALUES (%s,%s,'STANDARD','OPEN',%s,%s)""",
            (uuid4(), order["id"], order["total_minor"], now),
        )
    else:
        require(
            order["status"] in ("PENDING_PROOF", "PAYMENT_REVIEW", "EXCEPTION"),
            "This order is not awaiting verified payment.",
        )
        if not allocation_already_committed:
            require(
                commit_held_capacity(conn, order["id"], order["service_date"]) > 0,
                "This order has no production hold to commit.",
            )
    consume_cart(conn, order, now)
    updated = update_order(
        conn, order, now, status="ACCEPTED", accepted_at=now, promised_handoff_at=handoff, service_date=myt_date(handoff),
    )
    audit(conn, order, actor_id, "ACCEPT", now, str(order["id"]), change={"fromStatus": order["status"], "toStatus": "ACCEPTED"})
    return updated


def consume_cart(conn, order: dict, now: datetime) -> None:
    account_id, order_id = order["account_id"], order["id"]
    conn.execute("SELECT account_id FROM cart WHERE account_id = %s FOR UPDATE", (account_id,))
    removed = conn.execute(
        """DELETE FROM cart_line c USING standard_order_line l
            WHERE l.order_id = %s AND c.account_id = %s AND c.id = l.cart_line_generation
              AND c.variant_id = l.variant_id AND c.quantity <= l.quantity""",
        (order_id, account_id),
    ).rowcount
    reduced = conn.execute(
        """UPDATE cart_line c SET quantity = c.quantity - l.quantity FROM standard_order_line l
            WHERE l.order_id = %s AND c.account_id = %s AND c.id = l.cart_line_generation
              AND c.variant_id = l.variant_id AND c.quantity > l.quantity""",
        (order_id, account_id),
    ).rowcount
    if removed or reduced:
        conn.execute("UPDATE cart SET version = version + 1, updated_at = %s WHERE account_id = %s", (now, account_id))


def check_offer_capacity(conn, order: dict, handoff: str, clock) -> None:
    items = rows(
        conn,
        """SELECT variant_id AS "variantId", quantity FROM standard_order_line WHERE order_id = %s""",
        (order["id"],),
    )
    lock_policy(conn, "share")
    lock_checkout_products(conn, {"items": items})
    day = myt_date(handoff)
    lock_capacity_dates(conn, [order["service_date"], day])
    variants = read_variants(conn, [item["variantId"] for item in items])
    demand, prep, sellable = product_demand(items, variants)
    policy = read_policy(conn)
    days = read_days(conn, day, day)
    limits = {row["product_id"]: row for row in read_limits(conn, day, day)}
    if (
        not sellable
        or not is_handoff_eligible(policy, database_time(conn, clock), handoff, prep)
        or not can_fit_capacity(days[0] if days else None, limits, demand)
    ):
        raise Problem("CAPACITY_UNAVAILABLE", 409, "Choose an available handoff time.")


def latest_offer(conn, order: dict) -> dict | None:
    return one(
        conn, "SELECT * FROM delivery_fee_offer WHERE order_id = %s AND revision = %s",
        (order["id"], order["fee_version"]),
    )


def insert_offer(conn, order: dict, revision: int, offered: dict, terms: dict, now: datetime) -> None:
    conn.execute(
        """INSERT INTO delivery_fee_offer
                  (order_id, revision, serviceable, offered_handoff_at, fee_minor, terms_version,
                   terms_snapshot, reason, created_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (order["id"], revision, offered["serviceable"], offered["handoffAt"], offered["feeMinor"],
         terms["version"], Jsonb({"termsText": terms["text"]}), offered["reason"], now),
    )


def locked_charges(conn, order_id) -> list[dict]:
    return rows(conn, "SELECT * FROM charge WHERE order_id = %s ORDER BY id FOR UPDATE", (order_id,))


def standard_charge(charges: list[dict]) -> dict | None:
    return next((charge for charge in charges if charge["category"] == "STANDARD"), None)


def payment_evidence(conn, charge_ids: list) -> bool:
    return one(
        conn,
        """SELECT EXISTS (SELECT 1 FROM payment_proof WHERE charge_id = ANY(%(ids)s::uuid[]))
               OR EXISTS (SELECT 1 FROM money_entry WHERE charge_id = ANY(%(ids)s::uuid[]) AND kind = 'RECEIPT')
               OR EXISTS (SELECT 1 FROM settlement_case WHERE charge_id = ANY(%(ids)s::uuid[]) AND status = 'OPEN')
                  AS recorded""",
        {"ids": charge_ids},
    )["recorded"]


def close_order(conn, order: dict, charges: list[dict], now: datetime, status: str) -> dict:
    if not release_capacity(conn, order["id"], order["service_date"]):
        bump_capacity_impact(conn, [order["service_date"]])
    # Preserve open reconciliation and recorded financial states.
    conn.execute(
        """UPDATE charge SET state = 'CANCELLED', version = version + 1
            WHERE id = ANY(%s::uuid[]) AND state = 'OPEN'
              AND NOT EXISTS (SELECT 1 FROM settlement_case WHERE charge_id = charge.id AND status = 'OPEN')
              AND NOT EXISTS (SELECT 1 FROM money_entry WHERE charge_id = charge.id AND kind = 'RECEIPT')""",
        ([charge["id"] for charge in charges],),
    )
    return update_order(conn, order, now, status=status)


def record_refund_obligations(conn, charges: list[dict], actor_id: str) -> None:
    for charge in charges:
        create_full_refund_obligations(conn, charge["id"], actor_id, "MERCHANT_UNABLE")


def collect_cash(conn, order: dict, charge: dict, actor_id: str, handoff: datetime, now: datetime) -> None:
    require(charge is not None and charge["state"] == "OPEN", "This Cash charge cannot be collected.")
    if charge["expected_minor"]:
        conn.execute(
            """INSERT INTO money_entry
                      (id, charge_id, kind, rail, external_reference, amount_minor, occurred_at, actor_id, recorded_at)
               VALUES (%s,%s,'RECEIPT','CASH',%s,%s,%s,%s,%s)""",
            (uuid4(), charge["id"], order["order_number"], charge["expected_minor"], handoff, actor_id, now),
        )
    conn.execute("UPDATE charge SET state = 'PAID', version = version + 1 WHERE id = %s", (charge["id"],))


def insert_agreement(conn, order: dict, actor_id: str, now: datetime, recovery: dict) -> str:
    agreement_id = str(uuid4())
    consent = recovery["consent"]
    conn.execute(
        """INSERT INTO order_recovery_agreement
                  (id, order_id, order_version, kind, proposed_handoff_at, new_production, extra_minor,
                   agreed_at, consent_channel, consent_reference, reason, recorded_by, recorded_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (agreement_id, order["id"], order["version"], recovery["kind"], recovery.get("handoffAt"),
         recovery.get("newProduction"), recovery.get("amountMinor"), consent["agreedAt"], consent["channel"],
         consent["reference"], recovery["reason"], actor_id, now),
    )
    return agreement_id


def adjustment_charge(conn, order: dict, agreement_id: str, amount_minor: int, now: datetime) -> str:
    charge_id = str(uuid4())
    conn.execute(
        """INSERT INTO charge (id, order_id, category, state, expected_minor, recovery_agreement_id, created_at)
           VALUES (%s,%s,'STANDARD_ADJUSTMENT','OPEN',%s,%s,%s)""",
        (charge_id, order["id"], amount_minor, agreement_id, now),
    )
    return charge_id


def paid_infeasible_case(conn, charge: dict | None) -> bool:
    if charge is None or charge["state"] not in ("DISPUTED", "PROOF_REVIEW"):
        return False
    state = one(
        conn,
        """SELECT
             (SELECT COALESCE(SUM(CASE WHEN kind = 'RECEIPT' THEN amount_minor ELSE -amount_minor END), 0)
                FROM money_entry WHERE charge_id = %(id)s) AS net,
             EXISTS (SELECT 1 FROM settlement_case WHERE charge_id = %(id)s
                  AND status = 'OPEN' AND kind = 'STANDARD_FULFILMENT_INFEASIBLE') AS infeasible,
             EXISTS (SELECT 1 FROM refund_intent i JOIN money_entry m ON m.id = i.receipt_id
                      WHERE m.charge_id = %(id)s AND i.status IN ('RESERVED', 'UNCERTAIN')) AS pending_refund""",
        {"id": charge["id"]},
    )
    return state["infeasible"] and state["net"] == charge["expected_minor"] and not state["pending_refund"]


def resolve_infeasible_case(conn, charge: dict, actor_id: str, now: datetime) -> None:
    conn.execute("UPDATE charge SET state = 'PAID', version = version + 1 WHERE id = %s", (charge["id"],))
    conn.execute(
        """UPDATE settlement_case SET status = 'RESOLVED', resolved_by = %s, resolved_at = %s
            WHERE charge_id = %s AND kind IN ('STANDARD_FULFILMENT_INFEASIBLE', 'AMOUNT_MISMATCH')
              AND status = 'OPEN'""",
        (actor_id, now, charge["id"]),
    )


def latest_recovery(conn, order_id) -> dict | None:
    return one(
        conn,
        """SELECT order_version, recorded_at FROM order_recovery_agreement
            WHERE order_id = %s AND kind IN ('RESCHEDULE','REDELIVERY')
            ORDER BY order_version DESC LIMIT 1""",
        (order_id,),
    )


def status_before_incident(conn, order: dict) -> str | None:
    if order["status"] != "EXCEPTION":
        return order["status"]
    event = one(
        conn,
        """SELECT safe_change->>'fromStatus' AS status FROM audit_event
            WHERE resource_id = %s AND feature = 'ORDER' AND action = 'RECORD_INCIDENT'
              AND safe_change->>'fromStatus' <> 'EXCEPTION'
            ORDER BY (safe_change->>'orderVersion')::bigint DESC NULLS LAST LIMIT 1""",
        (order["id"],),
    )
    return event["status"] if event is not None else None


def has_current_arrival(conn, order: dict, recovery: dict | None) -> bool:
    if order["driver_arrived_at"] is None:
        return False
    if recovery is None:
        return True
    return one(
        conn,
        """SELECT EXISTS (SELECT 1 FROM audit_event
            WHERE resource_id = %s AND feature = 'ORDER' AND action = 'RECORD_DRIVER_ARRIVAL'
              AND (safe_change->>'orderVersion')::bigint > %s) AS recorded""",
        (order["id"], recovery["order_version"]),
    )["recorded"]


def at(value: datetime | None) -> str | None:
    return iso(value) if value is not None else None
