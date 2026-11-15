CREATE TABLE merchant_setup_link (
  account_id uuid PRIMARY KEY REFERENCES account(id),
  credential_epoch bigint NOT NULL,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL
);

GRANT SELECT, DELETE ON merchant_setup_link TO sweetcommerce_api;
