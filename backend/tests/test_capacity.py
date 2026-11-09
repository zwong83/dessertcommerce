from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Barrier
from types import SimpleNamespace
from uuid import uuid4

import pytest

from sweetcommerce.capacity import (
    CapacityCommand,
    CapacityService,
    allocate_capacity,
    bump_capacity_impact,
    commit_held_capacity,
    mark_capacity_used,
    reallocate_capacity,
    release_capacity,
)
from sweetcommerce.capacity.domain import can_fit_capacity, earliest_handoff, is_handoff_eligible, myt_date
from sweetcommerce.db import one, rows
from sweetcommerce.http import Problem

API = "/api/v1"
FIRST_DAY = "2030-01-01"
CUTOFF = "2030-01-01T10:00:00Z"
LATE = "2030-01-01T10:00:00.000001Z"
POLICY = {"openWeekdays": list(range(1, 8)), "opensAt": "06:00", "closesAt": "22:00"}


def test_myt_boundaries_and_limits():
    assert is_handoff_eligible(POLICY, CUTOFF, handoff(FIRST_DAY), 180)
    assert myt_date("2029-12-31T16:00:00Z") == FIRST_DAY
    assert myt_date("2029-12-31T15:59:59.9999999999Z") == "2029-12-31"
    assert not is_handoff_eligible(POLICY, LATE, handoff(FIRST_DAY), 0)
    assert not is_handoff_eligible(POLICY, CUTOFF, "2030-01-01T13:00:00.000001Z", 0)
    assert not is_handoff_eligible(POLICY, CUTOFF, "2030-01-01T12:59:59.999999Z", 180)
    assert earliest_handoff(POLICY, LATE, FIRST_DAY, 0) is None
    assert earliest_handoff(POLICY, LATE, "2030-01-02", 180) == "2030-01-01T22:00:00.000Z"
    assert is_handoff_eligible(POLICY, CUTOFF, "2030-01-02T22:00:00+08:00", 180)
    assert not is_handoff_eligible({**POLICY, "openWeekdays": [2]}, CUTOFF, handoff("2030-01-02"), 0)
    assert not is_handoff_eligible(POLICY, "2030-01-01T00:00:00+08:00", "2030-01-01T05:59:59+08:00", 0)
    day = {"closed": False, "max": 6, "allocated": 3}
    limits = {"cake": {"max": 4, "allocated": 2}}
    units = {"cake": 2, "tart": 1}
    assert can_fit_capacity(day, limits, units)
    assert not can_fit_capacity({**day, "closed": True}, limits, units)
    assert not can_fit_capacity({**day, "max": 5}, limits, units)
    assert not can_fit_capacity(day, {"cake": {"max": 3, "allocated": 2}}, units)
    assert not can_fit_capacity(None, limits, units)


@pytest.mark.parametrize("timestamp", ["2030-02-30T12:00:00Z", "2030-01-01T18:00:00"])
def test_invalid_timestamp(timestamp):
    with pytest.raises(Problem) as problem:
        myt_date(timestamp)
    assert problem.value.code == "VALIDATION"


@dataclass(frozen=True)
class Product:
    id: str
    variant: str


def seed_product(conn) -> Product:
    product = Product(str(uuid4()), str(uuid4()))
    conn.execute("INSERT INTO product (id, name, status) VALUES (%s, 'Dessert', 'LISTED')", (product.id,))
    conn.execute(
        """INSERT INTO variant (id, product_id, name, flavour, available, unit_minor, prep_minutes)
           VALUES (%s, %s, 'Regular', 'Plain', true, 100, 180)""",
        (product.variant, product.id),
    )
    return product


