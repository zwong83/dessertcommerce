import hashlib
import json
from uuid import uuid4

from psycopg import sql
from psycopg.types.json import Jsonb

from ..capacity.infrastructure import database_time, lock_capacity_dates
from ..capacity.order import bump_capacity_impact
from ..db import one, rows
from ..problems import Problem
from ..settlement.infrastructure import enqueue_work
from .domain import DAY, instant, local_day, missing, wire


def now_at(conn, clock):
    if clock is not None:
        value = clock()
        return instant(value) if isinstance(value, str) else value
    return instant(database_time(conn))


def lock_event(conn, event_id, *, account_id=None):
    query = "SELECT * FROM event_application WHERE id = %s"
    params = [event_id]
    if account_id is not None:
        query += " AND account_id = %s"
        params.append(account_id)
    event = one(conn, query + " FOR UPDATE", params)
    if event is None:
        raise missing()
    return event


def get_event(conn, event_id, account_id=None):
    if account_id is None:
        event = one(conn, "SELECT * FROM event_application WHERE id = %s", (event_id,))
    else:
        event = one(conn, "SELECT * FROM event_application WHERE id = %s AND account_id = %s", (event_id, account_id))
    if event is None:
        raise missing()
    return event


def submission(conn, actor_id, key, request, now, check):
    digest = hashlib.sha256(json.dumps(request, sort_keys=True, ensure_ascii=False).encode()).digest()
    # Shared command locking protects the usual replay path. The durable unique
    # constraint also protects replays when the short-lived receipt was pruned.
    existing = one(conn, """
        SELECT id, submission_digest FROM event_application WHERE account_id = %s AND submission_intent_id = %s
    """, (actor_id, key))
    if existing is not None:
        if existing["submission_digest"] != digest:
            raise Problem("IDEMPOTENCY_CONFLICT", 409, "Use a new key for a different event request.")
        return existing["id"], False

    check(request, now)
    event_id = uuid4()
    conn.execute("""
        INSERT INTO event_application
            (id, event_number, account_id, submission_intent_id, submission_digest, status, event_date,
             start_at, expected_end_at, setup_ready_at, request_snapshot, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, 'APPLIED', %s, %s, %s, %s, %s, %s, %s)
    """, (event_id, f"EV-{event_id.hex.upper()}", actor_id, key, digest, request["eventDate"], request["startAt"],
          request["expectedEndAt"], request["setupReadyAt"], Jsonb(request), now, now))
    return event_id, True


def list_events(conn, account_id, limit, cursor):
    if cursor is None:
        return rows(conn, """
            SELECT * FROM event_application WHERE account_id = %s
            ORDER BY created_at DESC, id DESC LIMIT %s
        """, (account_id, limit))
    return rows(conn, """
        SELECT * FROM event_application WHERE account_id = %s AND (created_at, id) < (%s, %s)
        ORDER BY created_at DESC, id DESC LIMIT %s
    """, (account_id, *cursor, limit))


def current_quote(conn, event_id):
    return one(conn, """
        SELECT * FROM event_quote WHERE event_id = %s ORDER BY version DESC LIMIT 1
    """, (event_id,))


def charges_for_event(conn, event_id, *, lock=False):
    query = "SELECT * FROM charge WHERE event_id = %s ORDER BY created_at, id"
    return rows(conn, query + (" FOR UPDATE" if lock else ""), (event_id,))


def resource_dates(start, end):
    first, last = local_day(start), local_day(end)
    return (first + DAY * offset for offset in range((last - first).days + 1))


def lock_windows(conn, event_id, replacement=None):
    current = rows(conn, """
        SELECT w.starts_at, w.ends_at FROM resource_window w JOIN event_quote q ON q.id = w.quote_id
        WHERE q.event_id = %s AND w.status IN ('HELD','BOOKED')
        UNION ALL
        SELECT resource_starts_at, resource_ends_at FROM event_schedule_change
        WHERE event_id = %s AND resource_status = 'BOOKED'
    """, (event_id, event_id))
    dates = {day for item in current for day in resource_dates(item["starts_at"], item["ends_at"])}
    if replacement is not None:
        dates.update(resource_dates(*replacement))
    lock_capacity_dates(conn, dates)
    return dates


