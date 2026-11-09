import base64
import binascii
import json
import re
from datetime import datetime
from uuid import UUID

from psycopg import errors
from psycopg.types.json import Jsonb

from ..capacity.domain import is_handoff_eligible, myt_date, require_role
from ..capacity.infrastructure import command, database_time, lock_policy, read_days, read_policy, uuid
from ..capacity.order import bump_capacity_impact, mark_capacity_used, reallocate_capacity
from ..db import Database, iso, one, rows
from ..order.domain import PROOF_WINDOW, at_millisecond
from ..order.infrastructure import insert_charge, schedule_expiry
from ..order.input import _handoff_instant
from ..problems import Problem, validation
from . import infrastructure as store
from .domain import (
    ACTIVE, MAX_MINOR, TERMINAL, TRANSITIONS, UNACCEPTED, action_input, boolean, choice, conflict,
    consent, integer, require, require_version, safe_text, verify_agreement,
)
from .projection import adjustment_detail, contact_merchant, order_detail, read_orders


def _cursor(value: str | None, owner: str) -> tuple[datetime | None, UUID | None]:
    if value is None:
        return None, None
    try:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,250}", value):
            raise ValueError
        scope, account, timestamp, order_id = json.loads(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)))
        if scope != "own-orders-desc" or account != owner:
            raise ValueError
        return datetime.fromisoformat(_handoff_instant(timestamp)), UUID(uuid(order_id))
    except (Problem, binascii.Error, TypeError, ValueError):
        raise Problem("VALIDATION", 400, "Use the cursor returned with the previous page.") from None


def _next_cursor(owner: str, anchor: dict) -> str:
    payload = ["own-orders-desc", owner, anchor["created_at"].isoformat(), str(anchor["id"])]
    return base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")