@pytest.fixture
def capacity(db):
    admin = SimpleNamespace(account_id=str(uuid4()), role="ADMIN")
    customer = SimpleNamespace(account_id=str(uuid4()), role="CUSTOMER")
    now = SimpleNamespace(value=CUTOFF)
    with db.transaction() as conn:
        conn.execute(
            """INSERT INTO account (id, role, phone_e164, recovery_email)
               VALUES (%s, 'ADMIN', NULL, 'merchant@example.test'), (%s, 'CUSTOMER', '+60123456789', NULL)""",
            (admin.account_id, customer.account_id),
        )
        cake, tart = seed_product(conn), seed_product(conn)
    return SimpleNamespace(
        admin=admin, customer=customer, cake=cake, tart=tart, now=now,
        service=CapacityService(db, b"x" * 32, clock=lambda: now.value),
    )


def new_order(db, owner, date, status, products, *, fulfilment="PICKUP", pending=False):
    review, order = uuid4(), uuid4()
    with db.transaction() as conn:
        if pending:
            bump_capacity_impact(conn, [date])
        conn.execute(
            """INSERT INTO checkout_review
                 (id, account_id, cart_version, review_digest, terms_version, review_snapshot, expires_at, updated_at)
               VALUES (%s, %s, 1, 'demo', 'v1', '{}', now() + interval '30 minutes', now())""",
            (review, owner.account_id),
        )
        promised = handoff(date) if status == "ACCEPTED" else None
        conn.execute(
            """INSERT INTO standard_order
                 (id, order_number, account_id, checkout_review_id, status, fulfilment, payment_method, service_date,
                  requested_handoff_at, promised_handoff_at, fulfilment_snapshot, subtotal_minor, fee_minor,
                  terms_version, created_at, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, '{}', 100, 0, 'v1', clock_timestamp(), clock_timestamp())""",
            (order, str(order), owner.account_id, review, status, fulfilment,
             "CASH" if status == "AWAITING_CASH" else "DUITNOW", date, handoff(date), promised),
        )
        for product in products:
            conn.execute(
                """INSERT INTO standard_order_line (order_id, variant_id, product_id, quantity, unit_minor, display_snapshot)
                   VALUES (%s, %s, %s, 1, 100, '{}')""",
                (order, product.variant, product.id),
            )
    return order


def for_order(db, order, operation):
    with db.transaction() as conn:
        conn.execute("SELECT id FROM standard_order WHERE id = %s FOR UPDATE", (order,))
        return operation(conn)


def context():
    return CapacityCommand(str(uuid4()), str(uuid4()))


def handoff(date):
    return f"{date}T21:00:00+08:00"


def edit(date, product, day_limit, product_limit=None, *, version=0, closed=False):
    return {
        "date": date, "closed": closed, "dayLimit": day_limit, "expectedVersion": version,
        "productLimits": [{"productId": product.id, "limit": day_limit if product_limit is None else product_limit}],
    }


def preview(capacity, change, **page):
    return capacity.service.preview_capacity_impact(capacity.admin, change, context(), page)


def confirm(capacity, change, token, key=None):
    return capacity.service.configure_capacity(capacity.admin, {**change, "impactToken": token}, key or context())


def configure(capacity, change):
    return confirm(capacity, change, preview(capacity, change)["impactToken"])


def calendar(capacity, date):
    return capacity.service.get_capacity_calendar(capacity.admin, date, date)["days"]


def test_guarded_availability_rechecks_cutoff_and_stays_advisory(db, capacity):
    for date in (FIRST_DAY, "2030-01-02"):
        configure(capacity, edit(date, capacity.cake, 1))
    selection = {
        "items": [{"variantId": capacity.cake.variant, "quantity": 1}],
        "fulfilment": "PICKUP", "requestedHandoffAt": handoff(FIRST_DAY),
    }
    assert capacity.service.evaluate_availability(capacity.customer, selection)["eligible"]
    assert calendar(capacity, FIRST_DAY)[0]["allocatedUnits"] == 0
    capacity.now.value = LATE
    assert capacity.service.evaluate_availability(capacity.customer, selection) == {
        "eligible": False, "alternatives": ["2030-01-01T22:00:00.000Z"], "evaluatedAt": LATE,
    }
    order = new_order(db, capacity.customer, FIRST_DAY, "ACCEPTED", [capacity.cake])

    def allocate(conn):
        allocate_capacity(conn, order, handoff(FIRST_DAY), "COMMITTED", lambda: capacity.now.value)

    with pytest.raises(Problem) as problem:
        for_order(db, order, allocate)
    assert problem.value.code == "CAPACITY_UNAVAILABLE"
    assert calendar(capacity, FIRST_DAY)[0]["allocatedUnits"] == 0
    capacity.now.value = CUTOFF
    for_order(db, order, allocate)
    assert not capacity.service.evaluate_availability(capacity.customer, selection)["eligible"]


