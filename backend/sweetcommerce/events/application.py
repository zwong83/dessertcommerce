import base64
import binascii
import json
from uuid import uuid4

from psycopg.types.json import Jsonb

from ..capacity.domain import require_role, uuid
from ..capacity.infrastructure import command
from ..db import one
from ..problems import Problem, unavailable, validation
from ..refunds.infrastructure import create_full_refund_obligations
from ..settlement import infrastructure as settlement
from ..settlement.domain import ACTIVE_CHARGE
from . import domain, infrastructure as store, projection


_CANCELLATION_TERMS = "\n\nYou can cancel free of charge before sending any transfer, including after accepting this quote."


class EventService:
    def __init__(self, db, *, terms, duitnow_qr_url=None, whatsapp_url=None, clock=None):
        self.db = db
        self.terms = terms
        self.qr_url = duitnow_qr_url
        self.clock = clock

    def submit_event_request(self, actor, body, context):
        actor_id = require_role(actor, "CUSTOMER")
        request = domain.intake(body)
        key = uuid(context.idempotency_key)
        with self.db.transaction() as conn:
            def apply():
                now = store.now_at(conn, self.clock)
                event_id, created = store.submission(conn, actor_id, key, request, now, domain.check_lead_time)
                if created:
                    event = store.get_event(conn, event_id, actor_id)
                    store.notice(conn, event, "EVENT_REQUEST_RECEIVED", now)
                    store.notice(conn, event, "MERCHANT_EVENT_INTAKE", now, recipient_role="ADMIN")
                    store.record_audit(conn, actor_id, event_id, "SUBMIT_EVENT_REQUEST", context)
                return {"eventId": str(event_id)}

            intent = json.dumps(request, sort_keys=True)
            result = command(conn, actor_id, "submitEventRequest", context, intent, apply)
            event = store.get_event(conn, result["eventId"], actor_id)
            return projection.event_view(conn, event, store.now_at(conn, self.clock), self.qr_url)

    def list_own_events(self, actor, limit=25, cursor=None):
        actor_id = require_role(actor, "CUSTOMER")
        limit = domain.integer(limit, "the page size", 1, 100)
        position = _decode_cursor(cursor)
        with self.db.transaction() as conn:
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            now = store.now_at(conn, self.clock)
            page = store.list_events(conn, actor_id, limit + 1, position)
            items = [projection.event_view(conn, event, now, self.qr_url) for event in page[:limit]]
            return {"items": items, "nextCursor": _encode_cursor(page[limit - 1]) if len(page) > limit else None}

    def get_own_event(self, actor, event_id):
        return self._read(actor, event_id, admin=False)

    def get_merchant_event(self, actor, event_id):
        return self._read(actor, event_id, admin=True)

    def get_own_command_outcome(self, actor, operation, key):
        actor_id = require_role(actor, "CUSTOMER")
        if operation not in ("submitEventRequest", "acceptEventQuote", "cancelEventRequest"):
            raise domain.missing()
        with self.db.connection() as conn:
            return store.command_outcome(conn, actor_id, operation, uuid(key))

    def _read(self, actor, event_id, *, admin):
        actor_id = require_role(actor, "ADMIN" if admin else "CUSTOMER")
        with self.db.transaction() as conn:
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            event = store.get_event(conn, uuid(event_id), None if admin else actor_id)
            return projection.event_view(
                conn, event, store.now_at(conn, self.clock), self.qr_url, admin=admin, merchant=admin,
            )

    def _mutate(self, actor, event_id, body, expected, context, *, admin, operation, apply):
        actor_id = require_role(actor, "ADMIN" if admin else "CUSTOMER")
        event_id = uuid(event_id)
        account_id = None if admin else actor_id
        intent = json.dumps([event_id, expected, body], sort_keys=True)
        with self.db.transaction() as conn:
            def run():
                event = store.lock_event(conn, event_id, account_id=account_id)
                if event["version"] != expected:
                    raise domain.stale()
                apply(conn, event, actor_id)
                return {"eventId": event_id}

            command(conn, actor_id, operation, context, intent, run)
            event = store.get_event(conn, event_id, account_id)
            return projection.event_view(conn, event, store.now_at(conn, self.clock), self.qr_url, admin=admin)

    def _terms(self):
        terms = self.terms()
        try:
            return {
                "version": domain.text(terms["version"], "the published terms version", 40),
                "text": domain.text(terms["text"], "the published terms", 3000 - len(_CANCELLATION_TERMS))
                + _CANCELLATION_TERMS,
            }
        except (Problem, KeyError, TypeError):
            raise unavailable() from None

    def issue_event_quote(self, actor, event_id, body, expected, context):
        details = domain.quote_details(body)

        def apply(conn, event, actor_id):
            is_unaccepted_expiry = event["status"] == "EXPIRED" and not store.charges_for_event(conn, event["id"])
            if event["status"] not in ("APPLIED", "QUOTED") and not is_unaccepted_expiry:
                raise domain.transition("Only an unaccepted event request can receive a quote.")
            terms = self._terms()
            if details["termsVersion"] != terms["version"]:
                raise domain.terms_changed()
            previous = store.current_quote(conn, event["id"])
            if previous and previous["version"] >= 999:
                raise domain.transition("This event has reached its quote revision limit.")
            store.lock_windows(conn, event["id"], details["window"])
            store.assert_window_available(conn, event["id"], *details["window"])
            now = store.now_at(conn, self.clock)
            cutoff = domain.quote_cutoff(details, now)
            if details["window"][0] <= now:
                raise validation("Choose a future resource window.")
            if previous and previous["status"] == "OFFERED":
                store.change_windows(conn, event["id"], "RELEASED")
                store.set_quote_status(conn, previous, "SUPERSEDED")
            details["snapshot"].update(
                termsText=terms["text"], equipment=[{"id": str(uuid4()), **item} for item in details["equipment"]],
            )
            quote_id = store.add_quote(conn, event, actor_id, previous, details, now, cutoff)
            store.bump_window_revisions(conn, store.resource_dates(*details["window"]))
            event = store.update_event(conn, event["id"], now, status="QUOTED")
            version = previous["version"] + 1 if previous else 1
            store.enqueue_quote_work(conn, event, quote_id, version, cutoff, now)
            store.notice(conn, event, "EVENT_QUOTE_ISSUED", now, revision=version, quoteId=str(quote_id))
            store.record_audit(conn, actor_id, event["id"], "ISSUE_QUOTE", context, change={"quoteId": str(quote_id)})

        return self._mutate(
            actor, event_id, body, expected, context, admin=True, operation="issueEventQuote", apply=apply,
        )

    def accept_event_quote(self, actor, event_id, body, expected, context):
        consent = domain.acceptance(body)

        def apply(conn, event, actor_id):
            quote = store.current_quote(conn, event["id"])
            if quote is None or str(quote["id"]) != consent["quoteId"] or quote["version"] != consent["quoteVersion"]:
                raise domain.stale()
            now = store.now_at(conn, self.clock)
            if quote["status"] == "EXPIRED" or quote["status"] == "OFFERED" and now >= quote["deposit_due_at"]:
                raise Problem("QUOTE_EXPIRED", 409, "The deposit window has closed. Ask the merchant for a new offer.")
            if quote["status"] != "OFFERED" or event["status"] != "QUOTED":
                raise domain.transition()
            terms = self._terms()
            if (quote["terms_version"] != consent["termsVersion"] or quote["terms_version"] != terms["version"]
                    or quote["quote_snapshot"]["termsText"] != terms["text"]):
                raise domain.terms_changed()
            held = one(conn, "SELECT status FROM resource_window WHERE quote_id = %s", (quote["id"],))
            if held is None or held["status"] != "HELD":
                raise domain.transition("The quoted resource window is no longer available.")
            charge_id = store.add_charge(
                conn, event["id"], "EVENT_DEPOSIT", quote["deposit_minor"], quote["deposit_due_at"], now,
                quote_id=quote["id"],
            )
            store.set_quote_status(conn, quote, "CUSTOMER_ACCEPTED")
            store.update_event(conn, event["id"], now, status="AWAITING_DEPOSIT")
            store.record_audit(conn, actor_id, event["id"], "ACCEPT_QUOTE", context, change={
                "quoteId": str(quote["id"]), "quoteVersion": quote["version"], "chargeId": str(charge_id),
            })

        return self._mutate(
            actor, event_id, body, expected, context, admin=False, operation="acceptEventQuote", apply=apply,
        )

    def cancel_event_request(self, actor, event_id, body, expected, context):
        domain.object_fields(body, ("noTransferSent",))
        domain.confirmed(body, "noTransferSent")

        def apply(conn, event, actor_id):
            self._cancel(conn, event, actor_id, "CUSTOMER_REQUEST", None, context, body)

        return self._mutate(
            actor, event_id, body, expected, context, admin=False, operation="cancelEventRequest", apply=apply,
        )

    def change_event_booking(self, actor, event_id, body, expected, context):
        action = domain.choice(body.get("action"), ACTION_REQUIRED, "the event action")
        required, optional = ACTION_REQUIRED[action]
        domain.object_fields(body, ("action", *required), optional)
        reason = domain.text(body["reason"], "the action reason", 500) if "reason" in body else None
        basis = domain.cancellation_basis(body) if action == "CANCEL" else None
        if basis == "CUSTOMER_REQUEST":
            domain.confirmed(body, "noTransferSent")
        elif basis == "BALANCE_OVERDUE":
            domain.confirmed(body, "noBalanceFundsReceived")
        if action == "CANCEL":
            attestation = {"CUSTOMER_REQUEST": {"noTransferSent"}, "BALANCE_OVERDUE": {"noBalanceFundsReceived"}}.get(basis, set())
            domain.object_fields(body, ("action", "cancellationBasis", "reason", *attestation))
        proposed = domain.schedule(body["alternativeSchedule"]) if action == "PROPOSE_ALTERNATE_DATE" else None

        def apply(conn, event, actor_id):
            if action == "CANCEL":
                self._cancel(conn, event, actor_id, basis, reason, context, body)
                return
            now = store.now_at(conn, self.clock)
            if action in ("DECLINE", "PROPOSE_ALTERNATE_DATE"):
                self._plan(conn, event, action, proposed, reason, now)
            else:
                self._service_action(conn, event, actor_id, action, body, now)
            store.record_audit(conn, actor_id, event["id"], action, context)

        return self._mutate(
            actor, event_id, body, expected, context, admin=True, operation="changeEventBooking", apply=apply,
        )

    def _plan(self, conn, event, action, proposed, reason, now):
        if event["status"] not in ("APPLIED", "QUOTED"):
            raise domain.transition()
        if proposed and domain.instant(proposed["setupReadyAt"]) <= now:
            raise validation("Choose a future alternative schedule.")
        quote = store.current_quote(conn, event["id"])
        if quote and quote["status"] == "OFFERED":
            store.change_windows(conn, event["id"], "RELEASED")
            store.set_quote_status(conn, quote, "SUPERSEDED" if proposed else "CANCELLED")
        event = store.update_event(
            conn, event["id"], now, status="APPLIED" if proposed else "DECLINED",
            alternative_schedule=Jsonb(proposed) if proposed else None, disposition_reason=reason,
        )
        store.notice(conn, event, "EVENT_ALTERNATE_PROPOSED" if proposed else "EVENT_DECLINED", now)

    def _cancel(self, conn, event, actor_id, basis, reason, context, body):
        if event["status"] not in domain.ACTIVE_EVENT:
            raise domain.transition()
        charges = store.charges_for_event(conn, event["id"], lock=True)
        now = store.now_at(conn, self.clock)
        if basis == "CUSTOMER_REQUEST":
            if event["status"] not in domain.PRE_TRANSFER or store.payment_evidence(
                conn, [charge["id"] for charge in charges], any_proof=True,
            ):
                raise domain.transition("Customer cancellation is available only before any payment is sent.")
        elif basis == "BALANCE_OVERDUE":
            balance = next((item for item in charges if item["category"] == "EVENT_BALANCE"), None)
            cutoff = event["effective_balance_grace_ends_at"] or event["effective_balance_due_at"]
            if (event["status"] not in ("BOOKED", "BALANCE_GRACE") or balance is None
                    or balance["state"] not in ACTIVE_CHARGE or cutoff is None or now <= cutoff
                    or store.payment_evidence(conn, [balance["id"]], any_proof=False)):
                raise domain.transition("Balance cancellation requires an elapsed cutoff and resolved payment review.")
        elif basis == "MERCHANT_UNABLE":
            for charge in charges:
                create_full_refund_obligations(conn, charge["id"], actor_id, "MERCHANT_UNABLE")

        store.change_windows(conn, event["id"], "RELEASED")
        quote = store.current_quote(conn, event["id"])
        if quote and quote["status"] in ("OFFERED", "CUSTOMER_ACCEPTED", "CONFIRMED"):
            store.set_quote_status(conn, quote, "CANCELLED")
        for charge in charges:
            if charge["state"] in ACTIVE_CHARGE:
                settlement.update_charge(conn, charge["id"], "CANCELLED")
        event = store.update_event(
            conn, event["id"], now, status="CANCELLED", disposition_reason=reason,
            effective_balance_due_at=None, effective_balance_grace_ends_at=None,
            balance_deadline_revision=event["balance_deadline_revision"] + 1,
        )
        attestations = {field: True for field in ("noTransferSent", "noBalanceFundsReceived") if body.get(field) is True}
        store.record_audit(conn, actor_id, event["id"], "CANCEL", context, basis=basis, change=attestations)
        store.notice(conn, event, "EVENT_CANCELLED", now)

    def reschedule_event_booking(self, actor, event_id, body, expected, context):
        details = domain.reschedule_details(body)

        def apply(conn, event, actor_id):
            if (event["status"] not in domain.BOOKING_STATES or event["actual_setup_at"] is not None
                    or details["obligationDisposition"] != "KEEP_APPROVED_TERMS"):
                raise domain.transition("The event requires an eligible replacement and consent to the approved terms.")
            quote = store.current_quote(conn, event["id"])
            charges = store.charges_for_event(conn, event["id"], lock=True)
            balance = next((item for item in charges if item["category"] == "EVENT_BALANCE"), None)
            deposit = next((item for item in charges if item["category"] == "EVENT_DEPOSIT"), None)
            plan = details["balancePlan"]
            if (quote is None or quote["status"] not in ("CUSTOMER_ACCEPTED", "CONFIRMED") or deposit is None
                    or deposit["state"] != "PAID" or balance is None or str(balance["id"]) != plan["chargeId"]):
                raise domain.transition("Choose the current booking and original balance charge.")
            if one(conn, "SELECT 1 FROM equipment_check WHERE event_id = %s LIMIT 1", (event["id"],)):
                raise domain.transition("The event has already started service preparation.")
            store.lock_windows(conn, event["id"], details["window"])
            store.assert_window_available(conn, event["id"], *details["window"])
            now = store.now_at(conn, self.clock)
            agreed_at = domain.instant(details["consent"]["agreedAt"])
            if details["window"][0] <= now or not event["created_at"] <= agreed_at <= now:
                raise validation("Record the consent already given and choose a future resource window.")
            schedule = details["schedule"]
            day = domain.local_day(domain.instant(schedule["eventStartAt"]))
            due, grace = self._replacement_deadlines(conn, balance, plan, day, now)

            store.change_windows(conn, event["id"], "RELEASED")
            store.add_reschedule(conn, event, quote, details, actor_id, now)
            store.bump_window_revisions(conn, store.resource_dates(*details["window"]))
            store.set_quote_status(conn, quote, "CONFIRMED")
            if due is not None:
                conn.execute("UPDATE charge SET due_at = %s, version = version + 1 WHERE id = %s", (due, balance["id"]))
            event = store.update_event(
                conn, event["id"], now, status="BOOKED" if due else "PROCEEDING",
                event_date=day, start_at=schedule["eventStartAt"], expected_end_at=schedule["eventEndAt"],
                setup_ready_at=schedule["setupReadyAt"], booked_at=event["booked_at"] or now,
                effective_balance_due_at=due, effective_balance_grace_ends_at=grace,
                balance_deadline_revision=event["balance_deadline_revision"] + 1,
            )
            from ..invoices.application import issue_booking

            issue_booking(conn, event, quote["id"], now)
            conn.execute("""
                UPDATE settlement_case SET status = 'RESOLVED', resolved_at = %s, resolved_by = %s
                WHERE charge_id = %s AND kind = 'EVENT_FULFILMENT_INFEASIBLE' AND status = 'OPEN'
            """, (now, actor_id, deposit["id"]))
            if due is not None:
                from ..eventsettlement import enqueue_balance_work

                enqueue_balance_work(conn, event, now)
            store.notice(conn, event, "EVENT_RESCHEDULED", now, revision=event["balance_deadline_revision"])
            store.record_audit(conn, actor_id, event["id"], "RESCHEDULE", context, change={
                "balanceDeadlineRevision": event["balance_deadline_revision"],
            })

        return self._mutate(
            actor, event_id, body, expected, context, admin=True, operation="rescheduleEventBooking", apply=apply,
        )

    @staticmethod
    def _replacement_deadlines(conn, balance, plan, day, now):
        if plan["state"] == "SETTLED":
            if balance["state"] != "PAID":
                raise domain.transition("Only a verified balance can use the settled plan.")
            return None, None
        if balance["state"] not in ACTIVE_CHARGE or one(
            conn, "SELECT 1 FROM payment_proof WHERE charge_id = %s AND state = 'REVIEW' LIMIT 1", (balance["id"],),
        ):
            raise domain.transition("Resolve the current balance review before setting a replacement deadline.")
        due, grace = (domain.instant(plan[field]) for field in ("dueAt", "graceEndsAt"))
        if due <= now or domain.local_day(due) != day - domain.DAY * 3 or grace != due + domain.DAY:
            raise validation("Set a future balance deadline on the new MYT event date minus three days, with 24 hours of grace.")
        return due, grace

    def _service_action(self, conn, event, actor_id, action, body, now):
        quote = store.current_quote(conn, event["id"])
        if quote is None or quote["status"] != "CONFIRMED" or event["booked_at"] is None:
            raise domain.transition("Confirm the booking and original balance before recording service.")
        equipment = store.equipment_ledger(conn, event["id"])
        if action in SERVICE_TIMED:
            at = domain.instant(body["at"], "the actual service time")
            if not event["booked_at"] <= at <= now:
                raise validation("Record an actual time from booking confirmation through the current time.")
            if action == "RECORD_EQUIPMENT_OUT":
                self._equipment_out(conn, event, quote, equipment, body, at, now)
            elif action == "RECORD_EQUIPMENT_CHECK":
                self._inspect_equipment(conn, event, equipment, body, at, actor_id, now)
            else:
                self._record_service_time(conn, event, quote, equipment, action, at, now)
            return
        self._finish_service(conn, event, quote, equipment, action, body, now)

    @staticmethod
    def _equipment_out(conn, event, quote, equipment, body, at, now):
        if event["status"] != "PROCEEDING" or event["actual_end_at"] is not None or equipment:
            raise domain.transition("Record the equipment taken before recording the actual event end.")
        expected = {item["id"]: item for item in quote["quote_snapshot"]["equipment"]}
        taken = domain.service_entries(body, "equipmentOut", ("equipmentId", "taken"))
        if taken.keys() != expected.keys():
            raise validation("Include every equipment item from this event.")
        values = []
        for equipment_id, entry in taken.items():
            item = expected[equipment_id]
            count = domain.integer(entry["taken"], "the quantity taken", 0, item["quantity"])
            values.append((event["id"], equipment_id, item["name"], count, at))
        with conn.cursor() as cursor:
            cursor.executemany("""
                INSERT INTO equipment_check (event_id, equipment_id, item_name, taken, taken_at)
                VALUES (%s, %s, %s, %s, %s)
            """, values)
        store.update_event(conn, event["id"], now, status=event["status"])

    @staticmethod
    def _record_service_time(conn, event, quote, equipment, action, at, now):
        if event["status"] != "PROCEEDING":
            raise domain.transition()
        setup, end = event["actual_setup_at"], event["actual_end_at"]
        if action == "RECORD_SETUP":
            if setup is not None:
                raise domain.transition("The actual setup has already been recorded.")
            if store.change_windows(conn, event["id"], "USED") != 1:
                raise domain.transition("Confirm the active resource window before recording setup.")
            store.update_event(conn, event["id"], now, actual_setup_at=at)
        elif action == "RECORD_ACTUAL_END":
            if setup is None or end is not None or at <= setup or any(at < item["taken_at"] for item in equipment):
                raise domain.transition("Record event end after setup and the equipment taken.")
            if len(equipment) != len(quote["quote_snapshot"]["equipment"]):
                raise domain.transition("Record the equipment taken before recording event end.")
            store.update_event(conn, event["id"], now, actual_end_at=at)
        else:
            if end is None or at < end or event["actual_teardown_at"] is not None:
                raise domain.transition("Record teardown after the actual event end.")
            store.update_event(conn, event["id"], now, actual_teardown_at=at, status="EQUIPMENT_CHECK")

    @staticmethod
    def _inspect_equipment(conn, event, equipment, body, at, actor_id, now):
        teardown = event["actual_teardown_at"]
        if event["status"] != "EQUIPMENT_CHECK" or teardown is None or at < teardown or any(
            item["checked_at"] is not None for item in equipment
        ):
            raise domain.transition("Record inspection after teardown.")
        expected = {str(item["equipment_id"]): item for item in equipment}
        checked = domain.service_entries(body, "equipmentCheck", ("equipmentId", "name", "returned", "damaged", "lost"))
        if checked.keys() != expected.keys():
            raise validation("Inspect the equipment recorded for this event.")
        values = []
        for equipment_id, entry in checked.items():
            item = expected[equipment_id]
            returned, damaged, lost = (
                domain.integer(entry[key], "the inspection count", 0, 999) for key in ("returned", "damaged", "lost")
            )
            if entry["name"] != item["item_name"] or returned + lost != item["taken"] or damaged > returned:
                raise validation("Match the equipment identity and account for each item taken.")
            values.append((returned, damaged, lost, at, actor_id, event["id"], equipment_id))
        with conn.cursor() as cursor:
            cursor.executemany("""
                UPDATE equipment_check SET returned = %s, damaged = %s, lost = %s, checked_at = %s, checked_by = %s
                WHERE event_id = %s AND equipment_id = %s
            """, values)
        event = store.update_event(conn, event["id"], now, status=event["status"])
        if any(damaged or lost for _, damaged, lost, *_ in values):
            store.notice(conn, event, "EVENT_EQUIPMENT_DAMAGE_LOSS", now)

    @staticmethod
    def _finish_service(conn, event, quote, equipment, action, body, now):
        event_id = event["id"]
        if event["status"] not in ("EQUIPMENT_CHECK", "ADDITIONAL_BILL") or not projection.equipment_complete(quote, equipment):
            raise domain.transition("Complete teardown and the equipment inspection before closing service.")
        extra = one(conn, "SELECT id, state FROM charge WHERE event_id = %s AND category = 'EVENT_EXTRA'", (event_id,))
        if action == "ISSUE_EXTRAS":
            if event["status"] != "EQUIPMENT_CHECK" or extra is not None:
                raise domain.transition("An extra invoice can be issued only once after inspection.")
            lines, total = domain.extra_lines(body["extras"])
            due = event["actual_end_at"] + domain.DAY * 2
            charge_id = store.add_charge(conn, event_id, "EVENT_EXTRA", total, due, now, bill={
                "lines": lines, "sourceQuoteId": str(quote["id"]), "termsVersion": quote["terms_version"],
            })
            from ..invoices.application import issue_extras

            issue_extras(conn, event, quote, lines, total, due, now)
            event = store.update_event(conn, event_id, now, status="ADDITIONAL_BILL")
            store.notice(conn, event, "EVENT_EXTRAS_ISSUED", now, chargeId=str(charge_id), deadline=domain.wire(due))
        else:
            if event["status"] == "ADDITIONAL_BILL" and (extra is None or extra["state"] != "PAID"):
                raise domain.transition("Verify the separate extra charge before completing the event.")
            event = store.update_event(conn, event_id, now, status="COMPLETED")
            store.notice(conn, event, "EVENT_COMPLETED", now)


