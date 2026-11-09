from ..capacity.order import release_capacity
from ..db import Database
from . import infrastructure as store
from .domain import Claim, active_deadline, expected_deadline, review_window_start


def claim_expiry(db: Database) -> Claim | None:
    with db.transaction() as conn:
        return store.claim_work(conn)


def apply_expiry(db: Database, claim: Claim) -> str:
    with db.transaction() as conn:
        work = store.lock_work(conn, claim)
        if work is None:
            return "stale-lease"

        if work["kind"] in ("EVENT_QUOTE_EXPIRY", "EVENT_BALANCE_DUE"):
            from ..eventsettlement.worker import apply_event_work
            return apply_event_work(conn, claim, work)

        expected = expected_deadline(work)
        if expected is None:
            store.settle_work(conn, claim, "DEAD", "INVALID_EXPIRY_PAYLOAD")
            return "invalid"

        order, charge = store.lock_order_and_charge(conn, work["resource_id"])
        deadline = active_deadline(work, order, charge, expected)
        if deadline is None:
            store.settle_work(conn, claim, "SUCCEEDED")
            return "obsolete"

        if not store.deadline_reached(conn, deadline):
            store.defer_work(conn, claim, deadline)
            return "deferred"
        if store.timely_review_exists(conn, charge["id"], deadline, review_window_start(work, charge)):
            store.settle_work(conn, claim, "SUCCEEDED")
            return "preserved"

        released = release_capacity(conn, order["id"], order["date"])
        store.record_expiry(conn, claim, order, charge, released)
        store.settle_work(conn, claim, "SUCCEEDED")
        return "expired"


def poll_expiry(db: Database) -> str | None:
    claim = claim_expiry(db)
    return apply_expiry(db, claim) if claim is not None else None