def test_runtime_availability_uses_database_clock(db, capacity):
    service = CapacityService(db, b"x" * 32)
    selection = {
        "items": [{"variantId": capacity.cake.variant, "quantity": 1}],
        "fulfilment": "PICKUP", "requestedHandoffAt": handoff(FIRST_DAY),
    }
    with db.connection() as conn:
        before = one(conn, "SELECT clock_timestamp() AS current")["current"]
    evaluated_at = service.evaluate_availability(capacity.customer, selection)["evaluatedAt"]
    with db.connection() as conn:
        after = one(conn, "SELECT clock_timestamp() AS current")["current"]
    assert before <= datetime.fromisoformat(evaluated_at) <= after
    assert len(evaluated_at.split(".")[1]) == 7


@pytest.mark.parametrize("day_limit", [2, 10])
def test_competing_fulfilments_share_daily_and_product_limits(db, capacity, day_limit):
    date = "2030-01-03"
    configure(capacity, edit(date, capacity.cake, day_limit, 1))
    orders = [
        new_order(db, capacity.customer, date, "PENDING_PROOF", [capacity.cake, capacity.tart], fulfilment=mode)
        for mode in ("PICKUP", "CUSTOMER_LALAMOVE")
    ]
    ready = Barrier(2)

    def attempt(order):
        def allocate(conn):
            ready.wait(timeout=5)
            allocate_capacity(conn, order, handoff(date), "HELD", lambda: CUTOFF)

        try:
            for_order(db, order, allocate)
        except Problem as problem:
            assert problem.code == "CAPACITY_UNAVAILABLE"
            return None
        return order

    with ThreadPoolExecutor(max_workers=2) as pool:
        winners = [winner for winner in pool.map(attempt, orders) if winner is not None]
    assert len(winners) == 1
    assert calendar(capacity, date)[0]["allocatedUnits"] == 2
    with db.connection() as conn:
        assert rows(conn, """SELECT order_id, count(*) AS products FROM capacity_allocation
                              WHERE service_date = %s GROUP BY order_id""", (date,)) == [
            {"order_id": winners[0], "products": 2},
        ]


def test_worker_releases_once_and_keeps_used_units(db, worker_db, capacity):
    date = "2030-01-05"
    configure(capacity, edit(date, capacity.cake, 2))
    expired, preparing = [new_order(db, capacity.customer, date, "PENDING_PROOF", [capacity.cake]) for _ in range(2)]
    for order in (expired, preparing):
        for_order(db, order, lambda conn: allocate_capacity(conn, order, handoff(date), "HELD", lambda: CUTOFF))
    assert for_order(db, preparing, lambda conn: commit_held_capacity(conn, preparing, date)) == 1
    assert for_order(db, preparing, lambda conn: mark_capacity_used(conn, preparing, date)) == 1
    before = calendar(capacity, date)[0]["version"]

    def expire(conn):
        conn.execute("UPDATE standard_order SET status = 'EXPIRED' WHERE id = %s", (expired,))
        return release_capacity(conn, expired, date)

    assert for_order(worker_db, expired, expire) == 1
    assert for_order(worker_db, expired, lambda conn: release_capacity(conn, expired, date)) == 0
    assert for_order(db, preparing, lambda conn: release_capacity(conn, preparing, date)) == 0
    saved = calendar(capacity, date)[0]
    assert saved["version"] == before + 1
    assert saved["allocatedUnits"] == saved["productLimits"][0]["allocatedUnits"] == 1


