from uuid import uuid4

from psycopg.types.json import Jsonb

from ..db import one, rows
from .domain import LEASE_SECONDS


def claim_notice(conn):
    return one(conn, """
        WITH due AS (
          SELECT id, work_state FROM durable_work WHERE kind='NOTICE' AND (
            (work_state='READY' AND not_before<=clock_timestamp()) OR
            (work_state='LEASED' AND lease_until<=clock_timestamp())
          ) ORDER BY CASE WHEN work_state='LEASED' THEN lease_until ELSE not_before END,id
            FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE durable_work w SET work_state='LEASED', lease_token=%s,
          lease_until=clock_timestamp()+%s*interval '1 second'
        FROM due WHERE w.id=due.id RETURNING w.*, due.work_state AS previous_state
    """, (uuid4(), LEASE_SECONDS))


def fenced_notice(conn, work):
    return one(conn, """
        SELECT * FROM durable_work WHERE id=%s AND lease_token=%s AND kind='NOTICE'
          AND work_state='LEASED' AND lease_until>clock_timestamp() FOR UPDATE
    """, (work["id"], work["lease_token"]))


def attempts(conn, notice_id):
    return rows(conn, """
        SELECT attempt_no,attempted_at,channel,outcome,safe_reason
        FROM notice_attempt WHERE work_id=%s ORDER BY attempt_no
    """, (notice_id,))


def context(conn, work):
    return one(conn, """
        SELECT * FROM sweetcommerce.notice_recipient(%s,%s) ORDER BY phone,email LIMIT 1
    """, (work["id"], work["lease_token"]))


def payment_facts(conn, work, charge_id):
    return one(conn, "SELECT * FROM sweetcommerce.notice_payment_facts(%s,%s,%s)",
               (work["id"], work["lease_token"], charge_id))


def start_attempt(conn, work, attempt, channel):
    conn.execute("""
        INSERT INTO notice_attempt (work_id,attempt_no,attempted_at,channel,outcome,safe_reason)
        VALUES (%s,%s,clock_timestamp(),%s,'UNKNOWN','IN_FLIGHT')
    """, (work["id"], attempt, channel))
    conn.execute("UPDATE durable_work SET attempt_count=%s WHERE id=%s AND lease_token=%s",
                 (attempt, work["id"], work["lease_token"]))


def finish_attempt(conn, work, attempt, result):
    conn.execute("""
        UPDATE notice_attempt SET outcome=%s,safe_reason=%s
        WHERE work_id=%s AND attempt_no=%s AND outcome='UNKNOWN' AND safe_reason='IN_FLIGHT'
    """, (result.outcome, result.safe_reason, work["id"], attempt))


def finish_notice(conn, work, status, reason=None, *, delay=0):
    conn.execute("""
        UPDATE durable_work SET work_state=%s, lease_token=NULL, lease_until=NULL,
          last_safe_error=%s, not_before=CASE WHEN %s='READY' THEN clock_timestamp()+%s*interval '1 second' ELSE not_before END
        WHERE id=%s AND lease_token=%s
    """, (status, reason, status, delay, work["id"], work["lease_token"]))


def read_notice(conn, notice_id):
    return one(conn, """
        SELECT w.*, CASE WHEN o.id IS NOT NULL THEN 'ORDER' WHEN e.id IS NOT NULL THEN 'EVENT' ELSE 'WORK' END AS source_type,
          COALESCE(o.order_number,e.event_number,'Notice') AS number, o.id AS order_id,e.id AS event_id,
          c.id AS charge_id
        FROM durable_work w LEFT JOIN standard_order o ON o.id=w.resource_id
        LEFT JOIN event_application e ON e.id=w.resource_id
        LEFT JOIN charge c ON c.id::text=w.payload->>'chargeId' AND (c.order_id=o.id OR c.event_id=e.id)
        WHERE w.kind='NOTICE' AND w.id=%s
    """, (notice_id,))


def followup(conn, notice_id):
    return one(conn, "SELECT disposition,resolved_at FROM notice_followup WHERE work_id=%s", (notice_id,))


def record_followup(conn, notice_id, admin, disposition, reason, now, request_id):
    if not conn.execute("""
        INSERT INTO notice_followup (work_id,disposition,reason,resolved_by,resolved_at)
        VALUES (%s,%s,%s,%s,%s) ON CONFLICT (work_id) DO NOTHING
    """, (notice_id, disposition, reason, admin, now)).rowcount:
        return False
    conn.execute("""
        INSERT INTO audit_event (id,actor_id,feature,resource_id,action,occurred_at,reason_code,request_id,safe_change)
        VALUES (%s,%s,'NOTIFICATION',%s,'RESOLVE_NOTIFICATION_FAILURE',%s,%s,%s,%s)
    """, (uuid4(), admin, notice_id, now, disposition, request_id, Jsonb({"disposition": disposition})))
    return True