def assert_window_available(conn, event_id, start, end):
    conflict = one(conn, """
        SELECT 1 FROM resource_window w JOIN event_quote q ON q.id = w.quote_id
         WHERE q.event_id <> %(event)s AND w.status IN ('HELD','BOOKED','USED')
           AND w.starts_at < %(end)s AND w.ends_at > %(start)s
        UNION ALL
        SELECT 1 FROM event_schedule_change
         WHERE event_id <> %(event)s AND resource_status IN ('BOOKED','USED')
           AND resource_starts_at < %(end)s AND resource_ends_at > %(start)s
        LIMIT 1
    """, {"event": event_id, "start": start, "end": end})
    if conflict is not None:
        raise Problem("CAPACITY_UNAVAILABLE", 409, "The resource window overlaps another event. Review the schedule.")


def change_windows(conn, event_id, state):
    """Lock dates under the parent lock and transition only unused/live windows."""
    before = {"BOOKED": ["HELD"], "RELEASED": ["HELD", "BOOKED"], "USED": ["BOOKED"]}[state]
    dates = lock_windows(conn, event_id)
    updated = conn.execute("""
        UPDATE resource_window w SET status = %s FROM event_quote q
        WHERE w.quote_id = q.id AND q.event_id = %s AND w.status = ANY(%s)
    """, (state, event_id, before)).rowcount
    if "BOOKED" in before:
        updated += conn.execute("""
            UPDATE event_schedule_change SET resource_status = %s
            WHERE event_id = %s AND resource_status = 'BOOKED'
        """, (state, event_id)).rowcount
    if updated:
        bump_window_revisions(conn, dates)
    return updated


def bump_window_revisions(conn, dates):
    bump_capacity_impact(conn, dates)


def update_event(conn, event_id, now, **fields):
    updates = sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(field)) for field in fields)
    return one(conn, sql.SQL("""
        UPDATE event_application SET version = version + 1, updated_at = %s, {}
        WHERE id = %s RETURNING *
    """).format(updates), (now, *fields.values(), event_id))


def set_quote_status(conn, quote, status):
    conn.execute("UPDATE event_quote SET status = %s WHERE id = %s", (status, quote["id"]))


