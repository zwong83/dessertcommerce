from base64 import b64encode

from psycopg.types.json import Jsonb

from ..capacity.domain import require_role, uuid
from ..db import one, rows
from ..events.domain import MYT
from ..events.infrastructure import get_event, lock_event, now_at
from ..problems import InvalidTransition, ResourceNotFound, VersionConflict
from .pdf import DEFAULT_LOGO, render_invoice, render_preview
from .template import DEFAULT_TEMPLATE, validated_template

KINDS = ("booking", "extras")


def _template(conn):
    return one(conn, "SELECT * FROM invoice_template WHERE id = 1") or {
        "version": 1, "draft": DEFAULT_TEMPLATE, "published_revision": 1, "published": DEFAULT_TEMPLATE,
    }


def _template_view(record):
    return {
        "version": record["version"], "draft": record["draft"],
        "publishedRevision": record["published_revision"],
        "hasUnpublishedChanges": record["draft"] != record["published"],
    }


def _number(number):
    return f"GD-INV-{number:06}"


def _date(value):
    return value.astimezone(MYT).strftime("%d %b %Y, %H:%M MYT")


def _address(venue):
    return "\n".join(filter(None, (
        venue["line1"], venue.get("line2"), venue["postcode"] + " " + venue["city"], venue["region"],
    )))


def _has_billing_source(event):
    request = event["request_snapshot"]
    return bool(request.get("contactName") and request.get("venue"))


def _event_details(event, now, kind, quote):
    request = event["request_snapshot"]
    snapshot = quote["quote_snapshot"]
    return {
        "kind": kind, "issued": _date(now), "eventNumber": event["event_number"],
        "billedTo": snapshot.get("billingName") or request["contactName"],
        "billingAddress": snapshot.get("billingAddress", ""),
        "venue": _address(request["venue"]), "eventAt": _date(event["start_at"]),
        "setupAt": _date(event["setup_ready_at"]),
        "terms": snapshot.get("termsText") if kind == "booking" else None,
    }


def _issue(conn, event, kind, now, data):
    existing = one(conn, "SELECT number FROM event_invoice WHERE event_id = %s AND kind = %s", (event["id"], kind))
    if existing:
        return existing["number"]
    record = _template(conn)
    template = record["published"]
    if template["header"]["logo"] is None and DEFAULT_LOGO.is_file():
        template = {**template, "header": {**template["header"], "logo": {
            "mediaType": "image/webp", "data": b64encode(DEFAULT_LOGO.read_bytes()).decode("ascii"),
        }}}
    source = {"template": template, "data": data}
    invoice = one(conn, """
        INSERT INTO event_invoice (event_id, kind, number, template_revision, issued_at, source)
        VALUES (%s, %s, nextval('event_invoice_number'), %s, %s, %s)
        ON CONFLICT (event_id, kind) DO NOTHING RETURNING number
    """, (event["id"], kind, record["published_revision"], now, Jsonb(source)))
    if invoice is None:
        invoice = one(conn, "SELECT number FROM event_invoice WHERE event_id = %s AND kind = %s", (event["id"], kind))
    return invoice["number"]


def issue_booking(conn, event, quote_id, now):
    if not _has_billing_source(event):
        return None
    quote = one(conn, "SELECT * FROM event_quote WHERE id = %s AND event_id = %s", (quote_id, event["id"]))
    snapshot = quote["quote_snapshot"]
    lines = snapshot.get("invoiceLines") or [{
        "description": snapshot.get("packageSummary") or "Dessert table package", "amountMinor": quote["total_minor"],
    }]
    due = event["effective_balance_due_at"]
    data = {
        **_event_details(event, now, "booking", quote), "lines": lines,
        "totalMinor": quote["total_minor"], "depositMinor": quote["deposit_minor"], "balanceMinor": quote["balance_minor"],
        "dueAt": _date(due) if due else None,
    }
    return _issue(conn, event, "booking", now, data)


def issue_extras(conn, event, quote, lines, total, due, now):
    if not _has_billing_source(event):
        return None
    data = {
        **_event_details(event, now, "extras", quote), "totalMinor": total, "dueAt": _date(due),
        "actualEndAt": _date(event["actual_end_at"]),
        "lines": [{"description": line["item"] + "\n" + line["reason"], "amountMinor": line["amountMinor"]} for line in lines],
    }
    return _issue(conn, event, "extras", now, data)


def sample_invoice(kind):
    sample = {
        "kind": kind, "number": "SAMPLE", "issued": "13 Nov 2026",
        "eventNumber": "EV-SAMPLE", "eventAt": "28 Nov 2026, 13:00 MYT",
        "setupAt": "28 Nov 2026, 12:30 MYT", "billedTo": "Sample customer",
        "billingAddress": "10 Example Street\nKuala Lumpur", "venue": "Example Hall\nKuala Lumpur",
    }
    if kind == "extras":
        return {
            **sample, "actualEndAt": "28 Nov 2026, 15:30 MYT", "dueAt": "30 Nov 2026, 15:30 MYT",
            "totalMinor": 8500,
            "lines": [
                {"description": "Additional staffing\nExtended event service", "amountMinor": 6000},
                {"description": "Equipment damage\nCake stand", "amountMinor": 2500},
            ],
        }
    return {
        **sample, "totalMinor": 96000, "depositMinor": 48000, "balanceMinor": 48000,
        "dueAt": "25 Nov 2026, 13:00 MYT",
        "lines": [
            {"description": label, "quantity": 1, "unitPriceMinor": value, "amountMinor": value}
            for label, value in (("Dessert table package", 78000), ("Setup service", 12000), ("Delivery", 6000))
        ],
    }


