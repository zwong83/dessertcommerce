from uuid import uuid4

from fastapi.testclient import TestClient

from conftest import API, ORIGIN
from sweetcommerce.api import create_app
from sweetcommerce.runtime import Settings


def post(client, path, body):
    return client.post(API + "/auth/customer/" + path, json=body, headers={"Origin": ORIGIN})


def challenge(client, intent, phone):
    result = post(client, "otp/challenges", {"intent": intent, "phone": phone})
    assert result.status_code == 201, result.text
    return {"intent": intent, "challengeId": result.json()["challengeId"], "code": "123456"}


def registration(username):
    return {"name": "Test Customer", "email": "customer@example.test", "username": username,
            "password": "Abcdef1!"}


def test_password_signup_preserves_verified_phone_ownership(client, db, sign_in, otp_messages):
    phone = "+60100001118"
    existing, _ = sign_in(phone=phone)
    otp_messages.clear()
    details = registration("Password.Customer")
    body = {"registration": details, "phone": phone}

    created = post(client, "registration", body)
    assert created.status_code == 201, created.text
    assert "HttpOnly" in created.headers["set-cookie"]
    account = created.json()["accountId"]
    assert account != existing["accountId"]
    assert not otp_messages
    assert post(client, "registration", body).status_code == 409
    with db.connection() as connection:
        assert connection.execute("SELECT count(*) AS n FROM account").fetchone()["n"] == 2
        assert connection.execute("""
            SELECT a.phone_e164, p.contact_phone FROM account a
            JOIN customer_profile p ON p.account_id = a.id WHERE a.id = %s
        """, (account,)).fetchone() == {"phone_e164": None, "contact_phone": phone}

    via_password = post(client, "password", {"username": details["username"], "password": details["password"]})
    via_phone = post(client, "otp/verify", challenge(client, "login", phone))
    assert via_password.json()["accountId"] == account
    assert via_phone.json()["accountId"] == existing["accountId"]


def test_password_signup_is_unavailable_when_phone_verification_is_required(db):
    settings = Settings("", b"\x07" * 32, ORIGIN, customer_phone_verification=True)
    with TestClient(create_app(settings, database=db), base_url=ORIGIN) as verified_client:
        response = post(verified_client, "registration", {
            "registration": registration("verified.customer"), "phone": "+60100001119",
        })
    assert response.status_code == 403


def test_signup_and_both_login_methods_share_a_verified_account(client, db):
    phone = "+60100001111"
    details = registration("Test.Customer")
    otp = challenge(client, "signup", phone)
    assert post(client, "otp/verify", {**otp, "intent": "login"}).status_code == 422
    assert post(client, "otp/verify", {**otp, "code": "000000", "registration": details}).status_code == 422
    with db.connection() as connection:
        assert connection.execute("SELECT count(*) AS n FROM customer_profile").fetchone()["n"] == 0
    signed_up = post(client, "otp/verify", {**otp, "registration": details})
    assert signed_up.status_code == 200, signed_up.text
    assert "HttpOnly" in signed_up.headers["set-cookie"]
    account = signed_up.json()["accountId"]
    profile_path = API + "/auth/customer/profile"
    cookie = signed_up.headers["set-cookie"].split(";", 1)[0]
    assert client.get(profile_path, headers={"Cookie": cookie}).json() == {"displayName": details["name"]}
    assert post(client, "otp/verify", {**otp, "registration": details}).status_code == 422
    with db.connection() as connection:
        profile = connection.execute("SELECT * FROM customer_profile WHERE account_id = %s", (account,)).fetchone()
        assert profile["username"] == "test.customer"
        assert profile["display_name"] == details["name"]
        assert profile["notification_email"] == details["email"]
        assert profile["password_hash"].startswith("$argon2id$")
        assert details["password"] not in profile["password_hash"]
    via_password = post(client, "password", {"username": "TEST.CUSTOMER", "password": details["password"]})
    via_phone = post(client, "otp/verify", challenge(client, "login", phone))
    assert via_password.status_code == via_phone.status_code == 200
    assert via_password.json()["accountId"] == via_phone.json()["accountId"] == account
    assert via_password.json()["role"] == "CUSTOMER"


