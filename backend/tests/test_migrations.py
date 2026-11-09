from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import psycopg
import pytest

from sweetcommerce.migrate import MIGRATIONS, migrate


def test_postgres_16_migration_bootstrap_and_repeatable_history(dsns, applied):
    assert applied[:3] == [1, 2, 3]
    assert applied == [version for version, _ in MIGRATIONS]
    with ThreadPoolExecutor(max_workers=2) as threads:
        retries = list(threads.map(migrate, [dsns["migration"]] * 2))
    assert retries == [[], []]
    with psycopg.connect(dsns["migration"]) as connection:
        history = connection.execute("SELECT version, sha256 FROM schema_migration ORDER BY version").fetchall()
        assert [version for version, _ in history] == applied
        assert history[0][1] == "71323c4c6d080e0ebb3d89a416773846acdccc82d45c8a2c73337b067dacae0d"


def test_runtime_roles_keep_their_existing_grants(dsns, applied):
    with pytest.raises(RuntimeError, match="migration role"):
        migrate(dsns["api"])
    with psycopg.connect(dsns["api"], autocommit=True) as api:
        api.execute("SELECT id FROM account LIMIT 1")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            api.execute("SELECT * FROM schema_migration")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            api.execute("CREATE TABLE unexpected (id integer)")
    with psycopg.connect(dsns["worker"], autocommit=True) as worker:
        worker.execute("SELECT id FROM durable_work LIMIT 1")
        worker.execute("SELECT id, status FROM event_application LIMIT 1")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            worker.execute("SELECT * FROM session LIMIT 1")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            worker.execute("SELECT request_snapshot FROM event_application LIMIT 1")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            worker.execute("SELECT * FROM event_eligible_receipt LIMIT 1")


def test_0002_preserves_existing_standard_charge_and_top_up(dsns):
    migrations = Path(__file__).resolve().parents[2] / "db" / "migrations"
    with psycopg.connect(dsns["migration"]) as conn:
        # Isolate the upgrade from other tests regardless of which schema version they initialized.
        conn.execute("CREATE SCHEMA migration_compatibility")
        conn.execute("SET LOCAL search_path TO migration_compatibility")
        for name in ("0001-standard-ordering.sql", "0002-dessert-table-service.sql"):
            migration = (migrations / name).read_text().replace("sweetcommerce.", "migration_compatibility.")
            conn.execute(migration.replace("SCHEMA sweetcommerce ", "SCHEMA migration_compatibility "), prepare=False)
            if name.startswith("0001"):
                account = conn.execute("""
                    INSERT INTO account (id,role,phone_e164) VALUES (gen_random_uuid(),'CUSTOMER','+60000000003')
                    RETURNING id
                """).fetchone()[0]
                review = conn.execute("""
                    INSERT INTO checkout_review (id,account_id,cart_version,review_digest,terms_version,review_snapshot,
                                                 expires_at,updated_at)
                    VALUES (gen_random_uuid(),%s,1,'abc','terms','{}',now(),now()) RETURNING id
                """, (account,)).fetchone()[0]
                order = conn.execute("""
                    INSERT INTO standard_order (id,order_number,account_id,checkout_review_id,status,fulfilment,
                        payment_method,service_date,requested_handoff_at,fulfilment_snapshot,subtotal_minor,fee_minor,
                        terms_version,created_at,updated_at)
                    VALUES (gen_random_uuid(),'ORD-TEST',%s,%s,'PAYMENT_REVIEW','PICKUP','DUITNOW',
                            current_date,now(),'{}',100,0,'terms',now(),now()) RETURNING id
                """, (account, review)).fetchone()[0]
                conn.execute("""
                    INSERT INTO charge (id,order_id,category,state,expected_minor,created_at,top_up_requested_at,
                                        top_up_due_at,top_up_outstanding_minor)
                    VALUES (gen_random_uuid(),%s,'STANDARD','DISPUTED',100,now(),now(),now() + interval '30 minutes',15)
                """, (order,))
        assert conn.execute("""
            SELECT order_id,event_id,quote_id,bill_snapshot,top_up_outstanding_minor FROM charge
        """).fetchone() == (order, None, None, None, 15)
        conn.rollback()


def test_refuses_changed_history(dsns, applied):
    with psycopg.connect(dsns["migration"], autocommit=True) as connection:
        digest, = connection.execute("SELECT sha256 FROM schema_migration WHERE version = 1").fetchone()
        connection.execute("UPDATE schema_migration SET sha256 = 'mismatch' WHERE version = 1")
        try:
            with pytest.raises(RuntimeError, match="Migration history differs at version 1"):
                migrate(dsns["migration"])
        finally:
            connection.execute("UPDATE schema_migration SET sha256 = %s WHERE version = 1", (digest,))


def test_rollback_when_transaction_catches_database_error(db):
    from uuid import uuid4

    account = uuid4()
    with pytest.raises(RuntimeError, match="did not commit"):
        with db.transaction() as connection:
            connection.execute(
                "INSERT INTO account (id, role, phone_e164) VALUES (%s, 'CUSTOMER', '+60000000002')", (account,)
            )
            with pytest.raises(psycopg.errors.UniqueViolation):
                connection.execute(
                    "INSERT INTO account (id, role, phone_e164) VALUES (%s, 'CUSTOMER', '+60000000002')", (account,)
                )
    with db.connection() as connection:
        assert connection.execute("SELECT id FROM account WHERE id = %s", (account,)).fetchone() is None
