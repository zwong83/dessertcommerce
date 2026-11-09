import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql

from sweetcommerce.api import create_app
from sweetcommerce.db import Database
from sweetcommerce.migrate import migrate
from sweetcommerce.runtime import Settings

ORIGIN = "https://shop.example.test"
API = "/api/v1"


@pytest.fixture(scope="session")
def dsns():
    names = {"migration": "SC_TEST_MIGRATION_DSN", "api": "SC_TEST_API_DSN", "worker": "SC_TEST_WORKER_DSN"}
    if not all(os.environ.get(value) for value in names.values()):
        pytest.fail("Run PostgreSQL tests with node_modules/.bin/tsx scripts/test-python.ts")
    return {role: os.environ[variable] for role, variable in names.items()}


@pytest.fixture(scope="session")
def applied(dsns):
    return migrate(dsns["migration"])


@pytest.fixture
def db(dsns, applied):
    with psycopg.connect(dsns["migration"]) as connection:
        tables = connection.execute("""
            SELECT tablename FROM pg_tables
             WHERE schemaname='sweetcommerce' AND tablename <> 'schema_migration'
        """).fetchall()
        connection.execute(sql.SQL("TRUNCATE {}").format(
            sql.SQL(", ").join(sql.Identifier("sweetcommerce", name) for (name,) in tables)
        ))
    database = Database(dsns["api"])
    database.open()
    try:
        yield database
    finally:
        database.close()


@pytest.fixture
def worker_db(db, dsns):
    database = Database(dsns["worker"], max_size=4)
    database.open()
    try:
        yield database
    finally:
        database.close()


@dataclass
class Clock:
    current: datetime = datetime(2030, 1, 1, tzinfo=UTC)

    def __call__(self):
        return self.current

    def advance(self, milliseconds=0, **units):
        self.current += timedelta(milliseconds=milliseconds, **units)


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def otp_messages():
    return []


class MemoryObjects:
    def __init__(self):
        self.objects = {}

    def put(self, key, data):
        assert key not in self.objects
        self.objects[key] = data

    def get(self, key):
        return self.objects.get(key)


@pytest.fixture
def client(db, clock, otp_messages):
    settings = Settings("", b"\x07" * 32, ORIGIN, synthetic_otp="123456")
    app = create_app(settings, database=db, clock=clock, delivery=otp_messages.append, objects=MemoryObjects())
    with TestClient(app, base_url=ORIGIN) as http:
        yield http


@pytest.fixture
def sign_in(client, db):
    def login(role="CUSTOMER", phone=None, purpose=None):
        if phone is None:
            phone = "+601" + str(uuid4().int % 10**8).zfill(8)
        if role == "ADMIN":
            with db.transaction() as connection:
                connection.execute("INSERT INTO account (id, role, phone_e164) VALUES (%s, 'ADMIN', %s)", (uuid4(), phone))
            start, verify = "/admin/auth/challenges", "/admin/auth/sign-in"
            body = {"verifiedContact": phone}
            if purpose is not None:
                body["purpose"] = purpose
        else:
            start, verify = "/auth/otp/challenges", "/auth/otp/verify"
            body = {"phone": phone}
        created = client.post(API + start, json=body, headers={"Origin": ORIGIN})
        assert created.status_code == 201, created.text
        result = client.post(API + verify, json={"challengeId": created.json()["challengeId"], "code": "123456"}, headers={"Origin": ORIGIN})
        assert result.status_code == 200, result.text
        return result.json(), {
            "Origin": ORIGIN, "X-CSRF-Token": result.json()["csrfToken"],
            "Cookie": result.headers["set-cookie"].split(";", 1)[0],
        }
    return login