def add_quote(conn, event, actor_id, previous, details, now, cutoff):
    quote_id = uuid4()
    quote_version = previous["version"] + 1 if previous else 1
    offered = details["schedule"]
    deposit = (details["totalMinor"] + 1) // 2
    conn.execute("""
        INSERT INTO event_quote
            (id, event_id, version, status, total_minor, deposit_minor, balance_minor,
             issued_at, deposit_due_at, balance_due_at, event_start_at, event_end_at, setup_ready_at,
             teardown_at, quote_snapshot, terms_version)
        VALUES (%s, %s, %s, 'OFFERED', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (quote_id, event["id"], quote_version, details["totalMinor"], deposit, details["totalMinor"] - deposit,
          now, cutoff, details["balanceDueAt"], offered["eventStartAt"], offered["eventEndAt"], offered["setupReadyAt"],
          offered["teardownAt"], Jsonb(details["snapshot"]), details["termsVersion"]))
    conn.execute("""
        INSERT INTO resource_window (quote_id, starts_at, ends_at, status, assessed_by, assessment_note, planned_staff)
        VALUES (%s, %s, %s, 'HELD', %s, %s, %s)
    """, (quote_id, *details["window"], actor_id, details["notes"], details["staffCount"]))
    return quote_id


def add_charge(conn, event_id, category, amount, due_at, now, *, quote_id=None, bill=None):
    charge_id = uuid4()
    conn.execute("""
        INSERT INTO charge (id, event_id, quote_id, category, state, expected_minor, due_at, bill_snapshot, created_at)
        VALUES (%s, %s, %s, %s, 'OPEN', %s, %s, %s, %s)
    """, (charge_id, event_id, quote_id, category, amount, due_at, Jsonb(bill) if bill is not None else None, now))
    return charge_id


def current_reschedule(conn, event_id):
    return one(conn, """
        SELECT * FROM event_schedule_change WHERE event_id = %s ORDER BY event_version DESC LIMIT 1
    """, (event_id,))


def add_reschedule(conn, event, quote, details, actor_id, now):
    consent = details["consent"]
    conn.execute("""
        INSERT INTO event_schedule_change
            (id, event_id, source_quote_id, event_version, schedule_snapshot, resource_starts_at, resource_ends_at,
             resource_status, obligation_disposition, balance_plan_snapshot, agreed_at, consent_reference,
             consent_channel, reason, recorded_by, recorded_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, 'BOOKED', %s, %s, %s, %s, %s, %s, %s, %s)
    """, (uuid4(), event["id"], quote["id"], event["version"] + 1, Jsonb(details["schedule"]), *details["window"],
          details["obligationDisposition"], Jsonb(details["balancePlan"]), consent["agreedAt"], consent["reference"],
          consent["channel"], details["reason"], actor_id, now))


def payment_evidence(conn, charge_ids, *, any_proof):
    if not charge_ids:
        return False
    return one(conn, """
        SELECT EXISTS(
            SELECT 1 FROM money_entry WHERE charge_id = ANY(%(ids)s::uuid[]) AND kind = 'RECEIPT'
            UNION ALL
            SELECT 1 FROM payment_proof WHERE charge_id = ANY(%(ids)s::uuid[]) AND (%(all)s OR state = 'REVIEW')
            UNION ALL
            SELECT 1 FROM settlement_case WHERE charge_id = ANY(%(ids)s::uuid[]) AND status = 'OPEN'
        ) AS evidence
    """, {"ids": charge_ids, "all": any_proof})["evidence"]


def equipment_ledger(conn, event_id):
    return rows(conn, "SELECT * FROM equipment_check WHERE event_id = %s ORDER BY equipment_id", (event_id,))


def record_audit(conn, actor_id, event_id, action, context, *, basis=None, change=None):
    conn.execute("""
        INSERT INTO audit_event (id, actor_id, feature, resource_id, action, occurred_at, request_id, reason_code, safe_change)
        VALUES (%s, %s, 'EVENT', %s, %s, clock_timestamp(), %s, %s, %s)
    """, (uuid4(), actor_id, event_id, action, context.request_id, basis, Jsonb(change or {})))


def notice(conn, event, milestone, now, *, not_before=None, revision=None, recipient_role="CUSTOMER", **safe):
    suffix = revision if revision is not None else event["version"]
    payload = {
        "milestone": milestone, "eventId": str(event["id"]), "reference": event["event_number"],
        "recipientRole": recipient_role, **safe,
    }
    if revision is not None:
        payload["revision"] = revision
    enqueue_work(
        conn, f"{milestone}:{event['id']}:{suffix}:{recipient_role}", "NOTICE", event["id"], not_before or now, now, payload,
    )


def enqueue_quote_work(conn, event, quote_id, quote_version, cutoff, now):
    payload = {"quoteId": str(quote_id), "deadline": wire(cutoff)}
    enqueue_work(conn, f"EVENT_QUOTE_EXPIRY:{quote_id}", "EVENT_QUOTE_EXPIRY", event["id"], cutoff, now, payload)
    notice(conn, event, "EVENT_QUOTE_EXPIRY_REMINDER", now, not_before=max(now, cutoff - DAY),
           revision=quote_version, **payload)


def command_outcome(conn, actor_id, operation, key):
    if operation == "submitEventRequest":
        row = one(conn, """
            SELECT id, created_at FROM event_application WHERE account_id = %s AND submission_intent_id = %s
        """, (actor_id, key))
    else:
        row = one(conn, """
            SELECT e.id, c.created_at FROM command_receipt c JOIN event_application e
              ON e.id::text = c.result_reference->>'eventId' AND e.account_id = c.actor_id
            WHERE c.actor_id = %s AND c.operation = %s AND c.idem_key = %s
        """, (actor_id, operation, key))
    if row is None:
        raise missing()
    return {"resourceType": "EVENT", "resourceId": str(row["id"]), "completedAt": wire(row["created_at"])}
