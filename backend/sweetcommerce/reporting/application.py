from ..capacity.domain import require_role
from ..problems import validation
from . import infrastructure as store
from .domain import ORDER_STATES, money_categories, report_range


class ReportService:
    def __init__(self, db):
        self.db = db

    def report(self, actor, first, last, status):
        require_role(actor, "ADMIN")
        if status is not None and status not in ORDER_STATES:
            raise validation("Choose a standard order status.")
        period = {**report_range(first, last), "status": status}
        with self.db.transaction() as conn:
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            money = store.verified_money(conn, period)
            counts = store.order_counts(conn, period)
            prep = store.prep_by_day(conn, period)
            readiness = store.prep_kpis(conn, period)
            events = store.event_kpis(conn, period)
        return {
            "from": first, "to": last, "timezone": "Asia/Kuala_Lumpur", "currency": "MYR",
            "totals": money_categories(money),
            "acceptedStandard": sum(item["accepted"] for item in counts),
            "confirmedEvents": events["booked"], "duePrepUnits": sum(item["units"] for item in prep),
            "prepByDay": [{"date": item["date"].isoformat(), "units": item["units"]} for item in prep],
            "readyOnTime": readiness["on_time"], "dueWithPromise": readiness["due"],
            "quotedApplications": events["quoted"], "quotedWithConfirmedDeposit": events["converted"],
            "orderCountsByStatus": [{"status": item["status"], "count": item["count"]} for item in counts],
        }