def test_remake_retains_used_generations_and_failed_moves_keep_live_allocation(db, capacity):
    date, other = "2030-01-06", "2030-01-07"
    configure(capacity, edit(date, capacity.cake, 3, 2))
    configure(capacity, edit(other, capacity.cake, 1))
    order = new_order(db, capacity.customer, date, "ACCEPTED", [capacity.cake])
    for_order(db, order, lambda conn: allocate_capacity(conn, order, handoff(date), "COMMITTED", lambda: CUTOFF))
    for_order(db, order, lambda conn: mark_capacity_used(conn, order, date))
    for_order(db, order, lambda conn: reallocate_capacity(conn, order, handoff(date), "COMMITTED", date, lambda: CUTOFF))
    for_order(db, order, lambda conn: mark_capacity_used(conn, order, date))
    with pytest.raises(Problem) as problem:
        for_order(db, order, lambda conn: reallocate_capacity(conn, order, handoff(date), "COMMITTED", date, lambda: CUTOFF))
    assert problem.value.code == "CAPACITY_UNAVAILABLE"
    with db.connection() as conn:
        assert rows(conn, "SELECT generation, state FROM capacity_allocation WHERE order_id = %s ORDER BY generation",
                    (order,)) == [{"generation": 1, "state": "USED"}, {"generation": 2, "state": "USED"}]

    active = new_order(db, capacity.customer, other, "ACCEPTED", [capacity.cake])
    for_order(db, active, lambda conn: allocate_capacity(conn, active, handoff(other), "COMMITTED", lambda: CUTOFF))

    def fail_move(conn):
        with pytest.raises(Problem) as problem:
            reallocate_capacity(conn, active, handoff(date), "COMMITTED", other, lambda: CUTOFF)
        assert problem.value.code == "CAPACITY_UNAVAILABLE"

    for_order(db, active, fail_move)
    assert calendar(capacity, date)[0]["allocatedUnits"] == 2
    assert calendar(capacity, other)[0]["allocatedUnits"] == 1


def test_move_updates_source_and_destination_revisions(db, capacity):
    source, dest = "2030-01-06", "2030-01-07"
    configure(capacity, edit(dest, capacity.cake, 2))
    pending = new_order(db, capacity.customer, source, "AWAITING_CASH", [capacity.cake])
    for_order(db, pending, lambda conn: reallocate_capacity(conn, pending, handoff(dest), "COMMITTED", source, lambda: CUTOFF))
    source_day, dest_day = calendar(capacity, source)[0], calendar(capacity, dest)[0]
    assert (source_day["allocatedUnits"], source_day["version"]) == (0, 1)
    assert (dest_day["allocatedUnits"], dest_day["version"]) == (1, 2)


