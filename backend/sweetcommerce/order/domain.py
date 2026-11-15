from collections.abc import Callable
from datetime import datetime, timedelta
from enum import StrEnum
from typing import TypedDict

from ..capacity.domain import FulfilmentMode

PROOF_WINDOW = timedelta(minutes=30)
SUBMIT_OPERATION = "submitOrder"
ABANDON_OPERATION = "abandonOrResolveCheckout"


class PaymentMethod(StrEnum):
    DUITNOW = "DUITNOW"
    CASH = "CASH"


class OrderStatus(StrEnum):
    AWAITING_FEE = "AWAITING_FEE"
    AWAITING_CASH = "AWAITING_CASH"
    PENDING_PROOF = "PENDING_PROOF"
    PAYMENT_REVIEW = "PAYMENT_REVIEW"
    EXCEPTION = "EXCEPTION"
    ACCEPTED = "ACCEPTED"
    PREPARING = "PREPARING"
    READY = "READY"
    HANDED_OFF = "HANDED_OFF"
    COMPLETED = "COMPLETED"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"
    NO_SHOW = "NO_SHOW"


REVIEW_INSTRUCTIONS = {
    FulfilmentMode.PICKUP: "Collect the order at the listed pickup point.",
    FulfilmentMode.CUSTOMER_LALAMOVE: "Book and pay Lalamove separately. The external delivery fee is excluded.",
    FulfilmentMode.MERCHANT_LALAMOVE: "The subtotal is provisional. Review and confirm the merchant’s delivery fee before paying.",
}


class CheckoutTerms(TypedDict):
    version: str
    text: str


def fulfilment_snapshot(checkout: dict, terms: CheckoutTerms, pickup_display: Callable[[], str]) -> dict:
    return {
        "address": checkout.get("address"),
        "pickupDisplay": pickup_display() if checkout["fulfilment"] == FulfilmentMode.PICKUP else None,
        "contactName": checkout["contactName"],
        "phone": checkout["phone"],
        "notificationEmail": checkout.get("notificationEmail"),
        "termsText": terms["text"],
        "requestedHandoffAt": checkout["requestedHandoffAt"],
    }


def review_payment_methods(fulfilment: str) -> list[str]:
    return [PaymentMethod.DUITNOW, PaymentMethod.CASH] if fulfilment == FulfilmentMode.PICKUP else [PaymentMethod.DUITNOW]


def initial_order_status(fulfilment: str, payment_method: str) -> OrderStatus:
    if fulfilment == FulfilmentMode.MERCHANT_LALAMOVE:
        return OrderStatus.AWAITING_FEE
    if payment_method == PaymentMethod.CASH:
        return OrderStatus.AWAITING_CASH
    return OrderStatus.PENDING_PROOF


def at_millisecond(value: datetime) -> datetime:
    # JavaScript Date truncates fractional milliseconds, including dates read from PostgreSQL.
    return value.replace(microsecond=value.microsecond // 1000 * 1000)


def review_outcome(review: dict, now: datetime) -> tuple[str, datetime]:
    if review["status"] == "OPEN" and at_millisecond(now) >= at_millisecond(review["expires_at"]):
        return "EXPIRED", review["expires_at"]
    return review["status"], review["updated_at"]