SERVICE_TIMED = {
    "RECORD_SETUP": ("at",), "RECORD_ACTUAL_END": ("at",), "RECORD_TEARDOWN": ("at",),
    "RECORD_EQUIPMENT_OUT": ("at", "equipmentOut"), "RECORD_EQUIPMENT_CHECK": ("at", "equipmentCheck"),
}
ACTION_REQUIRED = {
    "DECLINE": (("reason",), ()),
    "PROPOSE_ALTERNATE_DATE": (("alternativeSchedule", "reason"), ()),
    "CANCEL": (("cancellationBasis", "reason"), ("noTransferSent", "noBalanceFundsReceived")),
    "ISSUE_EXTRAS": (("extras",), ("reason",)),
    "COMPLETE": ((), ("reason",)),
    **{key: (fields, ("reason",)) for key, fields in SERVICE_TIMED.items()},
}


def _encode_cursor(event):
    key = f"{domain.wire(event['created_at'])}|{event['id']}"
    return base64.urlsafe_b64encode(key.encode()).decode()


def _decode_cursor(cursor):
    if cursor is None:
        return None
    try:
        if not isinstance(cursor, str) or not 1 <= len(cursor) <= 500:
            raise ValueError
        value = base64.b64decode(cursor, altchars=b"-_", validate=True).decode()
        timestamp, key = value.split("|")
        return domain.instant(timestamp), uuid(key)
    except (ValueError, binascii.Error, Problem):
        raise validation("Use a valid event page cursor.") from None
