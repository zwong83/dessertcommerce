-- Keep verified phone ownership on account; add credentials only for customers who register.
ALTER TABLE otp_challenge DROP CONSTRAINT otp_challenge_purpose_check;
ALTER TABLE otp_challenge ADD CONSTRAINT otp_challenge_purpose_check
  CHECK (purpose IN ('SIGN_IN','RECOVERY','CUSTOMER_LOGIN','CUSTOMER_SIGNUP'));
ALTER TABLE otp_challenge ADD CONSTRAINT otp_customer_intent_role
  CHECK (purpose NOT IN ('CUSTOMER_LOGIN','CUSTOMER_SIGNUP') OR role = 'CUSTOMER');

CREATE TABLE customer_profile (
  account_id uuid PRIMARY KEY REFERENCES account(id),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  notification_email text CHECK (length(notification_email) BETWEEN 3 AND 254),
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9_.-]{2,31}$'),
  password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%')
);

CREATE TABLE customer_password_attempt (
  bucket timestamptz NOT NULL,
  username_fingerprint bytea NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  PRIMARY KEY (bucket, username_fingerprint)
);

GRANT SELECT, INSERT ON customer_profile TO sweetcommerce_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_password_attempt TO sweetcommerce_api;
