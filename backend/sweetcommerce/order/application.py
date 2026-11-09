import random
import time
from collections.abc import Callable
from datetime import datetime, timedelta
from uuid import uuid4

from psycopg import errors

from ..capacity.domain import (
    add_days,
    can_fit_capacity,
    earliest_handoff,
    is_handoff_eligible,
    myt_date,
    product_demand,
    require_role,
)
from ..capacity.infrastructure import (
    CapacityCommand,
    command,
    database_time,
    lock_policy,
    read_days,
    read_limits,
    read_policy,
    uuid,
)
from ..capacity.order import allocate_capacity, bump_capacity_impact, lock_capacity_dates
from ..db import Database, iso
from ..clock import utc_now
from ..problems import Problem, validation
from . import infrastructure as store
from .domain import (
    ABANDON_OPERATION,
    PROOF_WINDOW,
    REVIEW_INSTRUCTIONS,
    SUBMIT_OPERATION,
    CheckoutTerms,
    at_millisecond,
    fulfilment_snapshot,
    initial_order_status,
    review_outcome,
    review_payment_methods,
)
from .input import parse_checkout_review, parse_submit_order


def _terms_changed() -> Problem:
    return Problem("TERMS_CHANGED", 409, "Review the current terms before submitting.")


def _availability(conn, checkout: dict, now: str, selections: list[dict], *, suggest: bool) -> tuple[bool, list[str], list[dict]]:
    units, prep_minutes, sellable = product_demand(checkout["items"], selections)
    alternatives = []
    line_issues = [
        {"variantId": str(row["variant_id"]), "reason": "UNAVAILABLE"}
        for row in selections
        if row["status"] != "LISTED" or not row["available"]
    ]
    if not sellable:
        return False, alternatives, line_issues

    policy = read_policy(conn)
    handoff = checkout["requestedHandoffAt"]
    date = myt_date(handoff)
    if is_handoff_eligible(policy, now, handoff, prep_minutes):
        days = read_days(conn, date, date)
        limits = {str(row["product_id"]): row for row in read_limits(conn, date, date)}
        if can_fit_capacity(days[0] if days else None, limits, units):
            return True, alternatives, line_issues

    if suggest:
        today = myt_date(now)
        end = add_days(today, 30)
        limits_by_date = {}
        for row in read_limits(conn, today, end):
            limits_by_date.setdefault(row["date"], {})[str(row["product_id"])] = row
        for day in read_days(conn, today, end):
            if can_fit_capacity(day, limits_by_date.get(day["date"], {}), units):
                alternative = earliest_handoff(policy, now, day["date"], prep_minutes)
                if alternative:
                    alternatives.append(alternative)
                if len(alternatives) == 20:
                    break
    return False, alternatives, line_issues


