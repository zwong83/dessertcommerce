CREATE TABLE invoice_template (
  id integer PRIMARY KEY CHECK (id = 1),
  version integer NOT NULL CHECK (version > 0),
  draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object'),
  published_revision integer NOT NULL CHECK (published_revision > 0 AND published_revision <= version),
  published jsonb NOT NULL CHECK (jsonb_typeof(published) = 'object'),
  updated_by uuid REFERENCES account(id)
);

CREATE SEQUENCE event_invoice_number;

CREATE TABLE event_invoice (
  event_id uuid NOT NULL REFERENCES event_application(id),
  kind text NOT NULL CHECK (kind IN ('booking', 'extras')),
  number bigint NOT NULL UNIQUE CHECK (number > 0),
  template_revision integer NOT NULL CHECK (template_revision > 0),
  issued_at timestamptz NOT NULL,
  source jsonb NOT NULL CHECK (jsonb_typeof(source) = 'object'),
  pdf bytea CHECK (octet_length(pdf) > 0),
  PRIMARY KEY (event_id, kind)
);

CREATE FUNCTION protect_rendered_event_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.pdf IS NOT NULL OR NEW.pdf IS NULL THEN
    RAISE EXCEPTION 'An invoice PDF can only be set once' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_rendered_event_invoice
  BEFORE UPDATE OF pdf ON event_invoice
  FOR EACH ROW EXECUTE FUNCTION protect_rendered_event_invoice();

GRANT SELECT, INSERT, UPDATE ON invoice_template TO sweetcommerce_api;
GRANT SELECT, INSERT ON event_invoice TO sweetcommerce_api;
GRANT UPDATE (pdf) ON event_invoice TO sweetcommerce_api;
GRANT USAGE ON SEQUENCE event_invoice_number TO sweetcommerce_api;
