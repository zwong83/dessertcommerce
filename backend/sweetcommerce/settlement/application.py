from datetime import datetime

from ..capacity.domain import require_role, uuid
from ..capacity.infrastructure import command
from ..capacity.order import release_capacity
from ..db import one, rows
from ..order.infrastructure import missing
from ..problems import Problem, VersionConflict, validation
from ..values import field_string, field_uuid
from ..work.queue import milestone
from . import infrastructure as store
from .domain import (
    ACTIVE_CHARGE,
    ACTIVE_ORDER,
    case_view,
    invalid_transition,
    proof_view,
    refund_view,
)


def _instant(value):
    if isinstance(value, str) and "T" in value:
        try:
            timestamp = datetime.fromisoformat(value)
        except ValueError:
            pass
        else:
            if timestamp.tzinfo is not None:
                return timestamp
    raise validation("Enter the actual movement time with a timezone.")


def _receipt_details(body):
    amount = body.get("amountMinor")
    version = body.get("expectedVersion")
    mode = body.get("postingMode", "NORMAL")
    if type(amount) is not int or not 1 <= amount <= 999_999_999:
        raise validation("Enter a positive verified amount in sen.")
    if type(version) is not int or version < 1 or mode not in ("NORMAL", "RECONCILIATION", "SUPPLEMENT"):
        raise validation("Refresh the charge and choose a posting mode.")
    details = {
        "externalReference": field_string(body.get("externalReference"), "the bank reference", max_length=140).strip(),
        "amountMinor": amount, "receivedAt": _instant(body.get("receivedAt")).isoformat(),
        "expectedVersion": version, "postingMode": mode,
    }
    if "reason" in body or mode == "RECONCILIATION":
        details["reason"] = field_string(body.get("reason"), "the reason", max_length=500)
    for name in ("proofId", "settlementCaseId"):
        if name in body:
            details[name] = field_uuid(body[name], name)
    if "lateDepositDecision" in body:
        decision = body["lateDepositDecision"]
        if not isinstance(decision, dict) or set(decision) != {"disposition", "reason"} or decision["disposition"] not in (
            "FEASIBLE_24H", "RESCHEDULE_OR_REFUND",
        ):
            raise validation("Choose a disposition for the late deposit.")
        details["lateDepositDecision"] = {
            "disposition": decision["disposition"], "reason": field_string(decision["reason"], "the reason", max_length=500),
        }
    return details


