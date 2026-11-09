from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from ..problems import validation

MYT = ZoneInfo("Asia/Kuala_Lumpur")
MONEY_CATEGORIES = ("STANDARD", "EVENT_DEPOSIT", "EVENT_BALANCE", "EVENT_EXTRA")
ORDER_STATES = {
    "AWAITING_FEE", "AWAITING_CASH", "PENDING_PROOF", "PAYMENT_REVIEW", "EXCEPTION", "ACCEPTED",
    "PREPARING", "READY", "HANDED_OFF", "COMPLETED", "EXPIRED", "CANCELLED", "REJECTED", "NO_SHOW",
}


def report_range(first, last):
    try:
        start, end = date.fromisoformat(first), date.fromisoformat(last)
        if start.isoformat() != first or end.isoformat() != last or not 0 <= (end - start).days <= 91:
            raise ValueError
        return {
            "first": start, "last": end, "start": datetime.combine(start, time.min, MYT),
            "stop": datetime.combine(end + timedelta(days=1), time.min, MYT),
        }
    except (TypeError, ValueError, OverflowError):
        raise validation("Choose a valid MYT date range of at most 92 days.") from None


def money_categories(records):
    by_category = {item["category"]: (item["received"], item["refunded"]) for item in records}
    totals = []
    for category in MONEY_CATEGORIES:
        received, refunded = by_category.get(category, (0, 0))
        totals.append({"category": category, "receivedMinor": received, "refundedMinor": refunded, "netMinor": received - refunded})
    return totals
