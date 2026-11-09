from base64 import urlsafe_b64encode
from hashlib import sha256
from hmac import compare_digest, digest
from secrets import token_bytes
from uuid import uuid4

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ..db import one
from .domain import OTP_ATTEMPTS


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
    conn.execute("SELECT pg_advisory_xact_lock(%s, %s)", (41021, 1 if role == "ADMIN" else 2))


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
    account = one(
        conn,
        "SELECT id FROM account WHERE role = 'CUSTOMER' AND status = 'ACTIVE' AND phone_e164 = %s",
        (phone,),
    )
    return account["id"] if account else None


def recover_admin(conn, account_id, now):
    conn.execute("UPDATE account SET credential_epoch = credential_epoch + 1 WHERE id = %s", (account_id,))
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
