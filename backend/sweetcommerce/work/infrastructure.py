from ..db import rows


def list_work(conn, filters, cursor, limit):
    kind, status, service_date = filters
    before, item_id = cursor or (None, None)
    return rows(conn, """
        WITH work AS (
          SELECT o.id, 'ORDER'::text AS kind, o.status, o.order_number AS number, o.updated_at,
            o.service_date, o.id AS order_id, NULL::uuid AS event_id, c.id AS charge_id,
            NULL::text AS notice_outcome
          FROM standard_order o LEFT JOIN charge c ON c.order_id = o.id AND c.category = 'STANDARD'
          UNION ALL
          SELECT e.id,'EVENT',e.status,e.event_number,e.updated_at,e.event_date,
            NULL::uuid,e.id,NULL::uuid,NULL::text
          FROM event_application e
          UNION ALL
          SELECT p.id,'PROOF',p.state,COALESCE(o.order_number,e.event_number),COALESCE(p.reviewed_at,p.received_at),
            COALESCE(o.service_date,e.event_date),o.id,e.id,c.id,NULL::text
          FROM payment_proof p JOIN charge c ON c.id=p.charge_id
          LEFT JOIN standard_order o ON o.id=c.order_id LEFT JOIN event_application e ON e.id=c.event_id
          UNION ALL
          SELECT s.id,'PAYMENT_EXCEPTION',s.status,COALESCE(o.order_number,e.event_number),COALESCE(s.resolved_at,s.opened_at),
            COALESCE(o.service_date,e.event_date),o.id,e.id,c.id,NULL::text
          FROM settlement_case s JOIN charge c ON c.id=s.charge_id
          LEFT JOIN standard_order o ON o.id=c.order_id LEFT JOIN event_application e ON e.id=c.event_id
          UNION ALL
          SELECT r.id,'PAYMENT_EXCEPTION',r.status,COALESCE(o.order_number,e.event_number),r.updated_at,
            COALESCE(o.service_date,e.event_date),o.id,e.id,c.id,NULL::text
          FROM refund_intent r JOIN money_entry m ON m.id=r.receipt_id JOIN charge c ON c.id=m.charge_id
          LEFT JOIN standard_order o ON o.id=c.order_id LEFT JOIN event_application e ON e.id=c.event_id
          UNION ALL
          SELECT n.id,'NOTICE',CASE WHEN follow.work_id IS NOT NULL THEN 'RESOLVED' ELSE n.work_state END,
            COALESCE(o.order_number,e.event_number),COALESCE(follow.resolved_at,attempt.attempted_at,n.created_at),
            COALESCE(o.service_date,e.event_date),o.id,e.id,
            CASE WHEN n.payload->>'chargeId' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                 THEN (n.payload->>'chargeId')::uuid END, attempt.outcome
          FROM durable_work n LEFT JOIN standard_order o ON o.id=n.resource_id
          LEFT JOIN event_application e ON e.id=n.resource_id
          LEFT JOIN notice_followup follow ON follow.work_id=n.id
          LEFT JOIN LATERAL (
            SELECT outcome,attempted_at FROM notice_attempt a
            WHERE a.work_id=n.id ORDER BY attempt_no DESC LIMIT 1
          ) attempt ON true
          WHERE n.kind='NOTICE' AND COALESCE(o.id,e.id) IS NOT NULL
        )
        SELECT id,kind,status,number,updated_at,order_id,event_id,charge_id,notice_outcome FROM work
        WHERE (%(kind)s::text IS NULL OR kind = %(kind)s)
          AND (%(status)s::text IS NULL OR status = %(status)s)
          AND (%(date)s::date IS NULL OR service_date = %(date)s)
          AND (%(before)s::timestamptz IS NULL OR (updated_at,id) < (%(before)s,%(id)s::uuid))
        ORDER BY updated_at DESC,id DESC LIMIT %(limit)s
    """, {"kind": kind, "status": status, "date": service_date, "before": before, "id": item_id, "limit": limit})
