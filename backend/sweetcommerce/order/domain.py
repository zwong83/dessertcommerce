from collections.abc import Callable
from datetime import datetime, timedelta
from typing import TypedDict

PROOF_WINDOW = timedelta(minutes=30)
SUBMIT_OPERATION = "submitOrder"
ABANDON_OPERATION = "abandonOrResolveCheckout"

REVIEW_INSTRUCTIONS = {
    "PICKUP": "Collect the order at the listed pickup point.",
    "CUSTOMER_LALAMOVE": "Book and pay Lalamove separately. The external delivery fee is excluded.",
    "MERCHANT_LALAMOVE": "The subtotal is provisional. Review and confirm the merchant’s delivery fee before paying.",
}


class CheckoutTerms(TypedDict):
    version: str
    text: str


def fulfilment_snapshot(checkout: dict, terms: CheckoutTerms, pickup_display: Callable[[], str]) -> dict:
    return {
        "address": checkout.get("address"),
        "pickupDisplay": pickup_display() if checkout["fulfilment"] == "PICKUP" else None,
        "contactName": checkout["contactName"],
        "phone": checkout["phone"],
        "notificationEmail": checkout.get("notificationEmail"),
        "termsText": terms["text"],
        "requestedHandoffAt": checkout["requestedHandoffAt"],
    }


def review_payment_methods(fulfilment: str) -> list[str]:
    return ["DUITNOW", "CASH"] if fulfilment == "PICKUP" else ["DUITNOW"]


def initial_order_status(fulfilment: str, payment_method: str) -> str:
    if fulfilment == "MERCHANT_LALAMOVE":
        return "AWAITING_FEE"
    if payment_method == "CASH":
        return "AWAITING_CASH"
    return "PENDING_PROOF"


def at_millisecond(value: datetime) -> datetime:
    # JavaScript Date truncates fractional milliseconds, including dates read from PostgreSQL.
    return value.replace(microsecond=value.microsecond // 1000 * 1000)


def review_outcome(review: dict, now: datetime) -> tuple[str, datetime]:
    if review["status"] == "OPEN" and at_millisecond(now) >= at_millisecond(review["expires_at"]):
        return "EXPIRED", review["expires_at"]
    return review["status"], review["updated_at"]
