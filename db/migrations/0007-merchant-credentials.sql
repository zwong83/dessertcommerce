CREATE TABLE merchant_profile (
  account_id uuid PRIMARY KEY REFERENCES account(id),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  email text CHECK (length(email) BETWEEN 3 AND 254),
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9_.-]{2,31}$'),
  password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%')
);

GRANT SELECT, INSERT, DELETE ON merchant_profile TO sweetcommerce_api;

ALTER TABLE otp_challenge DROP CONSTRAINT otp_challenge_purpose_check;
ALTER TABLE otp_challenge ADD CONSTRAINT otp_challenge_purpose_check
  CHECK (purpose IN ('SIGN_IN','RECOVERY','CUSTOMER_LOGIN','CUSTOMER_SIGNUP','MERCHANT_SETUP'));
ALTER TABLE otp_challenge ADD CONSTRAINT otp_merchant_setup_role
  CHECK (purpose <> 'MERCHANT_SETUP' OR role = 'ADMIN');

ALTER TABLE customer_password_attempt DROP CONSTRAINT customer_password_attempt_operation_check;
ALTER TABLE customer_password_attempt ADD CONSTRAINT customer_password_attempt_operation_check
  CHECK (operation IN ('PASSWORD_SIGN_IN','PASSWORD_SIGN_UP','PASSWORD_CHANGE','MERCHANT_PASSWORD_SIGN_IN'));