def test_impact_pagination_stale_revisions_and_protection(db, capacity):
    date = "2030-01-08"
    configure(capacity, edit(date, capacity.cake, 3))
    order = new_order(db, capacity.customer, date, "ACCEPTED", [capacity.cake])

    def start_production(conn):
        allocate_capacity(conn, order, handoff(date), "COMMITTED", lambda: CUTOFF)
        mark_capacity_used(conn, order, date)

    for_order(db, order, start_production)
    close = edit(date, capacity.cake, 3, version=calendar(capacity, date)[0]["version"], closed=True)
    initial = preview(capacity, close)
    assert initial["occupiedUnits"] == initial["usedUnits"] == 1
    assert [(row["orderId"], row["kind"]) for row in initial["items"]] == [(str(order), "EXISTING_COMMITMENT")]
    cash = new_order(db, capacity.customer, date, "AWAITING_CASH", [capacity.cake], pending=True)
    with pytest.raises(Problem) as stale:
        confirm(capacity, close, initial["impactToken"])
    assert stale.value.code == "VERSION_CONFLICT"

    close["expectedVersion"] = calendar(capacity, date)[0]["version"]
    before_fee = preview(capacity, close)
    fee = new_order(db, capacity.customer, date, "AWAITING_FEE", [capacity.cake],
                    fulfilment="MERCHANT_LALAMOVE", pending=True)
    with pytest.raises(Problem) as stale:
        confirm(capacity, close, before_fee["impactToken"])
    assert stale.value.code == "VERSION_CONFLICT"

    close["expectedVersion"] = calendar(capacity, date)[0]["version"]
    for day_limit, product_limit in ((0, 3), (3, 0)):
        low = edit(date, capacity.cake, day_limit, product_limit, version=close["expectedVersion"])
        blocked = preview(capacity, low)
        assert not blocked["canSave"]
        with pytest.raises(Problem) as problem:
            confirm(capacity, low, blocked["impactToken"])
        assert problem.value.code == "CAPACITY_UNAVAILABLE"

    first = preview(capacity, close, limit=1)
    assert first["affectedCount"] == 3
    assert first["items"][0]["orderId"] == str(order)
    second = preview(capacity, close, limit=2, cursor=first["nextCursor"])
    assert [(row["orderId"], row["kind"]) for row in second["items"]] == [
        (str(cash), "PENDING_RECHECK"), (str(fee), "PENDING_RECHECK"),
    ]
    assert second["nextCursor"] is None
    with pytest.raises(Problem) as problem:
        confirm(capacity, {**close, "dayLimit": 4}, first["impactToken"])
    assert problem.value.code == "VERSION_CONFLICT"

    key = context()
    saved = confirm(capacity, close, first["impactToken"], key)
    assert confirm(capacity, close, first["impactToken"], key) == saved
    projected = calendar(capacity, date)[0]
    assert projected["closed"] and projected["allocatedUnits"] == 1
    with db.connection() as conn:
        assert one(conn, "SELECT status, promised_handoff_at FROM standard_order WHERE id = %s", (order,)) == {
            "status": "ACCEPTED", "promised_handoff_at": datetime(2030, 1, 8, 13, tzinfo=UTC),
        }
    with pytest.raises(Problem) as problem:
        for_order(db, cash, lambda conn: allocate_capacity(conn, cash, handoff(date), "COMMITTED", lambda: CUTOFF))
    assert problem.value.code == "CAPACITY_UNAVAILABLE"


def test_policy_replay_and_expired_preview(capacity):
    service, admin = capacity.service, capacity.admin
    assert service.get_operating_policy(admin)["version"] == 1
    update = {"openWeekdays": ["TUE", "MON"], "opensAt": "08:00", "closesAt": "20:00"}
    key = context()
    updated = service.update_operating_policy(admin, update, '"1"', key)
    assert updated["version"] == 2 and updated["sameDaySubmitCutoff"] == "18:00"
    assert service.update_operating_policy(admin, {**update, "openWeekdays": ["MON", "TUE"]}, '"1"', key) == updated
    with pytest.raises(Problem) as problem:
        service.update_operating_policy(admin, {**update, "closesAt": "21:00"}, '"1"', key)
    assert problem.value.code == "IDEMPOTENCY_CONFLICT"
    with pytest.raises(Problem) as problem:
        service.update_operating_policy(admin, update, '"1"', context())
    assert problem.value.code == "VERSION_CONFLICT"

    candidate = edit("2030-01-09", capacity.cake, 1)
    impact = preview(capacity, candidate)
    capacity.now.value = impact["expiresAt"]
    with pytest.raises(Problem) as problem:
        confirm(capacity, candidate, impact["impactToken"])
    assert problem.value.code == "VERSION_CONFLICT"
    assert not calendar(capacity, candidate["date"])


