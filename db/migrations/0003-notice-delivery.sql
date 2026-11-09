-- A worker may resolve only the contact for its currently fenced notice.
CREATE FUNCTION sweetcommerce.notice_recipient(work_key uuid, fence uuid)
RETURNS TABLE (phone text, email text, source_number text)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT a.phone_e164,
    CASE WHEN COALESCE(w.payload->>'recipientRole','CUSTOMER') IN ('ADMIN','MERCHANT')
      THEN a.recovery_email
      ELSE COALESCE(o.fulfilment_snapshot->>'notificationEmail', e.request_snapshot->>'notificationEmail')
    END,
    COALESCE(o.order_number,e.event_number)
  FROM sweetcommerce.durable_work w
  LEFT JOIN sweetcommerce.standard_order o ON o.id=w.resource_id
  LEFT JOIN sweetcommerce.event_application e ON e.id=w.resource_id
  JOIN sweetcommerce.account a ON a.status='ACTIVE' AND (
    (COALESCE(w.payload->>'recipientRole','CUSTOMER') IN ('ADMIN','MERCHANT') AND a.role='ADMIN')
    OR (COALESCE(w.payload->>'recipientRole','CUSTOMER')='CUSTOMER' AND a.role='CUSTOMER' AND a.id=COALESCE(o.account_id,e.account_id))
  )
  WHERE w.id=work_key AND w.lease_token=fence AND w.kind='NOTICE'
    AND w.work_state='LEASED' AND w.lease_until>statement_timestamp()
    AND COALESCE(o.id,e.id) IS NOT NULL
$$;
REVOKE ALL ON FUNCTION sweetcommerce.notice_recipient(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sweetcommerce.notice_recipient(uuid, uuid) TO sweetcommerce_worker;
GRANT UPDATE (outcome, safe_reason) ON notice_attempt TO sweetcommerce_worker;

-- A notice may read only the current outstanding amount and case for its own charge.
CREATE FUNCTION sweetcommerce.notice_payment_facts(work_key uuid, fence uuid, charge_key uuid)
RETURNS TABLE (expected_minor bigint, outstanding_minor bigint, case_id uuid)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT c.expected_minor,
    GREATEST(0, c.expected_minor - COALESCE(m.net,0))::bigint,
    mismatch.id
  FROM sweetcommerce.durable_work w
  JOIN sweetcommerce.charge c ON c.id=charge_key AND COALESCE(c.order_id,c.event_id)=w.resource_id
  LEFT JOIN LATERAL (
    SELECT SUM(CASE WHEN kind='RECEIPT' THEN amount_minor ELSE -amount_minor END) AS net
    FROM sweetcommerce.money_entry WHERE charge_id=c.id
  ) m ON true
  LEFT JOIN LATERAL (
    SELECT s.id FROM sweetcommerce.settlement_case s
    WHERE s.charge_id=c.id AND s.kind='AMOUNT_MISMATCH' AND s.status='OPEN'
      AND (w.payload->>'caseId' IS NULL OR s.id::text=w.payload->>'caseId')
    ORDER BY s.opened_at,s.id LIMIT 1
  ) mismatch ON true
  WHERE w.id=work_key AND w.lease_token=fence AND w.kind='NOTICE'
    AND w.work_state='LEASED' AND w.lease_until>statement_timestamp()
    AND w.payload->>'chargeId'=charge_key::text
    AND w.payload->>'milestone' IN ('STANDARD_TOP_UP','EVENT_SUPPLEMENT_REQUESTED')
$$;
REVOKE ALL ON FUNCTION sweetcommerce.notice_payment_facts(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sweetcommerce.notice_payment_facts(uuid, uuid, uuid) TO sweetcommerce_worker;