class SettlementService:
    def __init__(self, db, *, clock=None):
        self.db = db
        self.clock = clock

    def _now(self, conn):
        return self.clock() if self.clock is not None else one(conn, "SELECT clock_timestamp() AS value")["value"]

    def get_charge(self, actor, charge_id):
        require_role(actor, "ADMIN")
        with self.db.connection() as conn:
            charge = one(conn, "SELECT * FROM charge WHERE id = %s", (uuid(charge_id),))
            if charge is None:
                raise missing()
            return {
                "charge": store.project_charge(conn, charge, self._now(conn), admin=True),
                "proofs": [proof_view(p) for p in rows(conn, """
                    SELECT * FROM payment_proof WHERE charge_id = %s ORDER BY received_at DESC, id DESC LIMIT 20
                """, (charge_id,))],
                "recentReceipts": [
                    {"id": str(r["id"]), "amountMinor": r["amount_minor"], "occurredAt": store.iso(r["occurred_at"])}
                    for r in rows(conn, """
                        SELECT id, amount_minor, occurred_at FROM money_entry WHERE charge_id = %s AND kind = 'RECEIPT'
                        ORDER BY occurred_at DESC,id DESC LIMIT 20
                    """, (charge_id,))
                ],
                "refundIntents": [refund_view(r) for r in rows(conn, """
                    SELECT r.* FROM refund_intent r JOIN money_entry m ON m.id = r.receipt_id
                    WHERE m.charge_id = %s ORDER BY r.updated_at DESC,r.id DESC LIMIT 20
                """, (charge_id,))],
                "cases": [case_view(c) for c in rows(conn, """
                    SELECT * FROM settlement_case WHERE charge_id = %s ORDER BY opened_at DESC,id DESC LIMIT 20
                """, (charge_id,))],
            }

    def confirm_receipt(self, actor, charge_id, body, context):
        admin = require_role(actor, "ADMIN")
        charge_id = uuid(charge_id)
        details = _receipt_details(body)
        with self.db.transaction() as conn:
            return command(conn, admin, "confirmReceipt", context, [charge_id, details],
                           lambda: self._confirm(conn, admin, charge_id, details, context))

    def _confirm(self, conn, admin, charge_id, details, context):
        order, charge = store.lock_charge(conn, charge_id)
        if charge["version"] != details["expectedVersion"]:
            raise VersionConflict("Refresh the charge before posting a movement.")
        now = self._now(conn)
        if _instant(details["receivedAt"]) > now:
            raise validation("The actual movement time cannot be in the future.")
        if charge.get("event_id") is not None:
            from ..eventsettlement.application import confirm_receipt
            return confirm_receipt(conn, order, charge, admin, details, now, context, clock=self._now)
        if "lateDepositDecision" in details:
            raise validation("Deposit disposition is available on event charges.")
        if order["payment_method"] == "CASH" and charge["category"] == "STANDARD":
            raise invalid_transition("Record Cash collection with pickup.")
        proof = store.proof_record(conn, charge_id, details["proofId"], lock=True) if "proofId" in details else None
        mode = details["postingMode"]
        if proof and proof["state"] != "REVIEW":
            raise invalid_transition("Refresh the proof before posting a movement.")
        case = store.case_record(conn, charge_id, details["settlementCaseId"], lock=True) if "settlementCaseId" in details else None
        if case and case["status"] != "OPEN":
            raise invalid_transition("Refresh the settlement case.")
        if mode == "SUPPLEMENT" and (case is None or case["kind"] != "AMOUNT_MISMATCH" or charge["top_up_due_at"] is None):
            raise invalid_transition("Select the open shortfall case for this top-up.")
        if charge["top_up_due_at"] and mode == "NORMAL":
            raise invalid_transition("Post a top-up against the open shortfall case.")
        if mode == "NORMAL" and charge["state"] not in ACTIVE_CHARGE:
            raise invalid_transition("Use reconciliation for funds received outside the active charge.")
        due = charge["top_up_due_at"] or charge["due_at"]
        eligible = charge["state"] in ACTIVE_CHARGE and mode != "RECONCILIATION"
        if charge["category"] == "STANDARD":
            eligible = eligible and order["status"] in ACTIVE_ORDER
        if proof and proof["review_disposition"] != "TIMELY":
            eligible = False
        if due and now >= due and not store.pending_timely_proof(conn, charge, proof_id=proof["id"] if proof else None):
            eligible = False

        if not eligible and case is None:
            case = store.ensure_case(conn, charge_id, "LATE_PROOF" if due and now >= due else "TRANSFER_UNMATCHED", now,
                                     proof_id=proof["id"] if proof else None)
        store.append_receipt(conn, charge_id, admin, details, now, case["id"] if case else None)
        if proof:
            store.record_review(conn, proof, admin, "ACCEPTED", now)
        money = store.money_totals(conn, charge_id)
        net = money["paid"] - money["refunded"]
        expected = charge["expected_minor"]
        if eligible and net == expected:
            try:
                with conn.transaction():
                    if charge["category"] == "STANDARD":
                        from ..fulfilment.infrastructure import accept_order
                        if (order["promised_handoff_at"] or order["requested_handoff_at"]) <= now:
                            raise invalid_transition("The agreed handoff is no longer feasible.")
                        accept_order(conn, order, actor_id=admin, now=now)
                    charge = store.update_charge(conn, charge_id, "PAID")
            except Problem as error:
                if error.code not in ("CAPACITY_UNAVAILABLE", "INVALID_TRANSITION"):
                    raise
                store.ensure_case(conn, charge_id, "STANDARD_FULFILMENT_INFEASIBLE", now)
                store.update_order(conn, order, "EXCEPTION", now)
                charge = store.update_charge(conn, charge_id, "DISPUTED")
            else:
                milestone(conn, order["id"], "STANDARD_PAYMENT_VERIFIED", charge_id, now, chargeId=str(charge_id))
                conn.execute("""
                    UPDATE settlement_case SET status = 'RESOLVED', resolved_at = %s, resolved_by = %s
                    WHERE charge_id = %s AND kind = 'AMOUNT_MISMATCH' AND status = 'OPEN'
                """, (now, admin, charge_id))
        elif eligible:
            store.ensure_case(conn, charge_id, "AMOUNT_MISMATCH", now, proof_id=proof["id"] if proof else None)
            if charge["category"] == "STANDARD" and order["status"] != "PAYMENT_REVIEW":
                store.update_order(conn, order, "PAYMENT_REVIEW", now)
                order = {**order, "status": "PAYMENT_REVIEW"}
            charge = store.update_charge(conn, charge_id, "DISPUTED")
        elif charge["state"] in ACTIVE_CHARGE:
            charge = store.update_charge(conn, charge_id, "DISPUTED")
        charge = store.expire_if_unprotected(conn, order, charge, now)
        store.record_audit(conn, admin, charge_id, "RECEIPT_VERIFIED", context, {"state": charge["state"]})
        return store.project_charge(conn, charge, now, admin=True)

    def reject_proof(self, actor, proof_id, body, context):
        admin = require_role(actor, "ADMIN")
        proof_id = uuid(proof_id)
        reason = field_string(body.get("reason"), "the reason", max_length=500)
        safe_reason = field_string(body.get("customerSafeReason"), "the customer-facing reason", max_length=350)
        decision = body.get("decision")
        if decision not in ("REJECT_PROOF", "REQUEST_SUPPLEMENT", "REJECT_STANDARD_ORDER", "REJECT_EVENT_DEPOSIT"):
            raise validation("Choose a standard-order proof action.")

        def run(conn):
            pointer = one(conn, "SELECT charge_id FROM payment_proof WHERE id = %s", (proof_id,))
            if pointer is None:
                raise missing()
            order, charge = store.lock_charge(conn, pointer["charge_id"])
            proof = store.proof_record(conn, charge["id"], proof_id, lock=True)
            now = self._now(conn)
            if charge.get("event_id") is not None:
                from ..eventsettlement import application as events
                if decision == "REQUEST_SUPPLEMENT":
                    return events.request_supplement(conn, order, charge, proof, admin, now, safe_reason, context)
                if decision == "REJECT_STANDARD_ORDER" or proof["state"] != "REVIEW":
                    raise invalid_transition("Refresh the event proof review.")
                if decision == "REJECT_EVENT_DEPOSIT":
                    events.reject_deposit(conn, order, charge, admin, now, reason, context)
                proof = store.record_review(conn, proof, admin, "REJECTED", now)
                if decision == "REJECT_PROOF":
                    events.expire_if_unprotected(conn, order, charge, now)
                    store.record_audit(conn, admin, proof_id, decision, context, {"chargeId": str(charge["id"])})
                return proof_view(proof)
            if decision == "REJECT_EVENT_DEPOSIT":
                raise invalid_transition("Choose an action for a standard charge.")
            if decision == "REQUEST_SUPPLEMENT":
                return self._request_supplement(conn, admin, order, charge, proof, now, safe_reason, context)
            if proof["state"] != "REVIEW":
                raise invalid_transition("Refresh the proof review.")
            proof = store.record_review(conn, proof, admin, "REJECTED", now)
            if decision == "REJECT_STANDARD_ORDER":
                if charge["category"] != "STANDARD" or order["status"] not in ACTIVE_ORDER:
                    raise invalid_transition()
                release_capacity(conn, order["id"], order["service_date"])
                money = store.money_totals(conn, charge["id"])
                if money["paid"] > money["refunded"]:
                    store.ensure_case(conn, charge["id"], "STANDARD_FULFILMENT_INFEASIBLE", now, notes=reason)
                store.update_order(conn, order, "REJECTED", now)
                store.update_charge(conn, charge["id"], "CANCELLED")
            else:
                store.expire_if_unprotected(conn, order, charge, now)
            milestone(conn, order["id"], "STANDARD_PAYMENT_REJECTED", proof_id, now, chargeId=str(charge["id"]))
            store.record_audit(conn, admin, proof_id, decision, context, {"chargeId": str(charge["id"])})
            return proof_view(proof)

        with self.db.transaction() as conn:
            return command(conn, admin, "rejectProof", context, [proof_id, decision, reason, safe_reason], lambda: run(conn))

    def _request_supplement(self, conn, admin, order, charge, proof, now, customer_reason, context):
        money = store.money_totals(conn, charge["id"])
        net = money["paid"] - money["refunded"]
        if charge["top_up_requested_at"] is not None and charge["state"] in ACTIVE_CHARGE:
            return proof_view(proof)
        if (
            charge["category"] != "STANDARD" or order["status"] not in ACTIVE_ORDER
            or charge["state"] != "DISPUTED" or not 0 < net < charge["expected_minor"]
            or charge["due_at"] is None or (now >= charge["due_at"] and proof["review_disposition"] != "TIMELY")
        ):
            raise invalid_transition("A verified shortfall on a held order is required.")
        hold = one(conn, "SELECT 1 FROM capacity_allocation WHERE order_id = %s AND state = 'HELD' LIMIT 1", (order["id"],))
        if hold is None:
            raise invalid_transition("The order no longer has a production hold.")
        if proof["state"] == "REVIEW":
            proof = store.record_review(conn, proof, admin, "ACCEPTED", now)
        store.issue_top_up(conn, order, charge, charge["expected_minor"] - net, now, customer_reason)
        store.record_audit(conn, admin, charge["id"], "TOP_UP_REQUESTED", context, {"status": "AWAITING_PROOF"})
        return proof_view(proof)

    def open_case(self, actor, charge_id, body, context):
        admin = require_role(actor, "ADMIN")
        charge_id = uuid(charge_id)
        reason = body.get("reason")
        if reason not in ("LATE_PROOF", "AMOUNT_MISMATCH", "TRANSFER_UNMATCHED", "STANDARD_FULFILMENT_INFEASIBLE", "EVENT_FULFILMENT_INFEASIBLE"):
            raise validation("Choose a settlement reason.")
        notes = field_string(body.get("notes"), "the notes", max_length=1000)
        proof_id = field_uuid(body["proofId"], "the proof") if "proofId" in body else None

        def run(conn):
            _, charge = store.lock_charge(conn, charge_id)
            if (reason == "EVENT_FULFILMENT_INFEASIBLE" and charge.get("event_id") is None) or (
                reason == "STANDARD_FULFILMENT_INFEASIBLE" and charge.get("event_id") is not None
            ):
                raise validation("Choose a settlement reason for this charge.")
            if proof_id:
                store.proof_record(conn, charge_id, proof_id)
            case = store.ensure_case(conn, charge["id"], reason, self._now(conn), proof_id=proof_id, notes=notes)
            store.record_audit(conn, admin, case["id"], "CASE_OPENED", context, {"kind": reason})
            return case_view(case)

        with self.db.transaction() as conn:
            return command(conn, admin, "openSettlementCase", context, [charge_id, reason, notes, proof_id], lambda: run(conn))

    def resolve_case(self, actor, case_id, body, context):
        admin = require_role(actor, "ADMIN")
        case_id = uuid(case_id)
        reason = field_string(body.get("reason"), "the resolution reason", max_length=500)

        def run(conn):
            pointer = one(conn, "SELECT charge_id FROM settlement_case WHERE id = %s", (case_id,))
            if pointer is None:
                raise missing()
            order, charge = store.lock_charge(conn, pointer["charge_id"])
            case = store.case_record(conn, charge["id"], case_id, lock=True)
            if case["status"] != "OPEN":
                raise invalid_transition("Refresh the settlement case.")
            now = self._now(conn)
            event = charge.get("event_id") is not None
            if event and case["kind"] == "EVENT_FULFILMENT_INFEASIBLE":
                from ..eventsettlement.application import resolve_infeasible_deposit
                resolve_infeasible_deposit(conn, order, charge, admin, now, reason, context)
            if charge["top_up_due_at"] and charge["state"] in ACTIVE_CHARGE:
                if now < charge["top_up_due_at"] or store.pending_timely_proof(conn, charge):
                    raise invalid_transition("Adjudicate the active top-up before resolving the case.")
            case = one(conn, """
                UPDATE settlement_case SET status = 'RESOLVED', resolved_at = %s, resolved_by = %s
                WHERE id = %s RETURNING *
            """, (now, admin, case_id))
            if event:
                from ..eventsettlement import expire_if_unprotected
                expire_if_unprotected(conn, order, charge, now)
            else:
                store.expire_if_unprotected(conn, order, charge, now)
            store.record_audit(conn, admin, case_id, "CASE_RESOLVED", context, {"kind": case["kind"]})
            return case_view(case)

        with self.db.transaction() as conn:
            return command(conn, admin, "resolveSettlementCase", context, [case_id, reason], lambda: run(conn))
