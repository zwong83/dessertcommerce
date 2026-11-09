-- Extend the existing schema without rewriting standard settlement facts.
CREATE TABLE event_application (
  id uuid PRIMARY KEY, event_number text NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES account(id),
  submission_intent_id uuid NOT NULL, submission_digest bytea NOT NULL,
  status text NOT NULL CHECK (status IN ('APPLIED','QUOTED','AWAITING_DEPOSIT','DEPOSIT_REVIEW','BOOKED','BALANCE_GRACE','PROCEEDING','EQUIPMENT_CHECK','ADDITIONAL_BILL','COMPLETED','EXPIRED','CANCELLED','DECLINED','EXCEPTION')),
  event_date date NOT NULL, start_at timestamptz NOT NULL,
  expected_end_at timestamptz NOT NULL, setup_ready_at timestamptz NOT NULL,
  request_snapshot jsonb NOT NULL, alternative_schedule jsonb, disposition_reason text,
  actual_setup_at timestamptz, actual_end_at timestamptz, actual_teardown_at timestamptz,
  booked_at timestamptz, effective_balance_due_at timestamptz, effective_balance_grace_ends_at timestamptz,
  balance_deadline_revision bigint NOT NULL DEFAULT 1 CHECK (balance_deadline_revision >= 1),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  UNIQUE (account_id, submission_intent_id),
  CHECK (start_at < expected_end_at AND setup_ready_at <= start_at)
);
CREATE INDEX event_owner_list ON event_application(account_id, created_at DESC, id DESC);
CREATE INDEX event_merchant_work ON event_application(status, updated_at, id);
CREATE TABLE event_quote (
  id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES event_application(id),
  version bigint NOT NULL CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('OFFERED','CUSTOMER_ACCEPTED','CONFIRMED','SUPERSEDED','EXPIRED','CANCELLED')),
  total_minor bigint NOT NULL CHECK (total_minor >= 2),
  deposit_minor bigint NOT NULL CHECK (deposit_minor > 0),
  balance_minor bigint NOT NULL CHECK (balance_minor > 0),
  issued_at timestamptz NOT NULL, deposit_due_at timestamptz NOT NULL,
  balance_due_at timestamptz NOT NULL,
  event_start_at timestamptz NOT NULL, event_end_at timestamptz NOT NULL,
  setup_ready_at timestamptz NOT NULL, teardown_at timestamptz NOT NULL,
  quote_snapshot jsonb NOT NULL, terms_version text NOT NULL,
  UNIQUE (event_id, version),
  UNIQUE (event_id, id),
  CHECK (deposit_minor + balance_minor = total_minor),
  CHECK (deposit_minor = total_minor / 2 + total_minor % 2),
  CHECK (issued_at < deposit_due_at AND deposit_due_at < balance_due_at),
  CHECK (setup_ready_at <= event_start_at AND event_start_at < event_end_at AND event_end_at <= teardown_at)
);
CREATE UNIQUE INDEX event_one_live_quote ON event_quote(event_id)
  WHERE status IN ('OFFERED','CUSTOMER_ACCEPTED','CONFIRMED');
CREATE INDEX event_quote_expiry ON event_quote(deposit_due_at, id)
  WHERE status IN ('OFFERED','CUSTOMER_ACCEPTED');
CREATE TABLE event_schedule_change (
  id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES event_application(id),
  source_quote_id uuid NOT NULL,
  event_version bigint NOT NULL CHECK (event_version >= 1),
  schedule_snapshot jsonb NOT NULL,
  resource_starts_at timestamptz NOT NULL, resource_ends_at timestamptz NOT NULL,
  resource_status text NOT NULL CHECK (resource_status IN ('BOOKED','RELEASED','USED')),
  obligation_disposition text NOT NULL CHECK (obligation_disposition IN ('KEEP_APPROVED_TERMS','OWNER_REVIEW_REQUIRED')),
  balance_plan_snapshot jsonb NOT NULL,
  agreed_at timestamptz NOT NULL, consent_reference text NOT NULL,
  consent_channel text NOT NULL CHECK (consent_channel IN ('PHONE','WHATSAPP','IN_PERSON')),
  reason text NOT NULL, recorded_by uuid NOT NULL REFERENCES account(id), recorded_at timestamptz NOT NULL,
  UNIQUE(event_id,event_version),
  FOREIGN KEY (event_id, source_quote_id) REFERENCES event_quote(event_id, id),
  CHECK (resource_starts_at < resource_ends_at)
);
CREATE UNIQUE INDEX one_booked_event_reschedule ON event_schedule_change(event_id) WHERE resource_status = 'BOOKED';
CREATE TABLE resource_window (
  quote_id uuid PRIMARY KEY REFERENCES event_quote(id),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('HELD','BOOKED','RELEASED','USED')),
  assessed_by uuid NOT NULL REFERENCES account(id), assessment_note text NOT NULL,
  planned_staff integer NOT NULL CHECK (planned_staff > 0),
  CHECK (starts_at < ends_at)
);
CREATE INDEX resource_overlap ON resource_window(starts_at, ends_at)
  WHERE status IN ('HELD','BOOKED');
