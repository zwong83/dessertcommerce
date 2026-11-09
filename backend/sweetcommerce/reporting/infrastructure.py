from ..db import one, rows


def verified_money(conn, period):
    return rows(conn, """
        SELECT CASE WHEN c.category = 'STANDARD_ADJUSTMENT' THEN 'STANDARD' ELSE c.category END AS category,
          COALESCE(SUM(m.amount_minor) FILTER (WHERE m.kind = 'RECEIPT'), 0)::bigint AS received,
          COALESCE(SUM(m.amount_minor) FILTER (WHERE m.kind = 'REFUND'), 0)::bigint AS refunded
        FROM money_entry m JOIN charge c ON c.id = m.charge_id
        WHERE m.occurred_at >= %(start)s AND m.occurred_at < %(stop)s GROUP BY 1
    """, period)


def order_counts(conn, period):
    return rows(conn, """
        SELECT status, COUNT(*) AS count,
          COUNT(*) FILTER (WHERE accepted_at >= %(start)s AND accepted_at < %(stop)s) AS accepted
        FROM standard_order
        WHERE COALESCE(accepted_at, created_at) >= %(start)s AND COALESCE(accepted_at, created_at) < %(stop)s
          AND (%(status)s::text IS NULL OR status = %(status)s)
        GROUP BY status ORDER BY status
    """, period)


def prep_by_day(conn, period):
    return rows(conn, """
        SELECT a.service_date AS date, SUM(a.quantity)::bigint AS units
        FROM capacity_allocation a JOIN standard_order o ON o.id = a.order_id
        WHERE a.service_date BETWEEN %(first)s AND %(last)s AND a.state IN ('COMMITTED','USED')
          AND (%(status)s::text IS NULL OR o.status = %(status)s)
        GROUP BY a.service_date ORDER BY a.service_date
    """, period)


def prep_kpis(conn, period):
    return one(conn, """
        SELECT COUNT(*) AS due, COUNT(*) FILTER (WHERE ready_at <= promised_handoff_at) AS on_time
        FROM standard_order
        WHERE service_date BETWEEN %(first)s AND %(last)s AND accepted_at IS NOT NULL
          AND promised_handoff_at IS NOT NULL AND (status NOT IN ('CANCELLED','REJECTED') OR ready_at IS NOT NULL)
    """, period)


def event_kpis(conn, period):
    return one(conn, """
        SELECT
          (SELECT COUNT(*) FROM event_application WHERE booked_at >= %(start)s AND booked_at < %(stop)s) AS booked,
          COUNT(*) AS quoted, COUNT(*) FILTER (WHERE e.booked_at IS NOT NULL) AS converted
        FROM event_application e
        JOIN (SELECT DISTINCT event_id FROM event_quote WHERE issued_at >= %(start)s AND issued_at < %(stop)s) q
          ON q.event_id = e.id
    """, period)
