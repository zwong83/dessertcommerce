"""Apply the existing PostgreSQL schema with the dedicated migration role."""

import os
from hashlib import sha256
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

MIGRATIONS = (
    (1, "0001-standard-ordering.sql"),
    (2, "0002-dessert-table-service.sql"),
    (3, "0003-notice-delivery.sql"),
    (4, "0004-customer-authentication.sql"),
    (5, "0005-password-registration.sql"),
    (6, "0006-customer-account-settings.sql"),
    (7, "0007-merchant-credentials.sql"),
    (8, "0008-event-invoices.sql"),
    (9, "0009-merchant-setup-links.sql"),
)


def migrate(dsn: str) -> list[int]:
    migration_dir = Path(__file__).resolve().parents[2] / "db" / "migrations"
    baseline = []
    for version, file in MIGRATIONS:
        content = (migration_dir / file).read_bytes()
        baseline.append((version, sha256(content).hexdigest(), content.decode("utf-8")))

    with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=3) as connection:
        server = connection.execute(
            "SELECT current_setting('server_version_num')::integer / 10000 AS major, current_user AS role"
        ).fetchone()
        if server != {"major": 16, "role": "sweetcommerce_migration"}:
            raise RuntimeError("Migrations require PostgreSQL 16 and the sweetcommerce_migration role")
        connection.execute("SELECT pg_advisory_xact_lock(1599625048, 1)")
        connection.execute("CREATE SCHEMA IF NOT EXISTS sweetcommerce")
        connection.execute("SET LOCAL search_path TO sweetcommerce")
        connection.execute("""
            CREATE TABLE IF NOT EXISTS schema_migration (
                version integer PRIMARY KEY,
                sha256 text NOT NULL,
                applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
            )
        """)
        history = connection.execute("SELECT version, sha256 FROM schema_migration ORDER BY version").fetchall()
        for index, row in enumerate(history):
            if index >= len(baseline) or baseline[index][:2] != (row["version"], row["sha256"]):
                raise RuntimeError(f"Migration history differs at version {row['version']}")

        applied = []
        for version, digest, sql in baseline[len(history):]:
            connection.execute(sql, prepare=False)
            connection.execute("INSERT INTO schema_migration (version, sha256) VALUES (%s, %s)", (version, digest))
            applied.append(version)
    return applied


def main() -> None:
    try:
        applied = migrate(os.environ["SWEETCOMMERCE_MIGRATION_DATABASE_URL"])
    except (KeyError, OSError, psycopg.Error, RuntimeError):
        raise SystemExit("Could not apply SweetCommerce migrations with the configured migration role.") from None
    print(f"Applied SweetCommerce migrations: {applied}")


if __name__ == "__main__":
    main()
