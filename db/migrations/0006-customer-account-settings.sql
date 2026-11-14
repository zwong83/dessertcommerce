ALTER TABLE customer_profile
  ALTER COLUMN username DROP NOT NULL,
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD CONSTRAINT customer_profile_credentials_pair CHECK ((username IS NULL) = (password_hash IS NULL)),
  ADD COLUMN username_changed_at timestamptz,
  ADD COLUMN avatar_webp bytea CHECK (octet_length(avatar_webp) BETWEEN 1 AND 262144),
  ADD COLUMN avatar_version uuid,
  ADD CONSTRAINT customer_profile_avatar_pair CHECK ((avatar_webp IS NULL) = (avatar_version IS NULL));

GRANT UPDATE (display_name, notification_email, username, password_hash, contact_phone,
              username_changed_at, avatar_webp, avatar_version) ON customer_profile TO sweetcommerce_api;

ALTER TABLE customer_password_attempt DROP CONSTRAINT customer_password_attempt_operation_check;
ALTER TABLE customer_password_attempt ADD CONSTRAINT customer_password_attempt_operation_check
  CHECK (operation IN ('PASSWORD_SIGN_IN', 'PASSWORD_SIGN_UP', 'PASSWORD_CHANGE'));
