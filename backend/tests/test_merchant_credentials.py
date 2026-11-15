from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from secrets import token_urlsafe
from uuid import uuid4

import psycopg

from conftest import API, ORIGIN
from sweetcommerce.identity import infrastructure as store

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


def test_setup_link_requires_operator_enrollment_and_is_redeemable_once(client, db, dsns, clock, otp_messages):
    route = "registration/link"
    token = token_urlsafe(32)
    body = {"setupToken": token, "phone": PHONE, "registration": DETAILS}
    assert post(client, route, body).status_code == 403
    assert post(client, route, {"phone": PHONE, "registration": DETAILS}).status_code == 422
    with psycopg.connect(dsns["migration"], row_factory=psycopg.rows.dict_row) as connection:
        connection.execute("SET LOCAL search_path TO sweetcommerce")
        enrollment = store.enroll_merchant(connection, PHONE)
        store.replace_merchant_setup_link(connection, enrollment, token, clock.current + timedelta(minutes=30))

    assert post(client, route, {**body, "phone": "+60000000002"}).status_code == 403
    assert client.post(ADMIN_AUTH + route, headers={"Origin": "https://outside.example"}, json=body).status_code == 400
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = sorted(result.status_code for result in pool.map(lambda _: post(client, route, body), range(2)))
    assert statuses == [201, 403]
    with db.connection() as connection:
        assert connection.execute("SELECT count(*) AS count FROM account").fetchone()["count"] == 1
        assert connection.execute("SELECT count(*) AS count FROM merchant_setup_link").fetchone()["count"] == 0
    assert not otp_messages
    credentials = {"username": DETAILS["username"], "password": DETAILS["password"]}
    assert post(client, "password", credentials).json()["accountId"] == str(enrollment["id"])


def test_setup_link_rejects_replaced_expired_and_recovered_tokens(client, db, dsns, clock):
    route = "registration/link"
    body = {"phone": PHONE, "registration": DETAILS}
    previous, current = token_urlsafe(32), token_urlsafe(32)

    def issue_link(token):
        with psycopg.connect(dsns["migration"], row_factory=psycopg.rows.dict_row) as connection:
            connection.execute("SET LOCAL search_path TO sweetcommerce")
            enrollment = store.enroll_merchant(connection, PHONE)
            store.replace_merchant_setup_link(connection, enrollment, token, clock.current + timedelta(minutes=30))

    issue_link(previous)
    issue_link(current)
    assert post(client, route, {**body, "setupToken": previous}).status_code == 403
    clock.advance(minutes=30)
    assert post(client, route, {**body, "setupToken": current}).status_code == 403
    issue_link(current)
    recovery = challenge(client, "challenges", purpose="RECOVERY")
    assert post(client, "sign-in", recovery).status_code == 200
    assert post(client, route, {**body, "setupToken": current}).status_code == 403
    with db.connection() as connection:
        assert connection.execute("SELECT count(*) AS count FROM merchant_profile").fetchone()["count"] == 0
    recovery = challenge(client, "challenges", purpose="RECOVERY")
    assert post(client, "sign-in", recovery).status_code == 200
    assert post(client, "password", {"username": DETAILS["username"], "password": DETAILS["password"]}).status_code == 401
    clock.advance(minutes=15)
    code = challenge(client, "registration/challenges")
    assert post(client, "registration", {**code, "registration": DETAILS}).status_code == 201
