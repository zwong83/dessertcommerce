from collections.abc import Iterable
from datetime import date as Date
from typing import Literal
from uuid import UUID

from psycopg import Connection

from sweetcommerce.db import one, rows
from sweetcommerce.problems import Problem

from .domain import Timestamp, can_fit_capacity, is_handoff_eligible, myt_date, product_demand, uuid
from .infrastructure import (
    CapacityClock,
    database_time,
    lock_capacity_dates as lock_capacity_dates,
    lock_policy,
    read_days,
    read_limits,
    read_policy,
)

AllocationState = Literal["HELD", "COMMITTED"]


def allocate_capacity(
    conn: Connection, order_id: str | UUID, handoff_at: Timestamp, state: AllocationState,
    clock: CapacityClock | None = None,
) -> None:
    """Allocate from saved order lines after Order locks the order and any charge."""
    _allocate(conn, uuid(order_id), handoff_at, state, None, clock)


def reallocate_capacity(
    conn: Connection, order_id: str | UUID, handoff_at: Timestamp, state: AllocationState,
    previous_date: str | Date, clock: CapacityClock | None = None,
) -> None:
    """Swap unused allocations while keeping earlier USED generations counted."""
    _allocate(conn, uuid(order_id), handoff_at, state, str(previous_date), clock)


def _unavailable() -> Problem:
    return Problem("CAPACITY_UNAVAILABLE", 409, "This handoff is unavailable. Choose another time.")


def _allocate(conn: Connection, order_id: str, handoff_at: Timestamp, state: AllocationState,
              previous_date: str | None, clock: CapacityClock | None) -> None:
    day = myt_date(handoff_at)
    lock_policy(conn, "share")
    # Catalogue edits lock the product before updating its variants.
    conn.execute(
        """SELECT p.id FROM product p
            WHERE p.id IN (SELECT product_id FROM standard_order_line WHERE order_id = %s)
            ORDER BY p.id FOR SHARE""",
        (order_id,),
    )
    order_lines = rows(
        conn,
        """SELECT l.variant_id, l.product_id, l.quantity, p.status,
                  COALESCE(v.available, false) AS available, COALESCE(v.prep_minutes, 0) AS prep_minutes
             FROM standard_order_line l JOIN product p ON p.id = l.product_id
             LEFT JOIN variant v ON v.id = l.variant_id AND v.product_id = l.product_id
            WHERE l.order_id = %s""",
        (order_id,),
    )
    items = [{"variantId": line["variant_id"], "quantity": line["quantity"]} for line in order_lines]
    units, prep_minutes, sellable = product_demand(items, order_lines)
    lock_capacity_dates(conn, [previous_date, day] if previous_date else [day])

    live = rows(
        conn,
        """SELECT product_id::text AS product_id, quantity FROM capacity_allocation
            WHERE order_id = %s AND service_date = %s AND state IN ('HELD','COMMITTED')""",
        (order_id, day),
    )
    if live and previous_date != day:
        raise Problem("INVALID_TRANSITION", 409, "This order already has a live allocation.")

    policy = read_policy(conn)
    capacity_day = next(iter(read_days(conn, day, day)), None)
    limits = {row["product_id"]: row for row in read_limits(conn, day, day)}
    if capacity_day is not None and previous_date == day:
        for row in live:
            capacity_day["allocated"] -= row["quantity"]
            limit = limits.get(row["product_id"])
            if limit is not None:
                limit["allocated"] -= row["quantity"]
    now = database_time(conn, clock)
    if (
        not sellable
        or not is_handoff_eligible(policy, now, handoff_at, prep_minutes)
        or not can_fit_capacity(capacity_day, limits, units)
    ):
        raise _unavailable()

    if previous_date:
        released = _change_allocation(conn, order_id, previous_date, "RELEASED")
        if previous_date != day and released == 0:
            _advance_dates(conn, [previous_date])

    updated = conn.execute(
        """UPDATE capacity_day SET allocated_units = allocated_units + %(total)s, version = version + 1
            WHERE service_date = %(day)s AND NOT closed AND allocated_units <= max_units - %(total)s""",
        {"day": day, "total": sum(units.values())},
    )
    if updated.rowcount != 1:
        raise _unavailable()

    conn.execute(
        """INSERT INTO capacity_allocation (order_id, service_date, product_id, quantity, state, generation)
           SELECT %(order)s, %(day)s, demand.product_id, demand.quantity, %(state)s, COALESCE(MAX(a.generation), 0) + 1
             FROM unnest(%(products)s::uuid[], %(quantities)s::integer[]) AS demand(product_id, quantity)
             LEFT JOIN capacity_allocation a ON a.order_id = %(order)s AND a.service_date = %(day)s
              AND a.product_id = demand.product_id
            GROUP BY demand.product_id, demand.quantity""",
        {"order": order_id, "day": day, "state": state, "products": list(units), "quantities": list(units.values())},
    )


def commit_held_capacity(conn: Connection, order_id: str | UUID, date: str | Date) -> int:
    """Promote an existing hold after Order verifies settlement and feasibility."""
    lock_capacity_dates(conn, [date])
    return _change_allocation(conn, uuid(order_id), date, "COMMITTED")


def mark_capacity_used(conn: Connection, order_id: str | UUID, date: str | Date) -> int:
    """Begin production. USED units continue counting against both limits."""
    lock_capacity_dates(conn, [date])
    return _change_allocation(conn, uuid(order_id), date, "USED")


def release_capacity(conn: Connection, order_id: str | UUID, date: str | Date) -> int:
    """Release unused units and advance the date revision. Replays return zero."""
    lock_capacity_dates(conn, [date])
    return _change_allocation(conn, uuid(order_id), date, "RELEASED")


def _change_allocation(conn: Connection, order_id: str, day: str | Date, state: str) -> int:
    previous = {"COMMITTED": ["HELD"], "USED": ["COMMITTED"], "RELEASED": ["HELD", "COMMITTED"]}
    changed = one(
        conn,
        """WITH changed AS (
             UPDATE capacity_allocation SET state = %(state)s
              WHERE order_id = %(order)s AND service_date = %(day)s AND state = ANY(%(previous)s::text[])
              RETURNING quantity
           ), totals AS (SELECT COALESCE(SUM(quantity), 0)::integer AS units FROM changed)
           UPDATE capacity_day SET allocated_units = allocated_units - CASE WHEN %(state)s = 'RELEASED' THEN totals.units ELSE 0 END,
                  version = version + 1
             FROM totals WHERE service_date = %(day)s AND totals.units > 0 RETURNING totals.units""",
        {"order": order_id, "day": day, "state": state, "previous": previous[state]},
    )
    return changed["units"] if changed is not None else 0


def bump_capacity_impact(conn: Connection, dates: Iterable[str | Date]) -> None:
    """Advance revisions for impact-visible writes outside allocation transitions."""
    days = sorted({str(day) for day in dates})
    lock_capacity_dates(conn, days)
    _advance_dates(conn, days)


def _advance_dates(conn: Connection, dates: list[str]) -> None:
    existing = rows(
        conn,
        """UPDATE capacity_day SET version = version + 1 WHERE service_date = ANY(%s::date[])
           RETURNING to_char(service_date, 'YYYY-MM-DD') AS date""",
        (dates,),
    )
    missing = set(dates) - {row["date"] for row in existing}
    if missing:
        conn.execute(
            """INSERT INTO capacity_day (service_date, closed, max_units)
               SELECT day, false, 0 FROM unnest(%s::date[]) AS dates(day)""",
            (sorted(missing),),
        )
