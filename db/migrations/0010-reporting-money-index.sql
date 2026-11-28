-- Match the date-range access path used by verified-money reporting.
CREATE INDEX money_report_date ON money_entry(occurred_at, id)
  INCLUDE (charge_id, kind, amount_minor);
