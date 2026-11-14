from base64 import urlsafe_b64encode
from hashlib import sha256
from hmac import compare_digest, digest
from secrets import token_bytes
from uuid import uuid4

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from psycopg.errors import UniqueViolation

from ..db import one
from .domain import OTP_ATTEMPTS, PasswordAction, Role


def base64url(value: bytes) -> str:
    return urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _utf8(value: str) -> bytes:
    try:
        return value.encode()
    except UnicodeEncodeError:
        # Node encodes lone UTF-16 surrogates as the Unicode replacement character.
        return value.encode("utf-16-le", errors="surrogatepass").decode("utf-16-le", errors="replace").encode()


def token_hash(token: str) -> bytes:
    return sha256(_utf8(token)).digest()


class IdentityCrypto:
    def __init__(self, secret: bytes):
        if len(secret) != 32:
            raise ValueError("Identity key must contain 32 bytes.")
        self._secret = secret
        self._cipher = AESGCM(self._sign("key", "destination-v1"))

    def _sign(self, purpose: str, value: str) -> bytes:
        return digest(self._secret, _utf8(purpose + "\0" + value), "sha256")

    def destination_fingerprint(self, destination: str) -> bytes:
        return self._sign("destination", destination)

    def csrf_token(self, session: str) -> str:
        return base64url(self._sign("csrf", session))

    def username_fingerprint(self, username: str) -> bytes:
        return self._sign("password-attempt", username)

    def otp_verifier(self, challenge_id: str, code: str) -> bytes:
        return self._sign("otp", challenge_id + "\0" + code)

    def matches_otp(self, challenge_id: str, code: str, verifier: bytes) -> bool:
        return compare_digest(self.otp_verifier(challenge_id, code), verifier)

    def seal_destination(self, challenge_id: str, phone: str) -> bytes:
        nonce = token_bytes(12)
        encrypted = self._cipher.encrypt(nonce, _utf8(phone), _utf8(challenge_id))
        # The existing Node format places the authentication tag before the ciphertext.
        return nonce + encrypted[-16:] + encrypted[:-16]

    def open_destination(self, challenge_id: str, encoded: bytes) -> str:
        nonce, tag, data = encoded[:12], encoded[12:28], encoded[28:]
        return self._cipher.decrypt(nonce, data + tag, _utf8(challenge_id)).decode(errors="replace")


def lock_send_budget(conn, role):
    conn.execute("SELECT pg_advisory_xact_lock(%s, %s)", (41021, 1 if role == Role.ADMIN else 2))


def send_counts(conn, fingerprint, role, after):
    return one(
        conn,
        """SELECT count(*) FILTER (WHERE destination_fingerprint = %s) AS destination_count,
                  count(*) AS global_count
           FROM otp_challenge WHERE role = %s AND created_at > %s""",
        (fingerprint, role, after),
    )


def lock_admin(conn):
    return one(
        conn,
        """SELECT id, phone_e164, recovery_email, credential_epoch FROM account
           WHERE role = 'ADMIN' AND status = 'ACTIVE' FOR UPDATE""",
    )