class OrderService:
    def __init__(
        self,
        db: Database,
        terms: Callable[[], CheckoutTerms],
        pickup_display: Callable[[], str],
        *,
        clock: Callable[[], datetime | str] = utc_now,
        review_ttl_ms: int = 600_000,
        duitnow_qr_url: str | None = None,
        whatsapp_url: str | None = None,
    ):
        if type(review_ttl_ms) is not int or not 1 <= review_ttl_ms <= 9_007_199_254_740_991:
            raise ValueError("Checkout needs a positive review lifetime")
        self.db = db
        self.terms = terms
        self.pickup_display = pickup_display
        # The default samples the database clock inside the transaction. Tests can inject time.
        self.clock = None if clock is utc_now else clock
        self.review_ttl = timedelta(milliseconds=review_ttl_ms)
        self.duitnow_qr_url = duitnow_qr_url
        self.whatsapp_url = whatsapp_url

    def _checkout_transaction(self, run: Callable) -> dict:
        for attempt in range(3):
            try:
                with self.db.transaction() as conn:
                    return run(conn)
            except (errors.SerializationFailure, errors.DeadlockDetected):
                # These SQLSTATEs abort the transaction. An ambiguous commit must use receipt replay.
                if attempt == 2:
                    raise
                time.sleep(random.randint(10, 30) / 1000)

    def review_checkout(self, actor, input_data: object) -> dict:
        actor_id = require_role(actor, "CUSTOMER")
        checkout = parse_checkout_review(input_data)

        def run(conn):
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            now = database_time(conn, self.clock)
            review_id = str(uuid4())
            expires_at = iso(datetime.fromisoformat(now) + self.review_ttl)
            terms = self.terms()
            snapshot = fulfilment_snapshot(checkout, terms, self.pickup_display)
            selections, lines, subtotal = store.cart_selections(conn, actor_id, checkout)
            if subtotal > 999_999_999:
                raise validation("The checkout total exceeds the supported amount.")
            eligible, alternatives, line_issues = _availability(conn, checkout, now, selections, suggest=True)
            fulfilment = checkout["fulfilment"]
            fee = None if fulfilment == "MERCHANT_LALAMOVE" else 0
            saved = {"fulfilment": snapshot, "lines": lines, "subtotalMinor": subtotal, "feeMinor": fee, "eligible": eligible}
            store.insert_review(conn, review_id, actor_id, checkout, terms["version"], saved, expires_at, now)
            return {
                **snapshot, "reviewId": review_id, "expiresAt": expires_at, "cartVersion": checkout["cartVersion"],
                "fulfilment": fulfilment, "items": [line["display"] for line in lines], "subtotalMinor": subtotal,
                "feeMinor": fee, "totalMinor": None if fee is None else subtotal, "termsVersion": terms["version"],
                "eligible": eligible, "alternatives": alternatives, "lineIssues": line_issues,
                "paymentMethods": review_payment_methods(fulfilment) if eligible else [],
                "instructions": REVIEW_INSTRUCTIONS[fulfilment],
            }

        return self._checkout_transaction(run)

    def submit_order(self, actor, input_data: object, context: CapacityCommand) -> dict:
        actor_id = require_role(actor, "CUSTOMER")
        checkout, submission = parse_submit_order(input_data)

        def run(conn):
            result = command(
                conn, actor_id, SUBMIT_OPERATION, context, [checkout, submission],
                lambda: self._submit(conn, actor_id, checkout, submission, context),
            )
            now = datetime.fromisoformat(database_time(conn, self.clock))
            return store.own_order(conn, actor_id, result["orderId"], now, self.duitnow_qr_url, self.whatsapp_url)

        return self._checkout_transaction(run)

    def _submit(self, conn, actor_id: str, checkout: dict, submission: dict, context: CapacityCommand) -> dict:
        review_id = submission["reviewId"]
        payment_method = submission["paymentMethod"]
        terms_version = submission["termsVersion"]
        review = store.locked_review(conn, actor_id, review_id)
        if review["review_digest"] != store.checkout_digest(checkout):
            raise store.stale_review()
        if review["terms_version"] != terms_version:
            raise _terms_changed()
        if review["status"] == "SUBMITTED":
            order = store.submitted_order(conn, actor_id, review_id)
            if order["payment_method"] != payment_method:
                raise store.stale_review()
            return {"orderId": str(order["id"])}
        if review["status"] != "OPEN":
            raise store.stale_review()
        fulfilment = checkout["fulfilment"]
        if payment_method not in review_payment_methods(fulfilment):
            raise validation("Cash is available for pickup only.")

        # Match capacity and catalogue writers before locking and rereading the owner's cart.
        handoff = checkout["requestedHandoffAt"]
        date = myt_date(handoff)
        lock_policy(conn, "share")
        store.lock_checkout_products(conn, checkout)
        lock_capacity_dates(conn, [date])
        store.lock_cart(conn, actor_id)

        now = database_time(conn, self.clock)
        instant = at_millisecond(datetime.fromisoformat(now))
        if instant >= at_millisecond(review["expires_at"]):
            raise store.stale_review()
        terms = self.terms()
        current = fulfilment_snapshot(checkout, terms, self.pickup_display)
        saved = review["review_snapshot"]
        if terms["version"] != terms_version or current["termsText"] != saved["fulfilment"]["termsText"]:
            raise _terms_changed()
        if current != saved["fulfilment"]:
            raise store.stale_review()
        selections, lines, subtotal = store.cart_selections(conn, actor_id, checkout)
        if subtotal != saved["subtotalMinor"] or lines != saved["lines"] or not saved["eligible"]:
            raise store.stale_review()

        order_id = str(uuid4())
        status = initial_order_status(fulfilment, payment_method)
        if status != "PENDING_PROOF":
            eligible, _, _ = _availability(conn, checkout, now, selections, suggest=False)
            if not eligible:
                raise Problem("CAPACITY_UNAVAILABLE", 409, "Choose an available handoff time.")
        created_at = iso(instant)
        deadline = iso(instant + PROOF_WINDOW) if status == "PENDING_PROOF" else None
        store.insert_order(conn, order_id, actor_id, checkout, submission, saved,
                           status=status, date=date, deadline=deadline, created_at=created_at)

        if deadline is None:
            bump_capacity_impact(conn, [date])
        else:
            charge_id = store.insert_charge(conn, order_id, saved["subtotalMinor"], deadline, created_at)
            allocate_capacity(conn, order_id, handoff, "HELD", clock=lambda: now)
            store.schedule_expiry(conn, order_id, charge_id, deadline, created_at)
        store.record_submission(conn, review_id, actor_id, order_id, status, created_at, context.request_id)
        return {"orderId": order_id}

    def get_checkout_outcome(self, actor, review_id: str) -> dict:
        actor_id = require_role(actor, "CUSTOMER")
        review_id = uuid(review_id)
        with self.db.transaction() as conn:
            review = store.review_for_outcome(conn, actor_id, review_id)
            order_id = self._outcome_order_id(conn, actor_id, review_id, review)
            state, updated_at = review_outcome(review, datetime.fromisoformat(database_time(conn, self.clock)))
            return {"state": state, "orderId": order_id, "updatedAt": iso(updated_at)}

    def abandon_or_resolve_checkout(self, actor, review_id: str, context: CapacityCommand) -> dict:
        actor_id = require_role(actor, "CUSTOMER")
        review_id = uuid(review_id)
        with self.db.transaction() as conn:
            def run():
                review = store.locked_review(conn, actor_id, review_id)
                now = datetime.fromisoformat(database_time(conn, self.clock))
                order_id = self._outcome_order_id(conn, actor_id, review_id, review)
                state, updated_at = review_outcome(review, now)
                if review["status"] != "OPEN":
                    return {"state": state, "orderId": order_id, "updatedAt": iso(updated_at)}

                if state != "EXPIRED":
                    state, updated_at = "ABANDONED", now
                updated_at_text = iso(updated_at)
                store.resolve_review(conn, review_id, state, updated_at_text)
                return {"state": state, "orderId": None, "updatedAt": updated_at_text}

            return command(conn, actor_id, ABANDON_OPERATION, context, [review_id], run)

    @staticmethod
    def _outcome_order_id(conn, actor_id: str, review_id: str, review: dict) -> str | None:
        if review["status"] == "SUBMITTED":
            return str(store.submitted_order(conn, actor_id, review_id)["id"])
        return None

    def get_own_order(self, actor, order_id: str) -> dict:
        actor_id = require_role(actor, "CUSTOMER")
        order_id = uuid(order_id)
        with self.db.connection() as conn:
            now = datetime.fromisoformat(database_time(conn, self.clock))
            return store.own_order(conn, actor_id, order_id, now, self.duitnow_qr_url, self.whatsapp_url)

    def get_own_command_outcome(self, actor, operation: str, idempotency_key: str) -> dict:
        actor_id = require_role(actor, "CUSTOMER")
        key = uuid(idempotency_key)
        if operation not in (
            SUBMIT_OPERATION, ABANDON_OPERATION, "confirmDeliveryFee", "cancelOwnOrder",
            "submitChargeProof", "setCartQuantity", "submitEventRequest", "acceptEventQuote", "cancelEventRequest",
        ):
            raise store.missing()
        with self.db.connection() as conn:
            return store.command_outcome(conn, actor_id, operation, key)
