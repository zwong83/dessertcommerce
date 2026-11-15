from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from cryptography.exceptions import InvalidTag

from sweetcommerce.db import one
from sweetcommerce.http import SESSION_COOKIE, Problem
from sweetcommerce.identity import IdentityService
from sweetcommerce.identity.domain import is_eligible_challenge
from sweetcommerce.identity.infrastructure import IdentityCrypto, token_hash

# These vectors come from tests/legacy-backend/identity/crypto.ts with a synthetic key.
KEY = bytes([9]) * 32
CHALLENGE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
PHONE = "+60100001234"
TOKEN = "A" * 43
CSRF = "lkJlnbV7QtsRDovAm348lKfafg5Iy6HN9IM7xkNnolQ"
CIPHERTEXT = bytes.fromhex("c97cd9bd593791ce90827c8b62b10f910e5491dc90048d0ca905e3f79c8f8b7eda468103742b2541")
FINGERPRINT = bytes.fromhex("224cd4cd1bcbc7a7ef918d06854d0400930887cbee64a1ec7485bcf589d0f44e")
VERIFIER = bytes.fromhex("dfe00080201095014d3e747cce3a2e4ccd685db283d8baf7e4d1f14246c4fe1e")
TOKEN_HASH = bytes.fromhex("0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a")
CSRF_HASH = bytes.fromhex("c4e5efcbed4a87f9f80c5028c509a97daab4320a52bdc89c91a5215dcf319130")
NOW = datetime(2030, 1, 1, tzinfo=UTC)
CODE = "123456"


def test_legacy_crypto_vectors_and_challenge_binding():
    crypto = IdentityCrypto(KEY)
    assert crypto.destination_fingerprint(PHONE) == FINGERPRINT
    assert crypto.otp_verifier(CHALLENGE_ID, CODE) == VERIFIER
    assert crypto.matches_otp(CHALLENGE_ID, CODE, VERIFIER)
    assert not crypto.matches_otp(CHALLENGE_ID, "222222", VERIFIER)
    assert not crypto.matches_otp(str(uuid4()), CODE, VERIFIER)
    assert crypto.csrf_token(TOKEN) == CSRF
    assert crypto.csrf_token("B" * 43) != CSRF
    assert token_hash(TOKEN) == TOKEN_HASH
    assert token_hash(CSRF) == CSRF_HASH

    assert crypto.open_destination(CHALLENGE_ID, CIPHERTEXT) == PHONE
    sealed = crypto.seal_destination(CHALLENGE_ID, PHONE)
    assert sealed != crypto.seal_destination(CHALLENGE_ID, PHONE)
    assert PHONE.encode() not in sealed
    assert crypto.open_destination(CHALLENGE_ID, sealed) == PHONE
    with pytest.raises(InvalidTag):
        crypto.open_destination(str(uuid4()), sealed)


def test_challenge_policy_rejects_used_expired_and_exhausted_codes():
    before = NOW - timedelta(milliseconds=1)
    assert is_eligible_challenge(NOW, None, 4, before)
    assert not is_eligible_challenge(NOW, None, 4, NOW)
    assert not is_eligible_challenge(NOW, NOW, 4, before)
    assert not is_eligible_challenge(NOW, None, 5, before)


def test_can_read_legacy_session_and_verify_legacy_challenge(db):
    account_id = uuid4()
    expiry = NOW + timedelta(hours=1)
    with db.transaction() as conn:
        conn.execute("INSERT INTO account (id, role, phone_e164) VALUES (%s,'CUSTOMER',%s)", (account_id, PHONE))
        conn.execute(
            "INSERT INTO session (token_hash, account_id, csrf_hash, created_at, expires_at) VALUES (%s,%s,%s,%s,%s)",
            (TOKEN_HASH, account_id, CSRF_HASH, NOW, expiry),
        )
        conn.execute(
            """INSERT INTO otp_challenge
               (id, role, destination_fingerprint, verifier, customer_destination_cipher, created_at, expires_at)
               VALUES (%s,'CUSTOMER',%s,%s,%s,%s,%s)""",
            (CHALLENGE_ID, FINGERPRINT, VERIFIER, CIPHERTEXT, NOW, NOW + timedelta(minutes=5)),
        )
    service = IdentityService(db, KEY, lambda message: None, clock=lambda: NOW)
    session = service.get_session(TOKEN, "CUSTOMER", CSRF)
    assert (session.account_id, session.csrf_token, session.expires_at) == (str(account_id), CSRF, expiry)
    with pytest.raises(Problem, match="Refresh your session"):
        service.get_session(TOKEN, "CUSTOMER", None)
    new_token, new_session = service.verify("CUSTOMER", CHALLENGE_ID, CODE)
    assert new_session.account_id == str(account_id)
    assert service.get_session(new_token) == new_session
    service.logout(TOKEN, CSRF)
    with pytest.raises(Problem) as revoked:
        service.get_session(TOKEN)
    assert revoked.value.code == "UNAUTHENTICATED"
    assert service.get_session(new_token) == new_session


