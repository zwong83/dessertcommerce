from uuid import uuid4

from conftest import API, ORIGIN

ADMIN_AUTH = API + "/admin/auth/"
PHONE = "+60000000001"
CODE = "123456"
DETAILS = {"name": "Gather Dessert", "username": "gather.merchant", "password": "Example8!", "email": "shop@example.test"}


def post(client, route, body):
    return client.post(ADMIN_AUTH + route, headers={"Origin": ORIGIN}, json=body)


def challenge(client, route, contact=PHONE, **body):
    response = post(client, route, {"verifiedContact": contact, **body})
    assert response.status_code == 201, response.text
    return {"challengeId": response.json()["challengeId"], "code": CODE}


def test_merchant_signup_requires_enrollment_and_cannot_replace_existing_credentials(client, db, otp_messages):
    setup = "registration/challenges"
    unowned = challenge(client, setup)
    assert post(client, "registration", {**unowned, "registration": DETAILS}).status_code == 422
    assert not otp_messages
    account = str(uuid4())
    with db.transaction() as connection:
        connection.execute("INSERT INTO account(id, role, phone_e164) VALUES (%s,'ADMIN',%s)", (account, PHONE))

    ordinary = challenge(client, "challenges")
    assert post(client, "registration", {**ordinary, "registration": DETAILS}).status_code == 422
    code = challenge(client, setup)
    assert post(client, "sign-in", code).status_code == 422
    assert post(client, "registration", {**code, "code": "000000", "registration": DETAILS}).status_code == 422
    created = post(client, "registration", {**code, "registration": DETAILS})
    assert created.status_code == 201, created.text
    assert (created.json()["role"], created.json()["accountId"]) == ("ADMIN", account)
    assert post(client, "registration", {**code, "registration": DETAILS}).status_code == 422
    assert post(client, "registration", {**challenge(client, setup), "registration": DETAILS}).status_code == 409
    credentials = {"username": DETAILS["username"].upper(), "password": DETAILS["password"]}
    login = post(client, "password", credentials)
    assert login.status_code == 200 and login.json()["role"] == "ADMIN"
    assert client.post(API + "/auth/customer/password", headers={"Origin": ORIGIN}, json=credentials).status_code == 401


def test_recovery_invalidates_the_merchant_password(client, db, clock):
    with db.transaction() as connection:
        connection.execute("INSERT INTO account(id, role, phone_e164) VALUES (%s,'ADMIN',%s)", (uuid4(), PHONE))
    code = challenge(client, "registration/challenges")
    assert post(client, "registration", {**code, "registration": DETAILS}).status_code == 201
    recovery = challenge(client, "challenges", purpose="RECOVERY")
    assert post(client, "sign-in", recovery).status_code == 200
    assert post(client, "password", {"username": DETAILS["username"], "password": DETAILS["password"]}).status_code == 401
    clock.advance(minutes=15)
    code = challenge(client, "registration/challenges")
    assert post(client, "registration", {**code, "registration": DETAILS}).status_code == 201
