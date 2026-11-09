"""Reconcile a bounded batch of candidate proof object keys supplied by inventory."""

import sys
from itertools import islice

from ..db import Database
from ..runtime import Settings
from .application import ProofService


def main() -> None:
    try:
        settings = Settings.from_environment()
        db = Database(settings.dsn, max_size=1)
        db.open()
        try:
            candidates = (line.strip() for line in islice(sys.stdin, 25))
            removed = ProofService(db, settings.private_objects()).reconcile_unlinked(candidates)
        finally:
            db.close()
    except Exception:
        raise SystemExit("Proof reconciliation did not complete. Retry using the approved inventory.") from None
    print(f"Removed unreferenced proof objects: {removed}")


if __name__ == "__main__":
    main()