def test_customer_challenge_http_is_private_role_bound_and_single_use(db, client):
    origin = {"Origin": str(client.base_url).rstrip("/")}
    path = "/api/v1/auth/otp"
    phone = "+60100001291"
    with db.transaction() as conn:
        conn.execute("INSERT INTO account (id, role, phone_e164) VALUES (%s,'CUSTOMER',%s)", (uuid4(), phone))
    denied = client.post(f"{path}/challenges", json={"phone": phone})
    assert (denied.status_code, denied.json()["code"]) == (400, "ORIGIN_DENIED")
    malformed = client.post(f"{path}/challenges", headers=origin, json={"phone": phone + "\n"})
    assert (malformed.status_code, malformed.json()["code"]) == (422, "VALIDATION")
    response = client.post(f"{path}/challenges", headers=origin, json={"phone": phone})
    assert response.status_code == 201
    challenge = response.json()
    assert set(challenge) == {"challengeId", "expiresAt", "resendAt"}
    assert datetime.fromisoformat(challenge["expiresAt"]) - datetime.fromisoformat(challenge["resendAt"]) == timedelta(minutes=4)
    with db.connection() as conn:
        stored = one(
            conn, "SELECT verifier, customer_destination_cipher FROM otp_challenge WHERE id = %s",
            (challenge["challengeId"],),
        )
    assert phone.encode() not in stored["customer_destination_cipher"]
    assert CODE.encode() not in stored["verifier"]

    payload = {"challengeId": challenge["challengeId"], "code": CODE}
    wrong_role = client.post("/api/v1/admin/auth/sign-in", headers=origin, json=payload)
    assert (wrong_role.status_code, wrong_role.json()["code"]) == (422, "OTP_INVALID")
    with ThreadPoolExecutor(max_workers=2) as workers:
        verification = [
            workers.submit(client.post, f"{path}/verify", headers=origin, json=payload) for _ in range(2)
        ]
        results = sorted((attempt.result() for attempt in verification), key=lambda result: result.status_code)
    success, rejected = results
    assert [result.status_code for result in results] == [200, 422]
    assert rejected.json()["code"] == "OTP_INVALID"
    session = success.json()
    assert set(session) == {"accountId", "role", "csrfToken", "expiresAt"}
    assert session["role"] == "CUSTOMER"
    raw_cookie = success.headers["set-cookie"]
    assert raw_cookie.startswith(f"{SESSION_COOKIE}=")
    assert "; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=" in raw_cookie
    headers = {**origin, "Cookie": raw_cookie.split(";")[0]}
    assert client.get("/api/v1/session", headers=headers).json() == session
    no_csrf = client.post("/api/v1/session/logout", headers=headers)
    assert (no_csrf.status_code, no_csrf.json()["code"]) == (403, "FORBIDDEN")
    logged_out = client.post("/api/v1/session/logout", headers={**headers, "X-CSRF-Token": session["csrfToken"]})
    assert logged_out.status_code == 204 and logged_out.content == b""
    assert logged_out.headers["set-cookie"] == f"{SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
    assert client.get("/api/v1/session", headers=headers).status_code == 401
    with db.connection() as conn:
        stored = one(
            conn, "SELECT used_at, customer_destination_cipher FROM otp_challenge WHERE id = %s",
            (challenge["challengeId"],),
        )
    assert stored["used_at"] is not None
    assert stored["customer_destination_cipher"] is None

    for _ in range(2):
        assert client.post(f"{path}/challenges", headers=origin, json={"phone": phone}).status_code == 201
    throttled = client.post(f"{path}/challenges", headers=origin, json={"phone": phone})
    assert (throttled.status_code, throttled.json()["code"], throttled.headers["retry-after"]) == (429, "RATE_LIMITED", "900")


