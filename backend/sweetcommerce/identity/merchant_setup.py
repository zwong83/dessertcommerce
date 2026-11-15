"""Create a short-lived merchant sign-up link from a trusted database connection."""

import argparse
import os
import re
from datetime import timedelta
from secrets import token_urlsafe
from urllib.parse import urlsplit

import psycopg
from psycopg.rows import dict_row

from ..clock import utc_now
from ..db import one
from . import infrastructure as store


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phone", required=True, help="Merchant phone in international format, for example +60123456789")
    parser.add_argument("--origin", default="http://127.0.0.1:3000", help="SweetCommerce web origin")
    arguments = parser.parse_args()
    if not re.fullmatch(r"\+[1-9][0-9]{7,14}", arguments.phone):
        parser.error("Enter an international phone number.")
    origin = urlsplit(arguments.origin)
    if (origin.username or not origin.hostname or arguments.origin != f"{origin.scheme}://{origin.netloc}"
            or (origin.scheme != "https" and not (
                origin.scheme == "http" and origin.hostname in {"127.0.0.1", "localhost", "::1"}
            ))):
        parser.error("Enter the SweetCommerce origin. Use HTTPS for a remote origin.")

    token = token_urlsafe(32)
    try:
        with psycopg.connect(
            os.environ["SWEETCOMMERCE_MIGRATION_DATABASE_URL"], row_factory=dict_row,
            connect_timeout=3, options="-c search_path=sweetcommerce",
        ) as conn:
            enrollment = store.enroll_merchant(conn, arguments.phone)
            if not enrollment or enrollment["phone_e164"] != arguments.phone:
                raise SystemExit("Use the phone number of the active enrolled merchant.")
            if one(conn, "SELECT 1 FROM merchant_profile WHERE account_id = %s", (enrollment["id"],)):
                raise SystemExit("Merchant credentials already exist. Log in with the existing credentials.")
            store.replace_merchant_setup_link(conn, enrollment, token, utc_now() + timedelta(minutes=30))
    except (KeyError, psycopg.Error):
        raise SystemExit("Could not create a merchant setup link. Check the migration connection and run the latest migrations.") from None
    print(f"{arguments.origin}/merchant/login#setup={token}")


if __name__ == "__main__":
    main()