CREATE TABLE equipment_check (
  event_id uuid NOT NULL REFERENCES event_application(id),
  equipment_id uuid NOT NULL, item_name text NOT NULL,
  taken integer NOT NULL CHECK (taken >= 0), taken_at timestamptz NOT NULL,
  returned integer CHECK (returned >= 0), damaged integer CHECK (damaged >= 0),
  lost integer CHECK (lost >= 0),
  checked_at timestamptz, checked_by uuid REFERENCES account(id),
  PRIMARY KEY (event_id, equipment_id),
  CHECK (checked_at IS NULL OR
    (num_nonnulls(returned, damaged, lost, checked_by) = 4 AND returned::bigint + lost = taken AND damaged <= returned))
);

ALTER TABLE charge
  ALTER COLUMN order_id DROP NOT NULL,
  ADD COLUMN event_id uuid REFERENCES event_application(id),
  ADD COLUMN quote_id uuid,
  ADD COLUMN bill_snapshot jsonb,
  DROP CONSTRAINT charge_category_check,
  ADD CONSTRAINT charge_category_check CHECK (
    category IN ('STANDARD','STANDARD_ADJUSTMENT','EVENT_DEPOSIT','EVENT_BALANCE','EVENT_EXTRA')),
  ADD CONSTRAINT charge_one_parent CHECK (num_nonnulls(order_id, event_id) = 1),
  ADD CONSTRAINT charge_category_parent CHECK (
    (category IN ('STANDARD','STANDARD_ADJUSTMENT')) = (order_id IS NOT NULL)),
  ADD CONSTRAINT charge_quote_required CHECK (
    (category IN ('EVENT_DEPOSIT','EVENT_BALANCE')) = (quote_id IS NOT NULL)),
  ADD CONSTRAINT charge_event_quote_fk FOREIGN KEY (event_id, quote_id) REFERENCES event_quote(event_id, id),
  ADD CONSTRAINT charge_event_amount CHECK (event_id IS NULL OR expected_minor > 0);

CREATE UNIQUE INDEX charge_quote_instalment ON charge(quote_id, category) WHERE quote_id IS NOT NULL;
CREATE UNIQUE INDEX charge_one_event_extra ON charge(event_id) WHERE category = 'EVENT_EXTRA';
CREATE INDEX charge_event ON charge(event_id, created_at, id);

ALTER TABLE settlement_case
  DROP CONSTRAINT settlement_case_kind_check,
  ADD CONSTRAINT settlement_case_kind_check CHECK (
    kind IN ('LATE_PROOF','AMOUNT_MISMATCH','TRANSFER_UNMATCHED',
             'STANDARD_FULFILMENT_INFEASIBLE','EVENT_FULFILMENT_INFEASIBLE'));

ALTER TABLE durable_work
  DROP CONSTRAINT durable_work_kind_check,
  ADD CONSTRAINT durable_work_kind_check CHECK (
    kind IN ('NOTICE','STANDARD_PROOF_EXPIRY','STANDARD_TOP_UP_EXPIRY','EVENT_QUOTE_EXPIRY','EVENT_BALANCE_DUE'));

GRANT SELECT, INSERT, UPDATE ON event_application, event_quote, event_schedule_change, resource_window, equipment_check
  TO sweetcommerce_api;

-- Event work reads only identifiers, timing and state. The worker cannot read event snapshots or evidence.
GRANT SELECT (id, status, version, effective_balance_due_at, effective_balance_grace_ends_at, balance_deadline_revision),
  UPDATE (status, version, updated_at) ON event_application TO sweetcommerce_worker;
GRANT SELECT (id, event_id, status, deposit_due_at), UPDATE (status) ON event_quote TO sweetcommerce_worker;
GRANT SELECT (quote_id, starts_at, ends_at, status), UPDATE (status) ON resource_window TO sweetcommerce_worker;
GRANT SELECT (event_id, quote_id) ON charge TO sweetcommerce_worker;
GRANT INSERT (id, event_key, kind, resource_id, work_state, not_before, payload, created_at)
  ON durable_work TO sweetcommerce_worker;

-- Keep settlement eligibility distinct from proof acceptance for reconciliation.
CREATE TABLE event_eligible_receipt (
  receipt_id uuid PRIMARY KEY REFERENCES money_entry(id),
  proof_id uuid NOT NULL UNIQUE REFERENCES payment_proof(id)
);
GRANT SELECT, INSERT ON event_eligible_receipt TO sweetcommerce_api;