def test_otp_expiry_attempts_send_budget_and_provider_failure(db):
    current = NOW
    sent = []
    service = IdentityService(db, KEY, sent.append, clock=lambda: current, new_code=lambda: CODE)
    expired = service.start("CUSTOMER", "+60100001235")
    assert sent[-1] == {"destination": "+60100001235", "code": CODE, "role": "CUSTOMER", "purpose": "SIGN_IN"}
    current += timedelta(minutes=5)
    with pytest.raises(Problem) as failure:
        service.verify("CUSTOMER", expired["challengeId"], CODE)
    assert failure.value.code == "OTP_INVALID"

    destination = "+60100001236"
    challenged = service.start("CUSTOMER", destination)
    for _ in range(5):
        with pytest.raises(Problem) as failure:
            service.verify("CUSTOMER", challenged["challengeId"], "111111")
        assert failure.value.code == "OTP_INVALID"
    with pytest.raises(Problem, match="could not be verified"):
        service.verify("CUSTOMER", challenged["challengeId"], CODE)
    service.start("CUSTOMER", destination)
    service.start("CUSTOMER", destination)
    with pytest.raises(Problem) as throttled:
        service.start("CUSTOMER", destination)
    assert (throttled.value.code, throttled.value.retry_after) == ("RATE_LIMITED", 900)

    limited = IdentityService(db, KEY, sent.append, clock=lambda: current, global_send_limit=1)
    with pytest.raises(Problem) as throttled:
        limited.start("CUSTOMER", "+60100001237")
    assert throttled.value.code == "RATE_LIMITED"

    def unavailable(_message):
        raise RuntimeError("synthetic delivery failure")

    failed_destination = "+60100001238"
    failed = IdentityService(db, KEY, unavailable, clock=lambda: current, new_code=lambda: CODE)
    with pytest.raises(Problem) as delivery:
        failed.start("CUSTOMER", failed_destination)
    assert (delivery.value.status, delivery.value.code) == (503, "DEPENDENCY_UNAVAILABLE")
    with db.connection() as conn:
        for phone, attempts in ((destination, 5), (failed_destination, 0)):
            row = one(
                conn,
                """SELECT id, attempts, used_at, customer_destination_cipher FROM otp_challenge
                   WHERE destination_fingerprint = %s AND used_at IS NOT NULL""",
                (IdentityCrypto(KEY).destination_fingerprint(phone),),
            )
            assert row["attempts"] == attempts and row["used_at"] == current
            assert row["customer_destination_cipher"] is None
        assert one(conn, "SELECT id FROM account WHERE phone_e164 IN (%s,%s,%s)", (
            "+60100001235", destination, failed_destination,
        )) is None


def test_admin_enrollment_and_recovery_revoke_old_sessions_and_codes(db, client):
    account_id = uuid4()
    phone = "+60100001901"
    email = "Owner@example.test"
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO account (id,role,phone_e164,recovery_email) VALUES (%s,'ADMIN',%s,%s)",
            (account_id, phone, email),
        )

    origin = {"Origin": str(client.base_url).rstrip("/")}
    auth = "/api/v1/admin/auth"

    def challenge(contact, **fields):
        result = client.post(f"{auth}/challenges", headers=origin, json={"verifiedContact": contact, **fields})
        assert result.status_code == 201
        return result.json()["challengeId"]

    def sign_in(challenge_id):
        return client.post(f"{auth}/sign-in", headers=origin, json={"challengeId": challenge_id, "code": CODE})

    login = sign_in(challenge(phone))
    assert login.status_code == 200
    old_cookie = login.headers["set-cookie"].split(";")[0]
    assert login.json()["accountId"] == str(account_id)
    assert login.json()["role"] == "ADMIN"
    stale = challenge(phone)
    unknown = challenge("stranger@example.test")
    with db.connection() as conn:
        assert one(conn, "SELECT id FROM otp_challenge WHERE id = %s", (unknown,)) is None
    assert sign_in(unknown).status_code == 422

    recovered = sign_in(challenge(" owner@example.test ", purpose="RECOVERY"))
    assert recovered.status_code == 200
    assert recovered.json()["accountId"] == str(account_id)
    assert client.get("/api/v1/session", headers={"Cookie": old_cookie}).status_code == 401
    assert sign_in(stale).status_code == 422
    new_cookie = recovered.headers["set-cookie"].split(";")[0]
    assert client.get("/api/v1/cart", headers={"Cookie": new_cookie}).status_code == 403
    with db.connection() as conn:
        assert one(conn, "SELECT credential_epoch FROM account WHERE id = %s", (account_id,))["credential_epoch"] == 2
        assert one(conn, "SELECT count(*) AS count FROM audit_event WHERE actor_id = %s AND action = 'RECOVERY'", (
            account_id,
        ))["count"] == 1