class InvoiceService:
    def __init__(self, db, *, clock=None):
        self.db = db
        self.clock = clock

    def template(self, actor):
        require_role(actor, "ADMIN")
        with self.db.connection() as conn:
            return _template_view(_template(conn))

    def save_template(self, actor, template, version, *, publish):
        admin = require_role(actor, "ADMIN")
        template = validated_template(template)
        with self.db.transaction() as conn:
            conn.execute("""
                INSERT INTO invoice_template (id, version, draft, published_revision, published)
                VALUES (1, 1, %s, 1, %s) ON CONFLICT (id) DO NOTHING
            """, (Jsonb(DEFAULT_TEMPLATE), Jsonb(DEFAULT_TEMPLATE)))
            current = one(conn, "SELECT * FROM invoice_template WHERE id = 1 FOR UPDATE")
            if version != current["version"]:
                raise VersionConflict("Another merchant changed this template. Reload it before saving.")
            new_version = version + 1
            record = one(conn, """
                UPDATE invoice_template SET version = %s, draft = %s, published_revision = %s, published = %s,
                    updated_by = %s WHERE id = 1 RETURNING *
            """, (new_version, Jsonb(template), new_version if publish else current["published_revision"],
                  Jsonb(template if publish else current["published"]), admin))
        return _template_view(record)

    def preview(self, actor, template, kind):
        require_role(actor, "ADMIN")
        return render_preview(render_invoice(validated_template(template), sample_invoice(kind)))

    def list(self, actor, event_id, *, admin):
        account = require_role(actor, "ADMIN" if admin else "CUSTOMER")
        with self.db.connection() as conn:
            event = get_event(conn, uuid(event_id), None if admin else account)
            invoices = rows(conn, "SELECT kind, number FROM event_invoice WHERE event_id = %s ORDER BY number", (event["id"],))
            result = {"items": [{"kind": item["kind"], "number": _number(item["number"])} for item in invoices]}
            if admin:
                existing = {item["kind"] for item in invoices}
                eligible = []
                has_billing = _has_billing_source(event)
                if has_billing and event["booked_at"] and event["status"] != "CANCELLED":
                    eligible.append("booking")
                if has_billing and event["actual_end_at"] and one(conn, """
                    SELECT 1 FROM charge WHERE event_id = %s AND category = 'EVENT_EXTRA' AND bill_snapshot IS NOT NULL
                """, (event["id"],)):
                    eligible.append("extras")
                result["canIssue"] = [kind for kind in eligible if kind not in existing]
        return result

    def issue_existing(self, actor, event_id, kind):
        require_role(actor, "ADMIN")
        with self.db.transaction() as conn:
            event = lock_event(conn, uuid(event_id))
            existing = one(conn, "SELECT number FROM event_invoice WHERE event_id = %s AND kind = %s", (event["id"], kind))
            if existing:
                return {"kind": kind, "number": _number(existing["number"])}
            if not _has_billing_source(event):
                raise InvalidTransition("The event contact and venue are required to issue this invoice.")
            now = now_at(conn, self.clock)
            if kind == "booking":
                quote = one(conn, "SELECT id FROM event_quote WHERE event_id = %s AND status = 'CONFIRMED' ORDER BY version DESC LIMIT 1", (event["id"],))
                if not event["booked_at"] or not quote:
                    raise InvalidTransition("A confirmed booking is required to issue this invoice.")
                number = issue_booking(conn, event, quote["id"], now)
            else:
                charge = one(conn, """
                    SELECT expected_minor, due_at, bill_snapshot FROM charge
                    WHERE event_id = %s AND category = 'EVENT_EXTRA'
                """, (event["id"],))
                if not event["actual_end_at"] or not charge or not charge["bill_snapshot"]:
                    raise InvalidTransition("An issued post-event charge is required to issue this invoice.")
                bill = charge["bill_snapshot"]
                quote = one(conn, "SELECT * FROM event_quote WHERE id = %s AND event_id = %s",
                            (bill["sourceQuoteId"], event["id"]))
                number = issue_extras(conn, event, quote, bill["lines"], charge["expected_minor"], charge["due_at"], now)
        return {"kind": kind, "number": _number(number)}

    def download(self, actor, event_id, kind, *, admin):
        account = require_role(actor, "ADMIN" if admin else "CUSTOMER")
        with self.db.transaction() as conn:
            event = get_event(conn, uuid(event_id), None if admin else account)
            invoice = one(conn, "SELECT * FROM event_invoice WHERE event_id = %s AND kind = %s", (event["id"], kind))
            if invoice is None:
                raise ResourceNotFound("The invoice was not found.")
            number = _number(invoice["number"])
            pdf = invoice["pdf"]
            if pdf is None:
                source = invoice["source"]
                rendered = render_invoice(source["template"], {**source["data"], "number": number})
                conn.execute("""
                    UPDATE event_invoice SET pdf = %s WHERE event_id = %s AND kind = %s AND pdf IS NULL
                """, (rendered, event["id"], kind))
                pdf = one(conn, "SELECT pdf FROM event_invoice WHERE event_id = %s AND kind = %s", (event["id"], kind))["pdf"]
        return number, pdf