class FulfilmentService:
    def __init__(self, db: Database, duitnow_qr_url: str | None = None, whatsapp_url: str | None = None, *,
                 clock=None, terms=None):
        self.db = db
        self.duitnow_qr_url = duitnow_qr_url
        self.whatsapp_url = whatsapp_url
        self.clock = clock
        self.terms = terms

    def _now(self, conn) -> datetime:
        return datetime.fromisoformat(database_time(conn, self.clock))

    def list_own_orders(self, actor, cursor: str | None, limit: int) -> dict:
        owner = require_role(actor, "CUSTOMER")
        limit = integer(limit, 1, 100, "the page limit")
        created_at, order_id = _cursor(cursor, owner)
        with self.db.transaction() as conn:
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            page = rows(
                conn,
                """SELECT id, created_at FROM standard_order WHERE account_id = %(owner)s
                     AND (%(created)s::timestamptz IS NULL OR (created_at, id) < (%(created)s, %(id)s::uuid))
                    ORDER BY created_at DESC, id DESC LIMIT %(limit)s""",
                {"owner": owner, "created": created_at, "id": order_id, "limit": limit + 1},
            )
            items = read_orders(
                conn, [row["id"] for row in page[:limit]], self._now(conn),
                self.duitnow_qr_url, self.whatsapp_url, owner_id=owner,
            )
            next_cursor = _next_cursor(owner, page[limit - 1]) if len(page) > limit else None
            return {"items": items, "nextCursor": next_cursor}

    def get_own_order(self, actor, order_id: str) -> dict:
        owner = require_role(actor, "CUSTOMER")
        return self._detail(uuid(order_id), owner_id=owner)

    def get_merchant_order(self, actor, order_id: str) -> dict:
        require_role(actor, "ADMIN")
        return self._detail(uuid(order_id), admin=True)

    def _detail(self, order_id: str, **scope) -> dict:
        with self.db.transaction() as conn:
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            return order_detail(conn, order_id, self._now(conn), self.duitnow_qr_url, self.whatsapp_url, **scope)

    def _run(self, actor, role, order_id, version, context, operation, intent, apply) -> dict:
        actor_id = require_role(actor, role)
        order_id = uuid(order_id)
        owner = actor_id if role == "CUSTOMER" else None

        for attempt in range(3):
            try:
                with self.db.transaction() as conn:
                    def run():
                        order = store.locked_order(conn, order_id, owner)
                        require_version(order, version)
                        return apply(conn, order, actor_id, context.request_id)

                    result = command(conn, actor_id, operation, context, [order_id, version, intent], run)
                    # Serialize the returned projection with the same parent as the mutation, including replay.
                    order = store.locked_order(conn, order_id, owner)
                    now = self._now(conn)
                    if "chargeId" in result:
                        return adjustment_detail(conn, order, result["chargeId"], now, self.duitnow_qr_url)
                    return order_detail(
                        conn, order_id, now, self.duitnow_qr_url, self.whatsapp_url, owner_id=owner,
                    )
            except (errors.SerializationFailure, errors.DeadlockDetected):
                if attempt == 2:
                    raise

    def _terms(self, order: dict) -> dict:
        if self.terms is not None:
            return self.terms()
        return {"version": order["terms_version"], "text": order["fulfilment_snapshot"]["termsText"]}

    def quote_delivery_fee(self, actor, order_id, version, body, context) -> dict:
        serviceable = boolean(body.get("serviceable"), "whether delivery is serviceable")
        offered = {
            "serviceable": serviceable,
            "reason": safe_text(body.get("reason"), "the fee offer reason", 500),
            "handoffAt": _handoff_instant(body.get("handoffAt")) if serviceable or "handoffAt" in body else None,
            "feeMinor": integer(body.get("feeMinor"), 0, MAX_MINOR, "the delivery fee")
            if serviceable or "feeMinor" in body else None,
        }

        def apply(conn, order, actor_id, request_id):
            require(order["status"] == "AWAITING_FEE", "This order is not awaiting a delivery offer.")
            if offered["feeMinor"] is not None and order["subtotal_minor"] + offered["feeMinor"] > MAX_MINOR:
                raise validation("The delivery total exceeds the supported amount.")
            if serviceable:
                store.check_offer_capacity(conn, order, offered["handoffAt"], self.clock)
            revision = (order["fee_version"] or 0) + 1
            require(revision <= 999, "This order has reached the fee revision limit.")
            now = self._now(conn)
            store.insert_offer(conn, order, revision, offered, self._terms(order), now)
            updated = store.update_order(conn, order, now, fee_version=revision)
            store.audit(
                conn, order, actor_id, "QUOTE_DELIVERY_FEE", now, request_id,
                change={"revision": revision, "serviceable": serviceable, "merchantReason": offered["reason"],
                        "toStatus": updated["status"], "orderVersion": updated["version"]},
            )
            return {"orderId": str(order["id"])}

        return self._run(actor, "ADMIN", order_id, version, context, "quoteDeliveryFee", offered, apply)

    def confirm_delivery_fee(self, actor, order_id, version, body, context) -> dict:
        fee_version = integer(body.get("feeVersion"), 1, 999, "the fee revision")
        terms_version = safe_text(body.get("termsVersion"), "the terms version", 40)

        def apply(conn, order, actor_id, request_id):
            require(order["status"] == "AWAITING_FEE", "This order is not awaiting fee confirmation.")
            offer = store.latest_offer(conn, order)
            if offer is None or offer["revision"] != fee_version:
                raise Problem("FEE_CHANGED", 409, "Review the current delivery offer.")
            require(offer["serviceable"], "This delivery offer cannot be confirmed.")
            terms = self._terms(order)
            if (
                terms_version != offer["terms_version"] or terms_version != terms["version"]
                or offer["terms_snapshot"]["termsText"] != terms["text"]
            ):
                raise Problem("TERMS_CHANGED", 409, "Review a delivery offer with the current terms.")
            handoff = offer["offered_handoff_at"]
            reallocate_capacity(conn, order["id"], handoff, "HELD", order["service_date"], clock=self.clock)
            now = at_millisecond(self._now(conn))
            deadline = now + PROOF_WINDOW
            snapshot = {**order["fulfilment_snapshot"], "termsText": terms["text"]}
            updated = store.update_order(
                conn, order, now, status="PENDING_PROOF", promised_handoff_at=handoff, service_date=myt_date(handoff),
                fee_minor=offer["fee_minor"], fee_confirmed_at=now, terms_version=terms_version,
                fulfilment_snapshot=Jsonb(snapshot), proof_due_at=deadline,
            )
            saved_id = str(order["id"])
            charge_id = insert_charge(conn, saved_id, updated["total_minor"], iso(deadline), iso(now))
            schedule_expiry(conn, saved_id, charge_id, iso(deadline), iso(now))
            store.audit(conn, order, actor_id, "CONFIRM_DELIVERY_FEE", now, request_id,
                        change={"revision": fee_version, "fromStatus": order["status"], "toStatus": updated["status"],
                                "orderVersion": updated["version"]})
            return {"orderId": saved_id}

        return self._run(
            actor, "CUSTOMER", order_id, version, context, "confirmDeliveryFee", [fee_version, terms_version], apply,
        )

    def cancel_own_order(self, actor, order_id, version, body, context) -> dict:
        no_transfer = boolean(body.get("noTransferSent"), "the no-transfer confirmation")

        def apply(conn, order, actor_id, request_id):
            charges = store.locked_charges(conn, order["id"])
            follow_up = contact_merchant(self.whatsapp_url, max_length=250)
            if not no_transfer or store.payment_evidence(conn, [charge["id"] for charge in charges]):
                raise conflict(follow_up)
            require(order["status"] in UNACCEPTED and order["accepted_at"] is None,
                    "This order cannot be cancelled by the customer.")
            now = self._now(conn)
            updated = store.close_order(conn, order, charges, now, "CANCELLED")
            store.audit(conn, order, actor_id, "CANCEL", now, request_id, reason_code="CUSTOMER_NO_TRANSFER",
                        change={"fromStatus": order["status"], "toStatus": updated["status"],
                                "orderVersion": updated["version"]})
            return {"orderId": str(order["id"])}

        return self._run(actor, "CUSTOMER", order_id, version, context, "cancelOwnOrder", no_transfer, apply)

    def change_standard_order(self, actor, order_id, version, body, context) -> dict:
        intent = action_input(body)

        def apply(conn, order, actor_id, request_id):
            action = intent["action"]
            now = self._now(conn)
            if action == "ACCEPT_CASH":
                require(order["payment_method"] == "CASH", "Only Cash pickup can be accepted here.")
                require(order["status"] == "AWAITING_CASH", "This order is not awaiting Cash acceptance.")
                updated = store.accept_order(conn, order, actor_id=actor_id, now=now)
            elif action in TRANSITIONS:
                updated = self._transition(conn, order, action, now)
            elif action in ("REJECT", "CANCEL", "MARK_NO_SHOW"):
                updated = self._close(conn, order, actor_id, intent, now)
            elif action == "RECORD_DRIVER_ARRIVAL":
                updated = self._driver_arrival(conn, order, intent, now)
            elif action == "HANDOFF":
                updated = self._handoff(conn, order, actor_id, intent, now)
            else:
                require(order["accepted_at"] is not None and order["status"] in ACTIVE | {"COMPLETED"},
                        "This order cannot record a fulfilment incident.")
                updated = store.update_order(conn, order, now, status="EXCEPTION")
                bump_capacity_impact(conn, [order["service_date"]])
            facts = {"fromStatus": order["status"], "toStatus": updated["status"], "orderVersion": updated["version"]}
            if "reason" in intent:
                facts["merchantReason"] = intent["reason"]
            for column in ("ready_at", "driver_arrived_at", "handoff_at"):
                if updated[column] != order[column]:
                    facts[column] = store.at(updated[column])
            store.audit(conn, order, actor_id, action, now, request_id,
                        reason_code=intent.get("cancellationBasis"), change=facts)
            return {"orderId": str(order["id"])}

        return self._run(actor, "ADMIN", order_id, version, context, "changeStandardOrder", intent, apply)

    @staticmethod
    def _transition(conn, order, action, now):
        expected, status = TRANSITIONS[action]
        require(order["status"] == expected and order["accepted_at"] is not None,
                "This order is not ready for that action.")
        values = {"status": status}
        if action == "START_PREPARATION":
            require(mark_capacity_used(conn, order["id"], order["service_date"]) > 0,
                    "This order has no committed production capacity.")
        else:
            bump_capacity_impact(conn, [order["service_date"]])
            if action == "MARK_READY":
                values["ready_at"] = now
        return store.update_order(conn, order, now, **values)

    @staticmethod
    def _close(conn, order, actor_id, intent, now):
        action = intent["action"]
        status = order["status"]
        charges = store.locked_charges(conn, order["id"])
        charge_ids = [charge["id"] for charge in charges]
        if action == "REJECT":
            require(status in UNACCEPTED and order["accepted_at"] is None,
                    "An accepted order cannot be rejected.")
            require(not store.payment_evidence(conn, charge_ids), "Resolve the payment evidence before rejecting this order.")
            result = "REJECTED"
        elif action == "MARK_NO_SHOW":
            require(
                order["payment_method"] == "CASH" and order["fulfilment"] == "PICKUP"
                and status in ("ACCEPTED", "PREPARING", "READY") and order["accepted_at"] is not None
                and now >= order["promised_handoff_at"] and not store.payment_evidence(conn, charge_ids),
                "Only a due, uncollected Cash pickup can be marked as a no-show.",
            )
            result = "NO_SHOW"
        else:
            require(status not in TERMINAL, "This order is already closed.")
            if intent["cancellationBasis"] == "MERCHANT_UNABLE":
                store.record_refund_obligations(conn, charges, actor_id)
            result = "CANCELLED"
        return store.close_order(conn, order, charges, now, result)

    @staticmethod
    def _driver_arrival(conn, order, intent, now):
        recovery = store.latest_recovery(conn, order["id"])
        since = recovery["recorded_at"] if recovery else order["accepted_at"]
        arrival = datetime.fromisoformat(intent["driverArrivedAt"])
        require(
            order["fulfilment"] != "PICKUP" and order["accepted_at"] is not None
            and store.status_before_incident(conn, order) in ("ACCEPTED", "PREPARING", "READY")
            and not store.has_current_arrival(conn, order, recovery),
            "A driver arrival cannot be recorded for this handoff.",
        )
        if not since <= arrival <= now:
            raise validation("The driver arrival time must be after acceptance or recovery and no later than now.")
        return store.update_order(conn, order, now, driver_arrived_at=arrival)

    @staticmethod
    def _handoff(conn, order, actor_id, intent, now):
        require(order["accepted_at"] is not None and store.status_before_incident(conn, order) == "READY"
                and order["ready_at"] is not None, "The order must be ready before handoff.")
        recovery = store.latest_recovery(conn, order["id"])
        earliest = max(order["ready_at"], recovery["recorded_at"]) if recovery else order["ready_at"]
        if store.has_current_arrival(conn, order, recovery):
            earliest = max(earliest, order["driver_arrived_at"])
        handoff = datetime.fromisoformat(intent["handoffAt"]) if "handoffAt" in intent else now
        if not earliest <= handoff <= now:
            raise validation("The handoff time must follow readiness and any driver arrival and be no later than now.")
        status = "HANDED_OFF"
        if order["payment_method"] == "CASH":
            charge = store.standard_charge(store.locked_charges(conn, order["id"]))
            store.collect_cash(conn, order, charge, actor_id, handoff, now)
            status = "COMPLETED"
        bump_capacity_impact(conn, [order["service_date"]])
        return store.update_order(conn, order, now, status=status, handoff_at=handoff)

    def reschedule_standard_order(self, actor, order_id, version, body, context) -> dict:
        recovery = {
            "kind": choice(body.get("recoveryKind"), ("RESCHEDULE", "REDELIVERY"), "the recovery kind"),
            "handoffAt": _handoff_instant(body.get("proposedHandoffAt")),
            "newProduction": boolean(body.get("requiresNewProduction"), "whether new production is needed"),
            "reason": safe_text(body.get("reason"), "the recovery reason", 500),
            "consent": consent(body.get("consent")),
        }

        def apply(conn, order, actor_id, request_id):
            now = self._now(conn)
            verify_agreement(recovery["consent"], order, now)
            require(order["status"] in ("AWAITING_CASH", "ACCEPTED", "PREPARING", "READY", "EXCEPTION"),
                    "This order cannot be rescheduled in its current state.")
            if recovery["kind"] == "REDELIVERY":
                require(order["fulfilment"] != "PICKUP" and order["status"] == "EXCEPTION"
                        and order["accepted_at"] is not None,
                        "Redelivery requires an accepted delivery with a recorded incident.")
            updated = self._reschedule(conn, order, actor_id, recovery, now)
            agreement_id = store.insert_agreement(conn, order, actor_id, now, recovery)
            store.audit(
                conn, order, actor_id, recovery["kind"], now, request_id,
                change={"agreementId": agreement_id, "fromStatus": order["status"], "toStatus": updated["status"],
                        "previousPromise": store.at(order["promised_handoff_at"]),
                        "newPromise": recovery["handoffAt"], "merchantReason": recovery["reason"]},
            )
            return {"orderId": str(order["id"])}

        return self._run(actor, "ADMIN", order_id, version, context, "rescheduleStandardOrder", recovery, apply)

    def _reschedule(self, conn, order, actor_id, recovery, now):
        handoff = datetime.fromisoformat(recovery["handoffAt"])
        day = myt_date(handoff)
        require(recovery["newProduction"] or handoff != order["promised_handoff_at"], "Choose a different handoff time.")
        values = {"promised_handoff_at": handoff, "service_date": day}
        if order["status"] == "AWAITING_CASH":
            require(not recovery["newProduction"], "Accept the Cash order before committing production.")
            store.check_offer_capacity(conn, order, recovery["handoffAt"], self.clock)
            bump_capacity_impact(conn, [order["service_date"], day])
            return store.update_order(conn, order, now, **values)

        if order["accepted_at"] is None:
            charge = store.standard_charge(store.locked_charges(conn, order["id"]))
            require(store.paid_infeasible_case(conn, charge), "This order has no verified payment eligible for rescheduling.")
            reallocate_capacity(conn, order["id"], handoff, "COMMITTED", order["service_date"], clock=self.clock)
            store.resolve_infeasible_case(conn, charge, actor_id, now)
            return store.accept_order(conn, {**order, **values}, actor_id=actor_id, now=now, allocation_already_committed=True)

        production = one(
            conn,
            """SELECT MAX(generation) FILTER (WHERE state = 'COMMITTED') IS NOT NULL AS committed,
                      MAX(generation) FILTER (WHERE state = 'USED') IS NOT NULL AS used
                 FROM capacity_allocation WHERE order_id = %s""",
            (order["id"],),
        )
        if recovery["newProduction"] or production["committed"]:
            reallocate_capacity(conn, order["id"], handoff, "COMMITTED", order["service_date"], clock=self.clock)
            return store.update_order(conn, order, now, status="ACCEPTED", **values)

        require(production["used"], "This order has no production to reuse.")
        lock_policy(conn, "share")
        bump_capacity_impact(conn, [order["service_date"], day])
        day_row = read_days(conn, day, day)
        if (day_row and day_row[0]["closed"]) or not is_handoff_eligible(read_policy(conn), self._now(conn), handoff, 0):
            raise Problem("CAPACITY_UNAVAILABLE", 409, "Choose an available handoff time.")
        previous = store.status_before_incident(conn, order)
        status = "READY" if previous in ("READY", "HANDED_OFF", "COMPLETED") else "PREPARING"
        return store.update_order(conn, order, now, status=status, **values)

    def create_delivery_adjustment(self, actor, order_id, version, body, context) -> dict:
        recovery = {
            "kind": "DELIVERY_ADJUSTMENT",
            "amountMinor": integer(body.get("amountMinor"), 1, MAX_MINOR, "the delivery adjustment amount"),
            "reason": safe_text(body.get("reason"), "the delivery adjustment reason", 500),
            "consent": consent(body.get("consent")),
        }

        def apply(conn, order, actor_id, request_id):
            now = self._now(conn)
            verify_agreement(recovery["consent"], order, now)
            require(
                order["accepted_at"] is not None and order["fulfilment"] != "PICKUP" and order["payment_method"] == "DUITNOW"
                and order["status"] in ACTIVE | {"COMPLETED"},
                "This order is not eligible for a delivery adjustment.",
            )
            charges = store.locked_charges(conn, order["id"])
            require(sum(charge["category"] == "STANDARD_ADJUSTMENT" for charge in charges) < 20,
                    "This order has reached the delivery adjustment limit.")
            agreement_id = store.insert_agreement(conn, order, actor_id, now, recovery)
            charge_id = store.adjustment_charge(conn, order, agreement_id, recovery["amountMinor"], now)
            store.update_order(conn, order, now, status=order["status"])
            store.audit(conn, order, actor_id, "DELIVERY_ADJUSTMENT", now, request_id,
                        change={"agreementId": agreement_id, "chargeId": charge_id, "merchantReason": recovery["reason"]})
            return {"orderId": str(order["id"]), "chargeId": charge_id}

        return self._run(actor, "ADMIN", order_id, version, context, "createDeliveryAdjustment", recovery, apply)
