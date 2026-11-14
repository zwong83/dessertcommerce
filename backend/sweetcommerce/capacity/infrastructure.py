import hashlib
import json
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date
from uuid import uuid4

from psycopg import Connection
from psycopg.types.json import Jsonb

from sweetcommerce.db import iso, one, rows
from sweetcommerce.problems import Problem, ResourceNotFound

from .domain import Timestamp, date_millis, uuid

WEEKDAYS = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")
CapacityClock = Callable[[], Timestamp]


@dataclass(frozen=True)
class CapacityCommand:
    idempotency_key: str
    request_id: str


def json_bytes(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8", errors="backslashreplace")


def command[T](
    conn: Connection, actor_id: str, operation: str, context: CapacityCommand, intent, run: Callable[[], T],
) -> T:
    key = uuid(context.idempotency_key)
    digest = hashlib.sha256(json_bytes(intent)).digest()
    conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"{actor_id}:{operation}:{key}",))
    receipt = one(
        conn,
        """SELECT request_digest, result_reference FROM command_receipt
            WHERE actor_id = %s AND operation = %s AND idem_key = %s""",
        (actor_id, operation, key),
    )
    if receipt is not None:
        if digest != receipt["request_digest"]:
            raise Problem("IDEMPOTENCY_CONFLICT", 409, "Use a new key for a different request.")
        return receipt["result_reference"]

    result = run()
    conn.execute(
        """INSERT INTO command_receipt (actor_id, operation, idem_key, request_digest, result_reference, created_at)
           VALUES (%s, %s, %s, %s, %s, clock_timestamp())""",
        (actor_id, operation, key, digest, Jsonb(result)),
    )
    return result


def audit(conn: Connection, actor_id: str, action: str, resource: str, context: CapacityCommand, change: dict) -> None:
    conn.execute(
        """INSERT INTO audit_event (id, actor_id, feature, resource_id, action, occurred_at, request_id, safe_change)
           VALUES (%s, %s, 'CAPACITY', %s, %s, clock_timestamp(), %s, %s)""",
        (uuid4(), actor_id, resource, action, context.request_id, Jsonb(change)),
    )


def database_time(conn: Connection, clock: CapacityClock | None = None) -> str:
    if clock is not None:
        now = clock()
        return now if isinstance(now, str) else iso(now)
    return one(conn, """SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS time""")["time"]


def read_policy(conn: Connection) -> dict:
    row = one(conn, "SELECT open_weekdays, opens_at::text, closes_at::text, version FROM operating_policy WHERE singleton")
    if row is None:
        return {"openWeekdays": list(range(1, 8)), "opensAt": "06:00", "closesAt": "22:00", "version": 1}
    return {
        "openWeekdays": row["open_weekdays"],
        "opensAt": row["opens_at"][:5],
        "closesAt": row["closes_at"][:5],
        "version": row["version"],
    }


def lock_policy(conn: Connection, mode: str) -> None:
    # The advisory lock also protects the default policy before the first save.
    if mode == "share":
        conn.execute("SELECT pg_advisory_xact_lock_shared(1599625048, 24)")
    else:
        conn.execute("SELECT pg_advisory_xact_lock(1599625048, 24)")


def save_policy(conn: Connection, policy: dict) -> None:
    conn.execute(
        """INSERT INTO operating_policy (singleton, open_weekdays, opens_at, closes_at, version)
           VALUES (TRUE, %s, %s, %s, %s)
           ON CONFLICT (singleton) DO UPDATE SET open_weekdays = EXCLUDED.open_weekdays,
             opens_at = EXCLUDED.opens_at, closes_at = EXCLUDED.closes_at, version = EXCLUDED.version""",
        (policy["openWeekdays"], policy["opensAt"], policy["closesAt"], policy["version"]),
    )


def read_variants(conn: Connection, variants: list[str]) -> list[dict]:
    return rows(
        conn,
        """SELECT v.id AS variant_id, p.id AS product_id, p.status, v.available, v.prep_minutes
             FROM variant v JOIN product p ON p.id = v.product_id WHERE v.id = ANY(%s::uuid[])""",
        (variants,),
    )


