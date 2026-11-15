"""Provision the Windows development database without putting passwords in commands."""

import argparse
import getpass
import os
from pathlib import Path
import secrets
import subprocess
from urllib.parse import quote, unquote, urlsplit

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / ".env.persistent.local"
PG_ROOT = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "PostgreSQL" / "16"
HOST, PORT, DATABASE = "127.0.0.1", 5432, "sweetcommerce_local"
ROLES = {
    "sweetcommerce_migration": "SWEETCOMMERCE_MIGRATION_DATABASE_URL",
    "sweetcommerce_api": "DATABASE_URL",
    "sweetcommerce_worker": "SWEETCOMMERCE_WORKER_DATABASE_URL",
}


def start_postgres():
    ready = PG_ROOT / "bin" / "pg_isready.exe"
    if subprocess.run([ready, "-h", HOST, "-p", str(PORT)], capture_output=True).returncode == 0:
        return
    log = ROOT / ".cache" / "local-postgresql.log"
    log.parent.mkdir(exist_ok=True)
    subprocess.run([
        PG_ROOT / "bin" / "pg_ctl.exe", "start", "-D", PG_ROOT / "data", "-l", log,
        "-o", f"-c listen_addresses={HOST}", "-w", "-t", "15",
    ], check=True)


def local_passwords(admin):
    if CONFIG.exists():
        values = dict(line.split("=", 1) for line in CONFIG.read_text(encoding="utf-8").splitlines() if line)
        return {role: unquote(urlsplit(values[setting]).password or "") for role, setting in ROLES.items()}

    existing = {row[0] for row in admin.execute("SELECT rolname FROM pg_roles WHERE rolname = ANY(%s)", (list(ROLES),))}
    passwords = {
        role: getpass.getpass(f"Password for the existing role {role}: ") if role in existing else secrets.token_hex(24)
        for role in ROLES
    }
    if not all(passwords.values()):
        raise SystemExit("Every database role needs a password.")
    settings = {
        setting: f"postgresql://{role}:{quote(passwords[role], safe='')}@{HOST}:{PORT}/{DATABASE}"
        for role, setting in ROLES.items()
    }
    settings.update(SWEETCOMMERCE_IDENTITY_KEY=secrets.token_urlsafe(32), SWEETCOMMERCE_SYNTHETIC_OTP="123456")
    with CONFIG.open("x", encoding="utf-8") as file:
        file.writelines(f"{name}={value}\n" for name, value in settings.items())
    return passwords


def main():
    start_postgres()
    connection = dict(host=HOST, port=PORT, connect_timeout=4)
    admin_password = getpass.getpass("Password for PostgreSQL user postgres (from the installer): ")
    with psycopg.connect(**connection, dbname="postgres", user="postgres", password=admin_password, autocommit=True) as admin:
        if admin.info.server_version // 10000 != 16:
            raise SystemExit("SweetCommerce requires PostgreSQL 16.")
        passwords = local_passwords(admin)
        with admin.transaction():
            for role, password in passwords.items():
                if not admin.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,)).fetchone():
                    admin.execute(sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(sql.Identifier(role), sql.Literal(password)))
        if not admin.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DATABASE,)).fetchone():
            admin.execute("CREATE DATABASE sweetcommerce_local")
            admin.execute("REVOKE ALL ON DATABASE sweetcommerce_local FROM PUBLIC")
        admin.execute("GRANT CONNECT, CREATE ON DATABASE sweetcommerce_local TO sweetcommerce_migration")
        admin.execute("GRANT CONNECT ON DATABASE sweetcommerce_local TO sweetcommerce_api, sweetcommerce_worker")
    for role, password in passwords.items():
        try:
            with psycopg.connect(**connection, dbname=DATABASE, user=role, password=password):
                pass
        except psycopg.OperationalError:
            raise SystemExit(f"Could not connect as {role}. Check that role's password in the local configuration.") from None
    print("PostgreSQL database and all three SweetCommerce roles are ready.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-only", action="store_true", help="Start the existing PostgreSQL server.")
    args = parser.parse_args()
    try:
        if args.start_only:
            start_postgres()
        else:
            main()
    except psycopg.OperationalError:
        raise SystemExit("Could not connect as postgres. Check the password you set during installation.") from None
    except (OSError, subprocess.CalledProcessError):
        raise SystemExit("Could not start PostgreSQL or save the local configuration.") from None