def test_customer_profile_requires_the_owners_session(client, sign_in):
    path = API + "/auth/customer/profile"
    assert client.get(path).status_code == 401
    _, merchant = sign_in(role="ADMIN")
    assert client.get(path, headers=merchant).status_code == 403
    _, customer = sign_in()
    assert client.get(path, headers=customer).json() == {"displayName": None}


def test_signup_requires_every_password_rule(client):
    otp = challenge(client, "signup", "+60100001117")
    details = registration("password.rules")
    for password in ("Abcde1!", "ABCDEF1!", "abcdef1!", "Abcdefg!", "Abcdef1 ", "Abcdef1é"):
        response = post(client, "otp/verify", {**otp, "registration": {**details, "password": password}})
        assert response.status_code == 422
        assert "Use at least 8 characters" in response.json()["message"]
    assert post(client, "otp/verify", {**otp, "registration": details}).status_code == 200


def test_login_does_not_register_and_signup_preserves_existing_phone_account(client, db, sign_in, clock):
    phone = "+60100001112"
    assert post(client, "otp/verify", challenge(client, "login", phone)).status_code == 422
    with db.connection() as connection:
        assert connection.execute("SELECT id FROM account WHERE phone_e164 = %s", (phone,)).fetchone() is None
    legacy, _ = sign_in(phone=phone)
    otp = challenge(client, "signup", phone)
    first = post(client, "otp/verify", {**otp, "registration": registration("legacy.customer")})
    assert first.status_code == 200 and first.json()["accountId"] == legacy["accountId"]
    clock.advance(minutes=15)
    conflict = post(client, "otp/verify", {**challenge(client, "signup", phone), "registration": registration("different")})
    assert conflict.status_code == 409 and conflict.json()["code"] == "REGISTRATION_CONFLICT"


def test_legacy_phone_endpoint_does_not_create_an_account(client, db):
    phone = "+60100001116"
    headers = {"Origin": ORIGIN}
    started = client.post(API + "/auth/otp/challenges", json={"phone": phone}, headers=headers)
    assert started.status_code == 201
    response = client.post(API + "/auth/otp/verify", json={"challengeId": started.json()["challengeId"], "code": "123456"}, headers=headers)
    assert response.status_code == 422
    with db.connection() as connection:
        assert connection.execute("SELECT id FROM account WHERE phone_e164 = %s", (phone,)).fetchone() is None


def test_username_conflict_rolls_back_new_account_and_allows_correction(client, db):
    first = challenge(client, "signup", "+60100001113")
    assert post(client, "otp/verify", {**first, "registration": registration("shared.username")}).status_code == 200
    other_phone = "+60100001114"
    second = challenge(client, "signup", other_phone)
    assert post(client, "otp/verify", {**second, "registration": registration("SHARED.USERNAME")}).status_code == 409
    with db.connection() as connection:
        assert connection.execute("SELECT id FROM account WHERE phone_e164 = %s", (other_phone,)).fetchone() is None
    assert post(client, "otp/verify", {**second, "registration": registration("corrected.username")}).status_code == 200


def test_password_errors_are_generic_and_attempts_are_limited(client, clock):
    details = registration("known.customer")
    otp = challenge(client, "signup", "+60100001115")
    assert post(client, "otp/verify", {**otp, "registration": details}).status_code == 200
    wrong = {"username": details["username"], "password": "wrong"}
    known = post(client, "password", wrong)
    unknown = post(client, "password", {**wrong, "username": "u" + uuid4().hex[:20]})
    assert known.status_code == unknown.status_code == 401
    assert known.json()["code"] == unknown.json()["code"] == "CREDENTIALS_INVALID"
    assert known.json()["message"] == unknown.json()["message"]
    for _ in range(7):
        assert post(client, "password", wrong).status_code == 401
    limited = post(client, "password", {**wrong, "password": details["password"]})
    assert limited.status_code == 429 and "retry-after" in limited.headers
    clock.advance(minutes=15)
    assert post(client, "password", {**wrong, "password": details["password"]}).status_code == 200
