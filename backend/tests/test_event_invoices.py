from base64 import b64decode
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pypdfium2

from conftest import API, ORIGIN
from test_events import _receipt, consent, context, quote_body, request
from sweetcommerce.events.application import EventService
from sweetcommerce.invoices.application import sample_invoice
from sweetcommerce.invoices.pdf import render_invoice
from sweetcommerce.invoices.template import DEFAULT_TEMPLATE


def _text(pdf):
    with pypdfium2.PdfDocument(pdf) as document:
        result = []
        for page in document:
            text = page.get_textpage()
            try:
                result.append(text.get_text_bounded())
            finally:
                text.close()
                page.close()
    return result


def test_template_preview_publication_and_private_invoice_download(client, db, clock, sign_in):
    phone = "+60123456789"
    admin_phone = "+60123456780"
    owner, customer_headers = sign_in(phone=phone)
    _, foreign_headers = sign_in()
    merchant, admin_headers = sign_in("ADMIN", phone=admin_phone)
    template_path = API + "/admin/invoice-template"
    assert client.get(template_path, headers=customer_headers).status_code == 403
    initial = client.get(template_path, headers=admin_headers).json()
    draft = initial["draft"]
    draft["header"]["title"] = "Custom invoice"
    draft["order"].remove("payment")
    draft["order"].insert(2, "payment")
    draft["footer"] = {"visible": True, "text": "Thanks for celebrating with us."}
    body = {"template": draft}
    preview = template_path + "/preview/"
    assert client.post(preview + "booking", json=body, headers=customer_headers).status_code == 403
    for kind in ("booking", "extras"):
        sample = client.post(preview + kind, json=body, headers=admin_headers)
        assert sample.status_code == 200, sample.text
        assert b64decode(sample.json()["pages"][0]).startswith(b"\x89PNG")
    assert client.post(preview + "booking", json={"template": {**draft, "order": ["footer"]}},
                       headers=admin_headers).status_code == 422

    saved = client.put(template_path + "/draft", json=body, headers=admin_headers | {"If-Match": '"1"'})
    assert saved.status_code == 200, saved.text
    assert saved.json()["publishedRevision"] == 1 and saved.json()["hasUnpublishedChanges"]

    customer = SimpleNamespace(account_id=owner["accountId"], role="CUSTOMER")
    admin = SimpleNamespace(account_id=merchant["accountId"], role="ADMIN")
    events = EventService(db, terms=lambda: {"version": "synthetic-v1", "text": "Booking terms."}, clock=clock)
    event = events.submit_event_request(customer, request(), context())
    offer = quote_body(total=101) | {
        "termsVersion": "synthetic-v1", "billingName": "Billing customer", "billingAddress": "12 Test Road",
        "invoiceLines": [{"description": "Setup service", "quantity": 1, "unitPriceMinor": 101}],
    }
    issued = events.issue_event_quote(admin, event["id"], offer, event["version"], context())
    awaiting = events.accept_event_quote(customer, event["id"], consent(issued), issued["version"], context())
    own_path = API + "/events/" + event["id"] + "/invoices"
    merchant_path = API + "/admin/events/" + event["id"] + "/invoices"
    assert client.get(own_path, headers=customer_headers).json() == {"items": []}
    _receipt(db, clock, admin, awaiting["charges"][0])
    booked = events.get_merchant_event(admin, event["id"])

    published = client.post(template_path + "/publish", json=body, headers=admin_headers | {"If-Match": '"2"'})
    assert published.status_code == 200, published.text
    assert published.json()["publishedRevision"] == 3
    assert client.post(template_path + "/publish", json=body, headers=admin_headers | {"If-Match": '"2"'}).status_code == 409

    booking = client.get(own_path + "/booking/pdf", headers=customer_headers)
    assert booking.status_code == 200, booking.text if booking.status_code != 200 else ""
    assert booking.headers["content-type"] == "application/pdf"
    assert booking.headers["content-disposition"].startswith('attachment; filename="GD-INV-')
    assert booking.headers["cache-control"] == "private, no-store"
    booking_text = " ".join(_text(booking.content))
    assert "Setup service" in booking_text and "Billing customer" in booking_text and "12 Test Road" in booking_text
    assert "0.51" in booking_text and "0.50" in booking_text
    assert "Custom invoice" not in booking_text
    assert client.get(own_path + "/booking/pdf", headers=foreign_headers).status_code == 404
    client.cookies.clear()
    assert client.get(own_path + "/booking/pdf").status_code == 401
    assert client.get(merchant_path + "/booking/pdf", headers=customer_headers).status_code == 403
    assert client.get(merchant_path + "/booking/pdf", headers=admin_headers).content == booking.content

    _receipt(db, clock, admin, next(charge for charge in booked["charges"] if charge["category"] == "EVENT_BALANCE"))
    event = events.get_merchant_event(admin, event["id"])
    equipment = event["quote"]["equipment"][0]["id"]
    clock.current = datetime(2030, 1, 8, 10, tzinfo=UTC)
    for command in (
        {"action": "RECORD_EQUIPMENT_OUT", "at": "2030-01-08T04:00:00Z", "equipmentOut": [{"equipmentId": equipment, "taken": 3}]},
        {"action": "RECORD_SETUP", "at": "2030-01-08T04:30:00Z"},
        {"action": "RECORD_ACTUAL_END", "at": "2030-01-08T07:30:00Z"},
        {"action": "RECORD_TEARDOWN", "at": "2030-01-08T08:00:00Z"},
        {"action": "RECORD_EQUIPMENT_CHECK", "at": "2030-01-08T08:15:00Z",
         "equipmentCheck": [{"equipmentId": equipment, "name": "Cake stand", "returned": 3, "damaged": 0, "lost": 0}]},
        {"action": "ISSUE_EXTRAS", "extras": [{"item": "Staffing", "amountMinor": 2000, "reason": "Extended service"}]},
    ):
        event = events.change_event_booking(admin, event["id"], command, event["version"], context())
    _, customer_headers = sign_in(phone=phone)
    challenge = client.post(API + "/admin/auth/challenges", json={"verifiedContact": admin_phone}, headers={"Origin": ORIGIN})
    admin_login = client.post(API + "/admin/auth/sign-in", headers={"Origin": ORIGIN},
                              json={"challengeId": challenge.json()["challengeId"], "code": "123456"})
    assert admin_login.status_code == 200, admin_login.text
    admin_headers = {
        "Origin": ORIGIN, "X-CSRF-Token": admin_login.json()["csrfToken"],
        "Cookie": admin_login.headers["set-cookie"].split(";", 1)[0],
    }
    customer_event = client.get(API + "/events/" + event["id"], headers=customer_headers)
    assert customer_event.status_code == 200 and customer_event.json()["extraInvoices"] == []
    extra = client.get(own_path + "/extras/pdf", headers=customer_headers)
    assert extra.status_code == 200
    extra_text = " ".join(_text(extra.content))
    assert "Custom invoice" in extra_text and "Staffing" in extra_text and "10 Jan 2030, 15:30 MYT" in extra_text
    assert "Unit price" not in extra_text
    assert client.get(own_path + "/booking/pdf", headers=customer_headers).content == booking.content
    listed = client.get(own_path, headers=customer_headers).json()["items"]
    assert [item["kind"] for item in listed] == ["booking", "extras"]
    assert client.post(merchant_path + "/extras", headers=admin_headers | {"Idempotency-Key": str(uuid4())}).json() == listed[1]


def test_invoice_table_repeats_headings_and_keeps_long_rows_and_total():
    sample = sample_invoice("extras")
    sample["lines"] = [
        {"description": f"Extra item {index + 1}\n" + "Additional staff for the extended event. " * 12, "amountMinor": 100}
        for index in range(40)
    ]
    sample["totalMinor"] = 4000
    pages = _text(render_invoice(DEFAULT_TEMPLATE, sample))
    assert len(pages) > 1
    assert sum("Description" in page for page in pages) > 1
    assert "Extra item 40" in " ".join(pages)
    assert "RM 40.00" in " ".join(pages)
