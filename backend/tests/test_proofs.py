from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from hashlib import sha256
from io import BytesIO
from threading import Event
from uuid import uuid4

import pytest
from PIL import Image
from psycopg.types.json import Jsonb

from conftest import API
from sweetcommerce.capacity.infrastructure import CapacityCommand
from sweetcommerce.db import iso, one
from sweetcommerce.identity.domain import Session
from sweetcommerce.problems import Problem
from sweetcommerce.proofs import infrastructure as proof_store
from sweetcommerce.proofs.application import ProofService
from sweetcommerce.proofs.domain import MAX_PROOF_BYTES
from sweetcommerce.worker import poll_expiry
from test_api_contract import _assert_json_contract

DAY = "2030-01-01"


class Objects:
    def __init__(self):
        self.data = {}
        self.writes = 0

    def put(self, key, data):
        self.writes += 1
        assert key not in self.data
        self.data[key] = data

    def get(self, key):
        return self.data.get(key)

    def delete(self, key):
        self.data.pop(key, None)


def _image(colour="red", file_format="PNG"):
    with BytesIO() as output:
        Image.new("RGB", (8, 8), colour).save(output, format=file_format)
        return output.getvalue()


def _pdf(padding=0):
    doc = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, content in enumerate([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] >>",
    ], 1):
        offsets.append(len(doc))
        doc.extend(f"{number} 0 obj\n".encode() + content + b"\nendobj\n")
    doc.extend(b"\n" * padding)
    xref = len(doc)
    doc.extend(b"xref\n0 4\n0000000000 65535 f \n")
    for offset in offsets:
        doc.extend(f"{offset:010d} 00000 n \n".encode())
    doc.extend(f"trailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(doc)


def _command():
    return CapacityCommand(str(uuid4()), str(uuid4()))


def _headers(actor, *, key=None, media_type="image/png"):
    return {
        **actor, "Idempotency-Key": key or str(uuid4()), "Content-Type": "application/octet-stream",
        "X-File-Media-Type": media_type,
    }


def _customer(db, now):
    actor_id = uuid4()
    phone = "+601" + str(actor_id.int % 10**8).zfill(8)
    with db.transaction() as conn:
        conn.execute("INSERT INTO account (id, role, phone_e164) VALUES (%s,'CUSTOMER',%s)", (actor_id, phone))
    return Session(str(actor_id), "CUSTOMER", "fixture", now + timedelta(hours=1))


@pytest.fixture
def standard(db):
    def seed(account_id, deadline, *, status="PENDING_PROOF", state="OPEN", top_up=False):
        order, charge, review, product = (uuid4() for _ in range(4))
        initial = deadline - timedelta(hours=1) if top_up else deadline
        opened = initial - timedelta(minutes=30)
        held = status not in {"CANCELLED", "EXPIRED", "REJECTED"}
        with db.transaction() as conn:
            conn.execute("INSERT INTO product (id,name,status) VALUES (%s,'Test dessert','LISTED')", (product,))
            conn.execute(
                """INSERT INTO capacity_day (service_date,closed,max_units,allocated_units) VALUES (%s,false,100,%s)
                   ON CONFLICT (service_date) DO UPDATE
                   SET allocated_units = capacity_day.allocated_units + excluded.allocated_units""",
                (DAY, int(held)),
            )
            conn.execute(
                """INSERT INTO checkout_review (id,account_id,cart_version,review_digest,terms_version,review_snapshot,
                          expires_at,updated_at)
                   VALUES (%s,%s,1,%s,'fixture','{}',%s,%s)""",
                (review, account_id, bytes(32), initial, opened),
            )
            conn.execute(
                """INSERT INTO standard_order (id,order_number,account_id,checkout_review_id,status,fulfilment,
                          payment_method,service_date,requested_handoff_at,fulfilment_snapshot,subtotal_minor,fee_minor,
                          terms_version,proof_due_at,created_at,updated_at)
                   VALUES (%s,%s,%s,%s,%s,'PICKUP','DUITNOW',%s,%s,'{}',450,0,'fixture',%s,%s,%s)""",
                (order, str(order), account_id, review, status, DAY, deadline + timedelta(days=1), initial, opened, opened),
            )
            conn.execute(
                """INSERT INTO charge (id,order_id,category,state,expected_minor,due_at,created_at,
                          top_up_requested_at,top_up_due_at,top_up_outstanding_minor)
                   VALUES (%s,%s,'STANDARD',%s,450,%s,%s,%s,%s,%s)""",
                (charge, order, state, initial, opened, deadline - timedelta(minutes=30) if top_up else None,
                 deadline if top_up else None, 100 if top_up else None),
            )
            conn.execute(
                """INSERT INTO capacity_allocation (order_id,service_date,product_id,quantity,state,generation)
                   VALUES (%s,%s,%s,1,%s,1)""",
                (order, DAY, product, "HELD" if held else "RELEASED"),
            )
            kind = "STANDARD_TOP_UP_EXPIRY" if top_up else "STANDARD_PROOF_EXPIRY"
            conn.execute(
                """INSERT INTO durable_work (id,event_key,kind,resource_id,work_state,not_before,payload,created_at)
                   VALUES (%s,%s,%s,%s,'READY',%s,%s,%s)""",
                (uuid4(), f"{kind}:{order}:1", kind, order, deadline,
                 Jsonb({"deadline": deadline.isoformat() if top_up else iso(deadline), "chargeId": str(charge)}), opened),
            )
        return str(order), str(charge)
    return seed


@pytest.fixture
def event_charge(db):
    def seed(owner, admin, cutoff, category, *, grace=False):
        event, quote, charge = (uuid4() for _ in range(3))
        deposit = category == "EVENT_DEPOSIT"
        deposit_due = cutoff if deposit else cutoff - timedelta(days=5)
        original_balance_due = cutoff + timedelta(days=1) if deposit else cutoff - timedelta(days=1)
        effective_due = None if deposit else (original_balance_due if grace else cutoff)
        grace_ends = cutoff if grace else None
        issued = deposit_due - timedelta(days=1)
        start = cutoff + timedelta(days=10)
        end = start + timedelta(hours=3)
        setup, teardown = start - timedelta(hours=1), end + timedelta(hours=1)
        with db.transaction() as conn:
            conn.execute(
                """INSERT INTO event_application (id,event_number,account_id,submission_intent_id,submission_digest,
                          status,event_date,start_at,expected_end_at,setup_ready_at,request_snapshot,
                          effective_balance_due_at,effective_balance_grace_ends_at,created_at,updated_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'{}',%s,%s,%s,%s)""",
                (event, str(event), owner, uuid4(), bytes(32), "AWAITING_DEPOSIT" if deposit else "BOOKED",
                 start.date(), start, end, setup, effective_due, grace_ends, issued, issued),
            )
            conn.execute(
                """INSERT INTO event_quote (id,event_id,version,status,total_minor,deposit_minor,balance_minor,
                          issued_at,deposit_due_at,balance_due_at,event_start_at,event_end_at,setup_ready_at,
                          teardown_at,quote_snapshot,terms_version)
                   VALUES (%s,%s,1,%s,901,451,450,%s,%s,%s,%s,%s,%s,%s,'{}','fixture')""",
                (quote, event, "CUSTOMER_ACCEPTED" if deposit else "CONFIRMED", issued, deposit_due,
                 original_balance_due, start, end, setup, teardown),
            )
            conn.execute(
                """INSERT INTO resource_window (quote_id,starts_at,ends_at,status,assessed_by,assessment_note,planned_staff)
                   VALUES (%s,%s,%s,%s,%s,'Fixture',1)""",
                (quote, setup, teardown, "HELD" if deposit else "BOOKED", admin),
            )
            conn.execute(
                """INSERT INTO charge (id,event_id,quote_id,category,state,expected_minor,due_at,created_at)
                   VALUES (%s,%s,%s,%s,'OPEN',%s,%s,%s)""",
                (charge, event, quote, category, 451 if deposit else 450,
                 deposit_due if deposit else original_balance_due, issued),
            )
        return str(event), str(quote), str(charge)
    return seed


def _snapshot(db, order, charge):
    with db.connection() as conn:
        return one(
            conn,
            """SELECT o.status, o.version AS order_version, c.state, c.version AS charge_version, a.state AS allocation,
                      c.top_up_due_at, c.top_up_requested_at
                 FROM standard_order o JOIN charge c ON c.order_id = o.id
                 JOIN capacity_allocation a ON a.order_id = o.id WHERE o.id = %s AND c.id = %s""",
            (order, charge),
        )


def test_proof_http_replay_dedupe_isolation_keyset_and_safe_download(db, client, sign_in, standard, clock):
    customer, owner = sign_in()
    _, foreign = sign_in()
    admin, merchant = sign_in("ADMIN")
    order, charge = standard(customer["accountId"], clock.current + timedelta(minutes=10))
    _, other_charge = standard(customer["accountId"], clock.current + timedelta(minutes=10))
    submit = f"{API}/charges/{charge}/proof"
    listing = f"{API}/admin/charges/{charge}/proofs"
    headers = _headers(owner)
    image = _image()

    assert client.post(submit, content=image, headers=_headers(foreign)).json()["code"] == "NOT_FOUND"
    assert client.post(submit, content=image, headers=_headers(merchant)).json()["code"] == "FORBIDDEN"
    assert client.post(submit, content=image, headers={**headers, "X-CSRF-Token": "wrong"}).json()["code"] == "FORBIDDEN"
    assert client.post(submit, content=image, headers={**headers, "Origin": "https://foreign.test"}).json()["code"] == "ORIGIN_DENIED"
    with ThreadPoolExecutor(max_workers=2) as threads:
        results = list(threads.map(lambda _: client.post(submit, content=image, headers=headers), range(2)))
    for response in results:
        assert response.status_code == 201, response.text
        _assert_json_contract(response, "submitChargeProof")
    first = results[0].json()
    assert results[1].json() == first
    assert first["reviewDisposition"] == "TIMELY"
    assert client.post(submit, content=image, headers=_headers(owner)).json() == first
    conflict = client.post(submit, content=_image("blue"), headers=headers)
    assert conflict.status_code == 409 and conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"
    assert client.post(f"{API}/charges/{other_charge}/proof", content=image, headers=headers).status_code == 409

    second = client.post(submit, content=_image(file_format="JPEG"), headers=_headers(owner, media_type="image/jpeg"))
    assert second.status_code == 201, second.text
    download = f"{API}/admin/proofs/{first['id']}/content"
    assert client.get(download, headers=owner).json()["code"] == "FORBIDDEN"
    assert client.get(listing, headers=owner).json()["code"] == "FORBIDDEN"
    client.cookies.clear()
    assert client.get(download).json()["code"] == "UNAUTHENTICATED"
    assert client.get(f"{API}/admin/proofs/{uuid4()}/content", headers=merchant).status_code == 404

    page = client.get(listing, params={"limit": 1}, headers=merchant)
    assert page.status_code == 200, page.text
    _assert_json_contract(page, "listPaymentProofs")
    cursor = page.json()["nextCursor"]
    last = client.get(listing, params={"limit": 1, "cursor": cursor}, headers=merchant)
    assert last.status_code == 200 and last.json()["nextCursor"] is None
    assert {item["id"] for item in page.json()["items"] + last.json()["items"]} == {first["id"], second.json()["id"]}
    other_list = f"{API}/admin/charges/{other_charge}/proofs"
    assert client.get(other_list, params={"cursor": cursor}, headers=merchant).status_code == 400
    assert client.get(other_list, headers=merchant).json() == {"items": [], "nextCursor": None}
    assert client.get(listing, params={"limit": 101}, headers=merchant).status_code == 400

    binary = client.get(download, headers=merchant)
    assert binary.status_code == 200
    assert binary.content == image
    assert binary.headers["content-type"] == "application/octet-stream"
    assert binary.headers["cache-control"] == "private, no-store"
    assert binary.headers["x-content-type-options"] == "nosniff"
    assert binary.headers["content-disposition"] == f'attachment; filename="payment-proof-{first["id"]}.png"'

    with db.transaction() as conn:
        assert one(conn, "SELECT count(*) AS n FROM payment_proof")["n"] == 2
        assert one(conn, "SELECT count(*) AS n FROM audit_event WHERE action = 'PROOF_REGISTERED'")["n"] == 2
        assert one(conn, "SELECT count(*) AS n FROM audit_event WHERE action = 'PROOF_LIST_READ'")["n"] == 3
        audit = one(conn, "SELECT actor_id,resource_id,request_id,safe_change FROM audit_event WHERE action = 'PROOF_CONTENT_READ'")
        assert (str(audit["actor_id"]), str(audit["resource_id"])) == (admin["accountId"], first["id"])
        assert audit["request_id"] == binary.headers["x-request-id"] and audit["safe_change"] == {"chargeId": charge}
        conn.execute("UPDATE payment_proof SET state = 'REJECTED' WHERE id = %s", (first["id"],))
    assert client.post(submit, content=image, headers=headers).json() == first
    snapshot = _snapshot(db, order, charge)
    assert (snapshot["order_version"], snapshot["charge_version"], snapshot["allocation"]) == (3, 3, "HELD")


def test_proof_http_validates_complete_bytes_and_stream_size(db, client, sign_in, standard, clock):
    customer, owner = sign_in()
    order, charge = standard(customer["accountId"], clock.current + timedelta(minutes=10))
    path = f"{API}/charges/{charge}/proof"
    padding = MAX_PROOF_BYTES - len(_pdf())
    valid = _pdf(padding - (len(_pdf(padding)) - MAX_PROOF_BYTES))
    assert len(valid) == MAX_PROOF_BYTES
    cases = [
        (b"", "image/png", 422, "VALIDATION"),
        (_image()[:-16], "image/png", 422, "VALIDATION"),
        (_image(file_format="JPEG")[:-20], "image/jpeg", 422, "VALIDATION"),
        (_image(), "image/jpeg", 422, "VALIDATION"),
        (_pdf().replace(b"00000 n", b"broken!"), "application/pdf", 422, "VALIDATION"),
        (b"%PDF-1.4\n%%EOF", "application/pdf", 422, "VALIDATION"),
        (_image(), "image/webp", 415, "UNSUPPORTED_MEDIA"),
        (valid + b"\n", "application/pdf", 413, "PAYLOAD_TOO_LARGE"),
    ]
    for data, media, status, code in cases:
        response = client.post(path, content=data, headers=_headers(owner, media_type=media))
        assert (response.status_code, response.json()["code"]) == (status, code), response.text
        _assert_json_contract(response, "submitChargeProof")

    response = client.post(path, content=iter([valid[:3000000], valid[3000000:], b"\n"]),
                           headers=_headers(owner, media_type="application/pdf"))
    assert response.status_code == 413
    wrong_type = {**_headers(owner), "Content-Type": "image/png"}
    assert client.post(path, content=_image(), headers=wrong_type).status_code == 415
    assert _snapshot(db, order, charge)["charge_version"] == 1
    with db.connection() as conn:
        assert one(conn, "SELECT count(*) AS n FROM payment_proof")["n"] == 0
    assert client.post(path, content=valid, headers=_headers(owner, media_type="application/pdf")).status_code == 201


@pytest.mark.parametrize(("offset", "disposition", "worker_result"), [
    (-1, "TIMELY", "preserved"),
    (0, "RECONCILIATION_ONLY", "expired"),
    (1, "RECONCILIATION_ONLY", "expired"),
])
def test_current_top_up_boundary_with_delayed_worker(db, worker_db, standard, offset, disposition, worker_result):
    with db.connection() as conn:
        cutoff = one(conn, "SELECT date_trunc('milliseconds', clock_timestamp()) - interval '1 second' AS cutoff")["cutoff"]
    cutoff += timedelta(microseconds=789)
    actor = _customer(db, cutoff)
    order, charge = standard(actor.account_id, cutoff, status="EXCEPTION", state="DISPUTED", top_up=True)
    received = cutoff + timedelta(microseconds=offset)
    service = ProofService(db, Objects(), clock=lambda: received)
    proof = service.submit_charge_proof(actor, charge, _image(), "image/png", _command())
    assert proof["reviewDisposition"] == disposition
    assert datetime.fromisoformat(proof["receivedAt"]) == received
    assert poll_expiry(worker_db) == worker_result
    assert poll_expiry(worker_db) is None

    snapshot = _snapshot(db, order, charge)
    assert snapshot["top_up_due_at"] == cutoff
    assert snapshot["top_up_requested_at"] == cutoff - timedelta(minutes=30)
    expected = ("PAYMENT_REVIEW", "PROOF_REVIEW", "HELD") if offset < 0 else ("EXPIRED", "EXPIRED", "RELEASED")
    assert (snapshot["status"], snapshot["state"], snapshot["allocation"]) == expected
    with db.connection() as conn:
        case = one(conn, "SELECT proof_id, kind, status FROM settlement_case WHERE charge_id = %s", (charge,))
        if offset < 0:
            assert case is None
        else:
            assert (str(case["proof_id"]), case["kind"], case["status"]) == (proof["id"], "LATE_PROOF", "OPEN")
        assert one(conn, "SELECT count(*) AS n FROM money_entry")["n"] == 0


def test_database_clock_and_expiry_can_win_while_object_write_is_in_progress(db, worker_db, standard):
    with db.connection() as conn:
        cutoff = one(conn, "SELECT date_trunc('milliseconds', clock_timestamp()) - interval '1 second' AS cutoff")["cutoff"]
    actor = _customer(db, cutoff)
    order, charge = standard(actor.account_id, cutoff)
    started, release = Event(), Event()

    class SlowObjects(Objects):
        def put(self, key, data):
            started.set()
            assert release.wait(5)
            super().put(key, data)

    service = ProofService(db, SlowObjects())
    with ThreadPoolExecutor(max_workers=1) as threads:
        pending = threads.submit(service.submit_charge_proof, actor, charge, _image(), "image/png", _command())
        try:
            assert started.wait(5)
            assert poll_expiry(worker_db) == "expired"
        finally:
            release.set()
        proof = pending.result(timeout=5)
    assert proof["reviewDisposition"] == "RECONCILIATION_ONLY"
    assert datetime.fromisoformat(proof["receivedAt"]) >= cutoff
    snapshot = _snapshot(db, order, charge)
    assert (snapshot["status"], snapshot["state"], snapshot["allocation"]) == ("EXPIRED", "EXPIRED", "RELEASED")


def test_reuploaded_initial_bytes_do_not_protect_top_up_and_cancelled_charge_never_reopens(db, worker_db, standard):
    with db.connection() as conn:
        cutoff = one(conn, "SELECT date_trunc('milliseconds', clock_timestamp()) - interval '1 second' AS cutoff")["cutoff"]
    actor = _customer(db, cutoff)
    order, charge = standard(actor.account_id, cutoff, status="EXCEPTION", state="DISPUTED", top_up=True)
    cancelled, closed_charge = standard(actor.account_id, cutoff, status="CANCELLED", state="CANCELLED")
    now = cutoff - timedelta(minutes=25)
    data = _image()
    objects = Objects()
    service = ProofService(db, objects, clock=lambda: now)
    digest = sha256(data).digest()
    key = proof_store.object_key(charge, digest)
    objects.put(key, data)
    with db.transaction() as conn:
        original = proof_store.record_proof(conn, charge, key, digest, len(data), "image/png", "TIMELY",
                                           cutoff - timedelta(minutes=61))
    repeated = service.submit_charge_proof(actor, charge, data, "image/png", _command())
    assert repeated["id"] == str(original["id"]) and objects.writes == 1

    late = service.submit_charge_proof(actor, closed_charge, data, "image/png", _command())
    assert late["reviewDisposition"] == "RECONCILIATION_ONLY"
    snapshot = _snapshot(db, cancelled, closed_charge)
    assert (snapshot["status"], snapshot["state"], snapshot["allocation"]) == ("CANCELLED", "CANCELLED", "RELEASED")
    assert {poll_expiry(worker_db), poll_expiry(worker_db)} == {"expired", "obsolete"}
    assert _snapshot(db, order, charge)["allocation"] == "RELEASED"


def test_failed_storage_and_rolled_back_registration_recover_without_public_evidence(db, standard, clock, monkeypatch):
    actor = _customer(db, clock.current)
    order, charge = standard(actor.account_id, clock.current + timedelta(minutes=10))
    data = _image()
    context = _command()

    class InterruptedObjects(Objects):
        def put(self, key, content):
            if self.writes == 0:
                super().put(key, content[:10])
                raise OSError("interrupted")
            super().put(key, content)

    objects = InterruptedObjects()
    service = ProofService(db, objects, clock=clock)
    with pytest.raises(Problem) as caught:
        service.submit_charge_proof(actor, charge, data, "image/png", context)
    assert caught.value.code == "DEPENDENCY_UNAVAILABLE" and not objects.data

    def fail_audit(*args):
        raise RuntimeError("transaction interrupted")

    with monkeypatch.context() as patch:
        patch.setattr(proof_store, "audit", fail_audit)
        with pytest.raises(RuntimeError, match="transaction interrupted"):
            service.submit_charge_proof(actor, charge, data, "image/png", context)
    assert not objects.data and _snapshot(db, order, charge)["charge_version"] == 1
    with db.connection() as conn:
        assert one(conn, "SELECT count(*) AS n FROM payment_proof")["n"] == 0
        assert one(conn, "SELECT count(*) AS n FROM command_receipt")["n"] == 0

    proof = service.submit_charge_proof(actor, charge, data, "image/png", context)
    linked_key = next(iter(objects.data))
    orphan_key = f"proofs/{charge}/{'1' * 64}"
    objects.put(orphan_key, b"orphan")
    assert service.reconcile_unlinked([linked_key, orphan_key]) == 1
    assert objects.data == {linked_key: data}
    assert service.submit_charge_proof(actor, charge, data, "image/png", context) == proof


def test_put_get_adapter_recovers_durable_bytes_left_before_metadata_commit(db, standard, clock, monkeypatch):
    actor = _customer(db, clock.current)
    _, charge = standard(actor.account_id, clock.current + timedelta(minutes=10))
    data, context = _image(), _command()

    class PutGetOnly:
        def __init__(self):
            self.backing = Objects()
            self.put = self.backing.put
            self.get = self.backing.get

    objects = PutGetOnly()
    service = ProofService(db, objects, clock=clock)

    def fail(*args):
        raise RuntimeError("metadata write interrupted")

    with monkeypatch.context() as patch:
        patch.setattr(proof_store, "record_proof", fail)
        with pytest.raises(RuntimeError, match="metadata write interrupted"):
            service.submit_charge_proof(actor, charge, data, "image/png", context)
    assert objects.backing.writes == 1
    proof = service.submit_charge_proof(actor, charge, data, "image/png", context)
    assert proof["state"] == "REVIEW" and objects.backing.writes == 1


@pytest.mark.parametrize(("category", "grace", "offset", "expected_status"), [
    ("EVENT_DEPOSIT", False, -1, "DEPOSIT_REVIEW"),
    ("EVENT_DEPOSIT", False, 0, "AWAITING_DEPOSIT"),
    ("EVENT_BALANCE", True, -1, "BOOKED"),
    ("EVENT_BALANCE", False, 0, "BOOKED"),
])
def test_event_proof_uses_shared_owner_and_merchant_routes_and_effective_cutoff(
    db, client, sign_in, clock, event_charge, category, grace, offset, expected_status,
):
    customer, owner = sign_in()
    _, foreign = sign_in()
    admin, merchant = sign_in("ADMIN")
    cutoff = clock.current - timedelta(microseconds=offset)
    event, quote, charge = event_charge(customer["accountId"], admin["accountId"], cutoff, category, grace=grace)
    path = f"{API}/charges/{charge}/proof"
    data = _image()
    key = str(uuid4())

    assert client.post(path, content=data, headers=_headers(foreign, key=key)).status_code == 404
    accepted = client.post(path, content=data, headers=_headers(owner, key=key))
    assert accepted.status_code == 201, accepted.text
    _assert_json_contract(accepted, "submitChargeProof")
    proof = accepted.json()
    timely = offset < 0
    assert proof["reviewDisposition"] == ("TIMELY" if timely else "RECONCILIATION_ONLY")
    assert client.post(path, content=data, headers=_headers(owner)).json() == proof

    listing = client.get(f"{API}/admin/charges/{charge}/proofs", headers=merchant)
    assert listing.json() == {"items": [proof], "nextCursor": None}
    download = client.get(f"{API}/admin/proofs/{proof['id']}/content", headers=merchant)
    assert download.status_code == 200 and download.content == data
    assert download.headers["cache-control"] == "private, no-store"
    with db.connection() as conn:
        assert one(conn, "SELECT status FROM event_application WHERE id = %s", (event,))["status"] == expected_status
        assert one(conn, "SELECT status FROM resource_window WHERE quote_id = %s", (quote,))["status"] == (
            "HELD" if category == "EVENT_DEPOSIT" else "BOOKED"
        )
        assert one(conn, "SELECT state, version FROM charge WHERE id = %s", (charge,)) == {
            "state": "PROOF_REVIEW" if timely else "OPEN", "version": 2,
        }
        case = one(conn, "SELECT kind,status,proof_id FROM settlement_case WHERE charge_id = %s", (charge,))
        if timely:
            assert case is None
        else:
            assert (case["kind"], case["status"], str(case["proof_id"])) == ("LATE_PROOF", "OPEN", proof["id"])
        assert one(conn, "SELECT count(*) AS n FROM money_entry")["n"] == 0


def test_event_cancellation_can_win_before_staged_proof_registers(db, sign_in, clock, event_charge):
    actor = _customer(db, clock.current)
    admin, _ = sign_in("ADMIN")
    event, quote, charge = event_charge(actor.account_id, admin["accountId"],
                                       clock.current + timedelta(minutes=10), "EVENT_DEPOSIT")
    started, release = Event(), Event()

    class SlowObjects(Objects):
        def put(self, key, data):
            started.set()
            assert release.wait(5)
            super().put(key, data)

    service = ProofService(db, SlowObjects(), clock=clock)
    with ThreadPoolExecutor(max_workers=1) as threads:
        pending = threads.submit(service.submit_charge_proof, actor, charge, _image(), "image/png", _command())
        try:
            assert started.wait(5)
            with db.transaction() as conn:
                conn.execute("SELECT id FROM event_application WHERE id = %s FOR UPDATE", (event,))
                conn.execute("SELECT id FROM charge WHERE id = %s FOR UPDATE", (charge,))
                conn.execute("UPDATE event_application SET status = 'CANCELLED' WHERE id = %s", (event,))
                conn.execute("UPDATE event_quote SET status = 'CANCELLED' WHERE id = %s", (quote,))
                conn.execute("UPDATE charge SET state = 'CANCELLED' WHERE id = %s", (charge,))
                conn.execute("UPDATE resource_window SET status = 'RELEASED' WHERE quote_id = %s", (quote,))
        finally:
            release.set()
        proof = pending.result(timeout=5)
    assert proof["reviewDisposition"] == "RECONCILIATION_ONLY"
    with db.connection() as conn:
        assert one(conn, "SELECT status FROM event_application WHERE id = %s", (event,))["status"] == "CANCELLED"
        assert one(conn, "SELECT status FROM resource_window WHERE quote_id = %s", (quote,))["status"] == "RELEASED"


@pytest.mark.parametrize(("order_status", "charge_state", "timely"), [
    ("ACCEPTED", "OPEN", True),
    ("COMPLETED", "OPEN", True),
    ("ACCEPTED", "CANCELLED", False),
    ("COMPLETED", "PAID", False),
    ("CANCELLED", "OPEN", False),
])
def test_adjustment_proof_isolated_from_primary_order_and_charge(
    db, client, sign_in, clock, standard, order_status, charge_state, timely,
):
    customer, owner = sign_in()
    _, foreign = sign_in()
    admin, merchant = sign_in("ADMIN")
    order, primary_charge = standard(customer["accountId"], clock.current + timedelta(minutes=10),
                                     status=order_status, state="PAID")
    agreement, charge = uuid4(), uuid4()
    with db.transaction() as conn:
        conn.execute(
            "UPDATE standard_order SET accepted_at = %s, fulfilment = 'CUSTOMER_LALAMOVE' WHERE id = %s",
            (clock.current, order),
        )
        allocation = {"ACCEPTED": "COMMITTED", "COMPLETED": "USED", "CANCELLED": "RELEASED"}[order_status]
        conn.execute("UPDATE capacity_allocation SET state = %s WHERE order_id = %s", (allocation, order))
        conn.execute(
            """INSERT INTO order_recovery_agreement (id,order_id,order_version,kind,extra_minor,agreed_at,
                          consent_channel,consent_reference,reason,recorded_by,recorded_at)
                   VALUES (%s,%s,1,'DELIVERY_ADJUSTMENT',100,%s,'PHONE','Fixture consent','Extra delivery',%s,%s)""",
            (agreement, order, clock.current, admin["accountId"], clock.current),
        )
        conn.execute(
            """INSERT INTO charge (id,order_id,category,state,expected_minor,created_at,recovery_agreement_id)
               VALUES (%s,%s,'STANDARD_ADJUSTMENT',%s,100,%s,%s)""",
            (charge, order, charge_state, clock.current, agreement),
        )

    baseline = _snapshot(db, order, primary_charge)
    path = f"{API}/charges/{charge}/proof"
    data = _image()
    headers = _headers(owner)
    assert client.post(path, content=data, headers=_headers(foreign)).status_code == 404
    result = client.post(path, content=data, headers=headers)
    assert result.status_code == 201, result.text
    proof = result.json()
    assert proof["chargeId"] == str(charge)
    assert proof["reviewDisposition"] == ("TIMELY" if timely else "RECONCILIATION_ONLY")
    assert client.post(path, content=data, headers=headers).json() == proof
    assert _snapshot(db, order, primary_charge) == baseline
    with db.connection() as conn:
        state = one(conn, "SELECT state,version FROM charge WHERE id = %s", (charge,))
        assert state == {"state": "PROOF_REVIEW" if timely else charge_state, "version": 2}
        case = one(conn, "SELECT kind,status,proof_id FROM settlement_case WHERE charge_id = %s", (charge,))
        if timely:
            assert case is None
        else:
            assert (case["kind"], case["status"], str(case["proof_id"])) == ("LATE_PROOF", "OPEN", proof["id"])
        assert one(conn, "SELECT count(*) AS n FROM money_entry")["n"] == 0

    if timely:
        response = client.post(
            f"{API}/admin/charges/{charge}/receipts",
            headers={**merchant, "Idempotency-Key": str(uuid4())},
            json={
                "expectedVersion": 2, "externalReference": "fixture-adjustment-transfer",
                "amountMinor": 100, "receivedAt": clock.current.isoformat(), "proofId": proof["id"],
            },
        )
        assert response.status_code == 200 and response.json()["state"] == "PAID", response.text
        assert _snapshot(db, order, primary_charge) == baseline
