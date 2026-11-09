from ..capacity.domain import require_role, uuid
from ..capacity.infrastructure import CapacityCommand, command
from ..db import Database, one
from ..order.infrastructure import missing
from ..problems import validation
from ..work.queue import milestone
from ..settlement import infrastructure as settlement
from ..settlement.domain import charge_view, invalid_transition, refund_view
from . import infrastructure as store
from .domain import (
    ACTIVE_INTENTS,
    charge_state_after_payout,
    check_version,
    movement_reference,
    next_intent_state,
    payout_time,
    positive_integer,
    reason,
    refund_limit,
)


def _database_time(conn):
    return one(conn, "SELECT clock_timestamp() AS now")["now"]


def _project_charge(conn, charge, now):
    return charge_view(
        charge, store.money_totals(conn, charge["id"]), now,
        pending=settlement.pending_timely_proof(conn, charge), admin=True,
    )


class RefundService:
    def __init__(self, db: Database):
        self.db = db

    def reserve_refund(self, actor, charge_id, body: dict, context: CapacityCommand) -> dict:
        actor_id = require_role(actor, "ADMIN")
        charge_id = uuid(charge_id)
        receipt_id = uuid(body.get("receiptId"))
        amount = positive_integer(body.get("amountMinor"), "the refund amount")
        expected = positive_integer(body.get("expectedVersion"), "the charge version")
        explanation = reason(body.get("reason"))
        with self.db.transaction() as conn:
            def reserve():
                _, charge = store.lock_parent_and_charge(conn, charge_id)
                check_version(charge, expected)
                receipt = store.lock_receipt(conn, charge_id, receipt_id)
                totals = store.receipt_refunds(conn, receipt_id)
                if amount > receipt["amount_minor"] - totals["posted"] - totals["reserved"]:
                    raise refund_limit()

                now = _database_time(conn)
                intent = store.reserve_intent(conn, receipt_id, actor_id, amount, explanation, now)
                charge = settlement.update_charge(conn, charge_id, charge["state"])
                settlement.record_audit(conn, actor_id, intent["id"], "RESERVE_REFUND", context, {
                    "chargeId": charge_id, "receiptId": receipt_id, "amountMinor": amount, "state": "RESERVED",
                })
                return {
                    "refundIntentId": str(intent["id"]), "state": "RESERVED",
                    "charge": _project_charge(conn, charge, now),
                }

            return command(conn, actor_id, "reserveRefund", context, [
                charge_id, receipt_id, amount, expected, explanation,
            ], reserve)

    def record_refund(self, actor, charge_id, body: dict, context: CapacityCommand) -> dict:
        actor_id = require_role(actor, "ADMIN")
        charge_id = uuid(charge_id)
        intent_id = uuid(body.get("refundIntentId"))
        expected = positive_integer(body.get("expectedVersion"), "the charge version")
        details = {
            "amountMinor": positive_integer(body.get("amountMinor"), "the refund amount", 999_999_999),
            "externalReference": movement_reference(body.get("externalReference")),
            "refundedAt": payout_time(body.get("refundedAt")),
            "reason": reason(body.get("reason")),
        }
        with self.db.transaction() as conn:
            def post():
                parent, charge = store.lock_parent_and_charge(conn, charge_id)
                check_version(charge, expected)
                target = store.intent_target(conn, intent_id)
                if str(target["charge_id"]) != charge_id:
                    raise missing()
                receipt = store.lock_receipt(conn, charge_id, target["receipt_id"])
                intent = store.lock_intent(conn, intent_id, receipt["id"])
                if intent["status"] not in ACTIVE_INTENTS:
                    raise invalid_transition("This refund intent no longer has a reserved payout.")
                if details["amountMinor"] != intent["amount_minor"]:
                    raise refund_limit()
                totals = store.receipt_refunds(conn, receipt["id"])
                if totals["posted"] + totals["reserved"] > receipt["amount_minor"]:
                    raise refund_limit()

                now = _database_time(conn)
                if details["refundedAt"] > now:
                    raise validation("The actual payout time cannot be in the future.")
                movement_id = store.append_payout(conn, charge_id, receipt, actor_id, details, now)
                store.dispose_intent(conn, intent_id, "POSTED", details["reason"], now, entry_id=movement_id)
                money = store.money_totals(conn, charge_id)
                state = charge_state_after_payout(parent, charge, money)
                charge = settlement.update_charge(conn, charge_id, state)
                milestone(conn, parent["id"], "REFUND_POSTED", movement_id, now, chargeId=str(charge_id))
                settlement.record_audit(conn, actor_id, intent_id, "RECORD_REFUND", context, {
                    "chargeId": charge_id, "movementId": str(movement_id),
                    "amountMinor": details["amountMinor"], "state": "POSTED",
                })
                return charge_view(
                    charge, money, now, pending=settlement.pending_timely_proof(conn, charge), admin=True,
                )

            return command(conn, actor_id, "recordRefund", context, [
                charge_id, intent_id, expected, details["amountMinor"], details["externalReference"],
                details["refundedAt"].isoformat(), details["reason"],
            ], post)

    def reconcile_refund_intent(self, actor, intent_id, body: dict, context: CapacityCommand) -> dict:
        actor_id = require_role(actor, "ADMIN")
        intent_id = uuid(intent_id)
        expected = positive_integer(body.get("expectedChargeVersion"), "the charge version")
        outcome = body.get("outcome")
        if outcome not in ("PAYOUT_UNCERTAIN", "CONFIRMED_NOT_PAID"):
            raise validation("Choose a valid payout outcome.")
        explanation = reason(body.get("reason"))
        with self.db.transaction() as conn:
            def reconcile():
                target = store.intent_target(conn, intent_id)
                _, charge = store.lock_parent_and_charge(conn, target["charge_id"])
                check_version(charge, expected)
                receipt = store.lock_receipt(conn, charge["id"], target["receipt_id"])
                intent = store.lock_intent(conn, intent_id, receipt["id"])
                state = next_intent_state(intent, outcome)
                updated = store.dispose_intent(conn, intent_id, state, explanation, _database_time(conn))
                settlement.update_charge(conn, charge["id"], charge["state"])
                settlement.record_audit(conn, actor_id, intent_id, "RECONCILE_REFUND_INTENT", context, {
                    "chargeId": str(charge["id"]), "state": state, "outcome": outcome,
                })
                return refund_view(updated)

            return command(conn, actor_id, "reconcileRefundIntent", context, [
                intent_id, expected, outcome, explanation,
            ], reconcile)