def read_days(conn: Connection, start: str | date, end: str | date) -> list[dict]:
    return rows(
        conn,
        """SELECT to_char(service_date, 'YYYY-MM-DD') AS date, closed, max_units AS max,
                  allocated_units AS allocated, version
             FROM capacity_day WHERE service_date BETWEEN %s AND %s ORDER BY service_date""",
        (start, end),
    )


def read_limits(conn: Connection, start: str | date, end: str | date) -> list[dict]:
    return rows(
        conn,
        """SELECT to_char(l.service_date, 'YYYY-MM-DD') AS date, l.product_id::text AS product_id, l.max_units AS max,
                  COALESCE(SUM(a.quantity), 0)::integer AS allocated
             FROM capacity_product_limit l
             LEFT JOIN capacity_allocation a ON a.service_date = l.service_date AND a.product_id = l.product_id
              AND a.state IN ('HELD','COMMITTED','USED')
            WHERE l.service_date BETWEEN %s AND %s
            GROUP BY l.service_date, l.product_id, l.max_units ORDER BY l.service_date, l.product_id""",
        (start, end),
    )


def lock_capacity_dates(conn: Connection, dates: Iterable[str | date]) -> None:
    """Lock all affected dates in order after Order, charge, catalogue and policy locks."""
    for day in sorted({str(value) for value in dates}):
        # A date with no row still needs a lock for the first edit or pending intake.
        conn.execute("SELECT pg_advisory_xact_lock(1599625049, %s)", (date_millis(day) // 86_400_000,))
        conn.execute("SELECT service_date FROM capacity_day WHERE service_date = %s FOR UPDATE", (day,))


def check_products(conn: Connection, edit: dict, *, lock: bool) -> None:
    products = [limit["productId"] for limit in edit["productLimits"]]
    if not products:
        return
    query = "SELECT id FROM product WHERE id = ANY(%s::uuid[]) ORDER BY id"
    if lock:
        query += " FOR KEY SHARE"
    if len(rows(conn, query, (products,))) != len(products):
        raise ResourceNotFound("A product was not found.")


def protected_counts(conn: Connection, edit: dict, day: dict | None) -> dict:
    counts = rows(
        conn,
        """SELECT product_id::text AS product_id, SUM(quantity)::integer AS occupied,
                  COALESCE(SUM(quantity) FILTER (WHERE state = 'USED'), 0)::integer AS used
             FROM capacity_allocation WHERE service_date = %s AND state IN ('HELD','COMMITTED','USED')
            GROUP BY product_id""",
        (edit["date"],),
    )
    occupied = max(day["allocated"] if day else 0, sum(row["occupied"] for row in counts))
    totals = {row["product_id"]: row["occupied"] for row in counts}
    return {
        "occupiedUnits": occupied,
        "usedUnits": sum(row["used"] for row in counts),
        "canSave": edit["dayLimit"] >= occupied and all(
            limit["limit"] >= totals.get(limit["productId"], 0) for limit in edit["productLimits"]
        ),
    }


def affected_orders(
    conn: Connection, edit: dict, day: dict | None, limit: int, anchor: list[str] | None,
) -> tuple[list[dict], int]:
    whole_day = (day["closed"] if day else False) != edit["closed"] or (day["max"] if day else 0) != edit["dayLimit"]
    products = None
    if not whole_day:
        proposed = {item["productId"]: item["limit"] for item in edit["productLimits"]}
        current = {row["product_id"]: row["max"] for row in read_limits(conn, edit["date"], edit["date"])}
        products = [key for key in proposed.keys() | current.keys() if proposed.get(key) != current.get(key)]
        if not products:
            return [], 0

    page = one(
        conn,
        """WITH affected AS (
             SELECT o.id AS "orderId", o.order_number AS "orderNumber", o.status, o.created_at,
                    to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
                    CASE WHEN o.status IN ('AWAITING_CASH','AWAITING_FEE') OR
                         (o.status = 'EXCEPTION' AND o.accepted_at IS NULL AND NOT EXISTS (
                           SELECT 1 FROM capacity_allocation a WHERE a.order_id = o.id AND a.service_date = o.service_date
                             AND a.state IN ('HELD','COMMITTED','USED')))
                         THEN 'PENDING_RECHECK' ELSE 'EXISTING_COMMITMENT' END AS kind,
                    line.units, o.promised_handoff_at AS "promisedHandoffAt"
               FROM standard_order o
               JOIN LATERAL (SELECT SUM(l.quantity)::integer AS units FROM standard_order_line l
                              WHERE l.order_id = o.id
                                AND (%(products)s::uuid[] IS NULL OR l.product_id = ANY(%(products)s))) line
                 ON line.units IS NOT NULL
              WHERE o.service_date = %(day)s AND o.status NOT IN ('COMPLETED','EXPIRED','CANCELLED','REJECTED','NO_SHOW')
           ), page AS (
             SELECT * FROM affected
              WHERE %(created)s::timestamptz IS NULL OR (created_at, "orderId") > (%(created)s, %(order)s::uuid)
              ORDER BY created_at, "orderId" LIMIT %(limit)s
           )
           SELECT (SELECT COUNT(*)::integer FROM affected) AS affected_count,
                  COALESCE(jsonb_agg(to_jsonb(page) - 'created_at' ORDER BY created_at, "orderId"), '[]') AS items
             FROM page""",
        {"day": edit["date"], "products": products, "created": anchor[0] if anchor else None,
         "order": anchor[1] if anchor else None, "limit": limit + 1},
    )
    return page["items"], page["affected_count"]


def save_capacity(conn: Connection, edit: dict, version: int) -> None:
    conn.execute(
        """INSERT INTO capacity_day (service_date, closed, max_units, version) VALUES (%s, %s, %s, %s)
           ON CONFLICT (service_date) DO UPDATE SET closed = EXCLUDED.closed, max_units = EXCLUDED.max_units,
             version = EXCLUDED.version""",
        (edit["date"], edit["closed"], edit["dayLimit"], version),
    )
    conn.execute("DELETE FROM capacity_product_limit WHERE service_date = %s", (edit["date"],))
    conn.execute(
        """INSERT INTO capacity_product_limit (service_date, product_id, max_units)
           SELECT %s, product_id, max_units FROM unnest(%s::uuid[], %s::integer[]) AS caps(product_id, max_units)""",
        (edit["date"], [limit["productId"] for limit in edit["productLimits"]],
         [limit["limit"] for limit in edit["productLimits"]]),
    )


def calendar_event_windows(conn, start: str, end: str) -> dict[str, list[dict]]:
    result: dict[str, list[dict]] = {}
    for item in rows(conn, """
        WITH windows AS (
          SELECT q.event_id,w.starts_at,w.ends_at,w.status
          FROM resource_window w JOIN event_quote q ON q.id=w.quote_id
          WHERE w.status IN ('HELD','BOOKED','USED')
          UNION ALL
          SELECT event_id,resource_starts_at,resource_ends_at,resource_status
          FROM event_schedule_change WHERE resource_status IN ('BOOKED','USED')
        ), daily AS (
          SELECT d.day::date AS day,w.*,
            row_number() OVER (PARTITION BY d.day ORDER BY w.starts_at,w.event_id) AS position
          FROM generate_series(%(start)s::date::timestamp,%(end)s::date::timestamp,interval '1 day') d(day)
          JOIN windows w ON w.starts_at < ((d.day+interval '1 day') AT TIME ZONE 'Asia/Kuala_Lumpur')
            AND w.ends_at > (d.day AT TIME ZONE 'Asia/Kuala_Lumpur')
        )
        SELECT day,event_id,starts_at,ends_at,status FROM daily WHERE position<=100 ORDER BY day,position
    """, {"start": start, "end": end}):
        result.setdefault(item["day"].isoformat(), []).append({
            "eventId": str(item["event_id"]), "startsAt": iso(item["starts_at"]),
            "endsAt": iso(item["ends_at"]), "status": item["status"],
        })
    return result
