from uuid import uuid4

from psycopg.types.json import Jsonb


def enqueue_work(conn, key, kind, resource_id, due, now, data):
    conn.execute("""
        INSERT INTO durable_work (id,event_key,kind,resource_id,work_state,not_before,payload,created_at)
        VALUES (%s,%s,%s,%s,'READY',%s,%s,%s)
        ON CONFLICT (event_key) DO NOTHING
    """, (uuid4(), key, kind, resource_id, due, Jsonb(data), now))


def milestone(conn, resource_id, name, version, now, *, recipient="CUSTOMER", **metadata):
    enqueue_work(
        conn, f"{name}:{resource_id}:{version}:{recipient}", "NOTICE", resource_id, now, now,
        {"milestone": name, "recipientRole": recipient, **metadata},
    )
