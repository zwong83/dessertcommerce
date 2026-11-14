from collections.abc import Callable
from datetime import datetime

from ..clock import utc_now
from ..db import Database
from ..identity.domain import Session
from ..problems import AccessDenied, Problem, ValidationProblem, VersionConflict
from . import infrastructure as store
from .domain import Cart, valid_quantity

INVALID_QUANTITY = "Enter a quantity from 0 to 999."


def _customer(principal: Session) -> str:
    if principal.role != "CUSTOMER":
        raise AccessDenied("Use a customer account for the cart.")
    return principal.account_id


class CartService:
    def __init__(self, db: Database, *, clock: Callable[[], datetime] = utc_now):
        self._db = db
        # Cart mutation and receipt timestamps use PostgreSQL's clock, as in the existing implementation.

    def get(self, principal: Session) -> Cart:
        account_id = _customer(principal)
        with self._db.connection() as conn:
            return store.owned_cart(conn, account_id)

    def set_quantity(
        self,
        principal: Session,
        *,
        variant_id: str,
        quantity: int | float,
        expected_version: str,
        idempotency_key: str,
    ) -> Cart:
        account_id = _customer(principal)
        if not valid_quantity(quantity):
            raise ValidationProblem(INVALID_QUANTITY)
        quantity = int(quantity)
        variant_id = variant_id.lower()
        digest = store.request_digest(variant_id, quantity, expected_version)

        with self._db.transaction() as conn:
            version = store.lock_cart(conn, account_id)
            receipt = store.find_receipt(conn, account_id, idempotency_key)
            if receipt is not None:
                if receipt["request_digest"] != digest:
                    raise Problem("IDEMPOTENCY_CONFLICT", 409, "Use a new request for a different cart edit.")
                return receipt["result_reference"]
            if str(version) != expected_version:
                raise VersionConflict("Refresh the cart before changing it.")

            if quantity == 0:
                store.remove_line(conn, account_id, variant_id)
            else:
                if not store.is_sellable(conn, variant_id):
                    raise ValidationProblem("This selection is no longer available.")
                if store.cart_is_full(conn, account_id, variant_id):
                    raise ValidationProblem("A cart can contain up to 100 selections.")
                store.upsert_line(conn, account_id, variant_id, quantity)

            store.bump_cart_version(conn, account_id)
            cart = store.owned_cart(conn, account_id)
            store.insert_receipt(conn, account_id, idempotency_key, digest, cart)
            return cart
