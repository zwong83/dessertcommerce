-- A password account stores its unverified contact separately from its phone login identity.
ALTER TABLE account DROP CONSTRAINT account_check, DROP CONSTRAINT account_check1;
ALTER TABLE account ADD CONSTRAINT account_admin_contact_required
  CHECK (role <> 'ADMIN' OR phone_e164 IS NOT NULL OR recovery_email IS NOT NULL);

ALTER TABLE customer_profile ADD COLUMN contact_phone text
  CHECK (contact_phone ~ '^\+[1-9][0-9]{7,14}$');

ALTER TABLE customer_password_attempt
  ADD COLUMN operation text NOT NULL DEFAULT 'PASSWORD_SIGN_IN'
    CHECK (operation IN ('PASSWORD_SIGN_IN', 'PASSWORD_SIGN_UP')),
  DROP CONSTRAINT customer_password_attempt_pkey,
  ADD PRIMARY KEY (operation, bucket, username_fingerprint);