def test_typescript_token_and_receipt_compatibility(db):
    admin = SimpleNamespace(account_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role="ADMIN")
    with db.transaction() as conn:
        conn.execute("INSERT INTO account (id, role, phone_e164) VALUES (%s, 'ADMIN', '+60123456789')", (admin.account_id,))
    change = {"date": "2030-01-02", "closed": False, "dayLimit": 1, "productLimits": [], "expectedVersion": 0}
    # Signed preview and request digest generated with TypeScript's JSON and Node crypto.
    token = "MTg5MzQ5MjYwMDAwMA.87TszkpDVHv2aOKfgN4PdBANfV0fxTjKy_kbz2xGuOI"
    digest = bytes.fromhex("7b2c92bf7ccf32a94e3f25dd9f5130baeaa20dd97550d52c3ed96a5fa2f4656b")
    now = SimpleNamespace(value=CUTOFF)
    service = CapacityService(db, b"x" * 32, clock=lambda: now.value)
    key = context()
    first = service.preview_capacity_impact(admin, change, key)
    assert first["impactToken"] == token
    with db.connection() as conn:
        receipt = one(conn, "SELECT request_digest FROM command_receipt WHERE idem_key = %s", (key.idempotency_key,))
    assert receipt["request_digest"] == digest
    assert service.configure_capacity(admin, {**change, "impactToken": token}, context()) == {"date": change["date"], "version": 1}
    now.value = first["expiresAt"]
    assert service.preview_capacity_impact(admin, change, key) == first


def test_routes_with_sessions_validate_origin_role_csrf_and_audit(client, db, sign_in):
    assert client.get(API + "/admin/operating-policy").status_code == 401
    _, customer = sign_in()
    _, admin = sign_in("ADMIN")
    with db.transaction() as conn:
        cake = seed_product(conn)

    assert client.get(API + "/admin/operating-policy", headers=customer).status_code == 403
    policy_path = API + "/admin/operating-policy"
    read = client.get(policy_path, headers=admin)
    assert read.status_code == 200 and read.json()["version"] == 1
    change = {"openWeekdays": ["TUE", "WED"], "opensAt": "06:00", "closesAt": "22:00"}
    headers = {**admin, "Idempotency-Key": str(uuid4()), "If-Match": '"1"'}
    denied = client.put(policy_path, json=change, headers={**headers, "Origin": "https://other.example.test"})
    assert (denied.status_code, denied.json()["code"]) == (403, "ORIGIN_DENIED")
    denied = client.put(policy_path, json=change, headers={**headers, "X-CSRF-Token": ""})
    assert (denied.status_code, denied.json()["code"]) == (403, "FORBIDDEN")
    updated = client.put(policy_path, json=change, headers=headers)
    assert updated.status_code == 200 and updated.json()["version"] == 2

    candidate = edit(FIRST_DAY, cake, 1)
    headers = {**admin, "Idempotency-Key": str(uuid4())}
    invalid = client.post(API + "/admin/capacity/preview", json={**candidate, "productLimits": [None]}, headers=headers)
    assert invalid.status_code == 422
    impact = client.post(API + "/admin/capacity/preview?limit=1", json=candidate, headers=headers)
    assert impact.status_code == 200 and impact.json()["canSave"]
    saved = client.put(API + "/admin/capacity", json={**candidate, "impactToken": impact.json()["impactToken"]},
                       headers={**admin, "Idempotency-Key": str(uuid4())})
    assert saved.status_code == 200 and saved.json() == {"date": FIRST_DAY, "version": 1}
    assert saved.headers["cache-control"] == "no-store"
    with db.connection() as conn:
        assert one(conn, "SELECT action FROM audit_event WHERE request_id = %s",
                   (saved.headers["x-request-id"],)) == {"action": "CONFIGURE_CAPACITY"}
    projected = client.get(API + f"/admin/capacity-calendar?from={FIRST_DAY}&to={FIRST_DAY}", headers=admin)
    assert projected.status_code == 200 and projected.json()["days"][0]["allocatedUnits"] == 0

    availability = {
        "items": [{"variantId": cake.variant, "quantity": 1}],
        "fulfilment": "PICKUP", "requestedHandoffAt": handoff(FIRST_DAY),
    }
    assert client.post(API + "/availability", json=availability, headers=admin).status_code == 403
    assert client.post(API + "/availability", json={**availability, "items": [None]}, headers=customer).status_code == 422
    available = client.post(API + "/availability", json=availability, headers=customer)
    assert available.status_code == 200 and available.json()["eligible"]