def insert_challenge(conn, challenge_id, role, purpose, epoch, fingerprint, verifier, sealed, now, expiry):
    conn.execute(
        """INSERT INTO otp_challenge
           (id, role, purpose, enrollment_epoch, destination_fingerprint, verifier,
            customer_destination_cipher, created_at, expires_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (challenge_id, role, purpose, epoch, fingerprint, verifier, sealed, now, expiry),
    )


def lock_challenge(conn, challenge_id, role):
    return one(
        conn,
        """SELECT purpose, enrollment_epoch, destination_fingerprint, verifier,
                  customer_destination_cipher, expires_at, used_at, attempts
           FROM otp_challenge WHERE id = %s AND role = %s FOR UPDATE""",
        (challenge_id, role),
    )


def consume_challenge(conn, challenge_id, now):
    conn.execute(
        """UPDATE otp_challenge SET used_at = %s, customer_destination_cipher = NULL
           WHERE id = %s AND used_at IS NULL""",
        (now, challenge_id),
    )


def record_failed_attempt(conn, challenge_id, now):
    conn.execute(
        """UPDATE otp_challenge SET attempts = attempts + 1,
           used_at = CASE WHEN attempts + 1 >= %s THEN %s ELSE used_at END,
           customer_destination_cipher = CASE WHEN attempts + 1 >= %s THEN NULL
                                              ELSE customer_destination_cipher END
           WHERE id = %s""",
        (OTP_ATTEMPTS, now, OTP_ATTEMPTS, challenge_id),
    )


def resolve_customer(conn, phone):
    conn.execute(
        """INSERT INTO account (id, role, phone_e164) VALUES (%s,'CUSTOMER',%s)
           ON CONFLICT (phone_e164) WHERE role = 'CUSTOMER' DO NOTHING""",
        (uuid4(), phone),
    )
    return find_customer(conn, phone)


def find_customer(conn, phone):
    account = one(
        conn,
        "SELECT id FROM account WHERE role = 'CUSTOMER' AND status = 'ACTIVE' AND phone_e164 = %s",
        (phone,),
    )
    return account["id"] if account else None


def create_password_customer(conn):
    account_id = uuid4()
    conn.execute("INSERT INTO account (id, role) VALUES (%s, 'CUSTOMER')", (account_id,))
    return account_id


def insert_customer_profile(conn, account_id, registration, password_hash, *, contact_phone=None):
    try:
        with conn.transaction():
            return one(conn, """
                INSERT INTO customer_profile (account_id, display_name, notification_email, username, password_hash, contact_phone)
                VALUES (%s,%s,%s,%s,%s,%s)
                ON CONFLICT (account_id) DO UPDATE SET display_name = EXCLUDED.display_name,
                    notification_email = EXCLUDED.notification_email, username = EXCLUDED.username,
                    password_hash = EXCLUDED.password_hash, contact_phone = EXCLUDED.contact_phone
                WHERE customer_profile.password_hash IS NULL RETURNING account_id
            """, (account_id, registration.name, registration.email, registration.username, password_hash, contact_phone)) is not None
    except UniqueViolation:
        return False


def find_password_customer(conn, username):
    return one(conn, """
        SELECT a.id, p.password_hash FROM customer_profile p JOIN account a ON a.id = p.account_id
        WHERE p.username = %s AND a.role = 'CUSTOMER' AND a.status = 'ACTIVE'
    """, (username,))


def insert_merchant_profile(conn, account_id, registration, password_hash):
    return one(conn, """
        INSERT INTO merchant_profile (account_id, display_name, email, username, password_hash)
        VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING account_id
    """, (account_id, registration.name, registration.email, registration.username, password_hash)) is not None


def find_password_merchant(conn, username):
    return one(conn, """
        SELECT a.id, a.credential_epoch, p.password_hash FROM merchant_profile p JOIN account a ON a.id = p.account_id
        WHERE p.username = %s AND a.role = 'ADMIN' AND a.status = 'ACTIVE'
    """, (username,))


def find_customer_display_name(conn, account_id):
    profile = one(conn, "SELECT display_name FROM customer_profile WHERE account_id = %s", (account_id,))
    return profile["display_name"] if profile else None


def read_customer_profile(conn, account_id):
    return one(conn, """
        SELECT p.display_name, p.username, p.username_changed_at, p.avatar_version,
               COALESCE(p.contact_phone, a.phone_e164) AS phone, p.notification_email AS email
        FROM account a LEFT JOIN customer_profile p ON p.account_id = a.id
        WHERE a.id = %s AND a.role = 'CUSTOMER'
    """, (account_id,))


def ensure_customer_profile(conn, account_id, display_name):
    conn.execute("""
        INSERT INTO customer_profile (account_id, display_name) VALUES (%s, %s)
        ON CONFLICT (account_id) DO NOTHING
    """, (account_id, display_name))


def lock_customer_credentials(conn, account_id):
    return one(conn, """
        SELECT username, password_hash, username_changed_at FROM customer_profile
        WHERE account_id = %s FOR UPDATE
    """, (account_id,))


def update_customer_profile(conn, account_id, edit, username, changed_at):
    conn.execute("""
        UPDATE customer_profile SET display_name = %s, username = %s, username_changed_at = %s,
            contact_phone = COALESCE(%s, contact_phone),
            notification_email = CASE WHEN %s THEN %s::text ELSE notification_email END,
            avatar_webp = CASE WHEN %s THEN %s::bytea ELSE avatar_webp END,
            avatar_version = CASE WHEN %s THEN %s::uuid ELSE avatar_version END
        WHERE account_id = %s
    """, (edit.display_name, username, changed_at, edit.contact_phone, edit.update_email, edit.email,
          edit.replace_avatar, edit.avatar,
          edit.replace_avatar, uuid4() if edit.avatar is not None else None, account_id))


def read_customer_avatar(conn, account_id):
    result = one(conn, "SELECT avatar_webp FROM customer_profile WHERE account_id = %s", (account_id,))
    return result["avatar_webp"] if result else None


def customer_password_hash(conn, account_id):
    result = one(conn, "SELECT password_hash FROM customer_profile WHERE account_id = %s", (account_id,))
    return result["password_hash"] if result else None


def update_customer_password(conn, account_id, expected_hash, new_hash):
    return one(conn, """
        UPDATE customer_profile SET password_hash = %s
        WHERE account_id = %s AND password_hash = %s RETURNING account_id
    """, (new_hash, account_id, expected_hash)) is not None


_PASSWORD_BUDGET_LOCKS = {
    PasswordAction.SIGN_IN: 3, PasswordAction.SIGN_UP: 4, PasswordAction.CHANGE: 5, PasswordAction.MERCHANT_SIGN_IN: 6,
}


def lock_password_budget(conn, operation: PasswordAction):
    conn.execute("SELECT pg_advisory_xact_lock(%s,%s)", (41021, _PASSWORD_BUDGET_LOCKS[operation]))


def password_counts(conn, operation, bucket, fingerprint):
    return one(conn, """
        SELECT COALESCE(sum(attempts), 0) AS total,
               COALESCE(sum(attempts) FILTER (WHERE username_fingerprint = %s), 0) AS for_username
        FROM customer_password_attempt WHERE operation = %s AND bucket = %s
    """, (fingerprint, operation, bucket))


def record_password_attempt(conn, operation, bucket, fingerprint):
    conn.execute("DELETE FROM customer_password_attempt WHERE operation = %s AND bucket < %s", (operation, bucket))
    conn.execute("""
        INSERT INTO customer_password_attempt (operation, bucket, username_fingerprint, attempts) VALUES (%s,%s,%s,1)
        ON CONFLICT (operation, bucket, username_fingerprint)
        DO UPDATE SET attempts = customer_password_attempt.attempts + 1
    """, (operation, bucket, fingerprint))


def recover_admin(conn, account_id, now):
    conn.execute("UPDATE account SET credential_epoch = credential_epoch + 1 WHERE id = %s", (account_id,))
    conn.execute("DELETE FROM merchant_profile WHERE account_id = %s", (account_id,))
    conn.execute(
        "UPDATE session SET revoked_at = %s WHERE account_id = %s AND revoked_at IS NULL",
        (now, account_id),
    )


def insert_session(conn, token, account_id, csrf_token, now, expiry):
    conn.execute(
        """INSERT INTO session (token_hash, account_id, csrf_hash, created_at, expires_at)
           VALUES (%s,%s,%s,%s,%s)""",
        (token_hash(token), account_id, token_hash(csrf_token), now, expiry),
    )


def audit_sign_in(conn, account_id, purpose, now, challenge_id):
    conn.execute(
        """INSERT INTO audit_event (id, actor_id, feature, resource_id, action, occurred_at, request_id)
           VALUES (%s,%s,'identity',%s,%s,%s,%s)""",
        (uuid4(), account_id, account_id, purpose, now, challenge_id),
    )


def find_session(conn, token, now):
    return one(
        conn,
        """SELECT s.account_id, a.role, s.csrf_hash, s.expires_at
           FROM session s JOIN account a ON a.id = s.account_id
           WHERE s.token_hash = %s AND s.revoked_at IS NULL AND s.expires_at > %s AND a.status = 'ACTIVE'""",
        (token_hash(token), now),
    )


def revoke_session(conn, token, now):
    conn.execute(
        "UPDATE session SET revoked_at = %s WHERE token_hash = %s AND revoked_at IS NULL",
        (now, token_hash(token)),
    )


def revoke_other_sessions(conn, account_id, token, now):
    conn.execute("""
        UPDATE session SET revoked_at = %s
        WHERE account_id = %s AND revoked_at IS NULL AND token_hash <> %s
    """, (now, account_id, token_hash(token)))
