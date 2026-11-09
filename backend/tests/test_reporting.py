from uuid import uuid4

from sweetcommerce.db import one

from test_checkout import _command, _submit_body, checkout_fixture


def test_report_separates_myt_dates_status_and_actual_money(db, client, sign_in, checkout_fixture):
    customer, customer_headers, checkout, orders, _ = checkout_fixture()
    _, admin = sign_in("ADMIN")
    review = orders.review_checkout(customer, checkout)
    order = orders.submit_order(customer, _submit_body(checkout, review), _command())
    charge = order["charge"]["id"]
    with db.transaction() as conn:
        merchant = one(conn, "SELECT id FROM account WHERE role='ADMIN'")["id"]
        conn.execute("""UPDATE standard_order SET status='READY',accepted_at='2030-01-01T00:00:00+08:00',
            promised_handoff_at='2030-01-01T12:30:00+08:00',ready_at='2030-01-01T12:29:59+08:00'
            WHERE id=%s""", (order["id"],))
        conn.execute("UPDATE capacity_allocation SET state='USED' WHERE order_id=%s", (order["id"],))
        conn.execute("""
            INSERT INTO money_entry (id,charge_id,kind,rail,external_reference,amount_minor,occurred_at,actor_id)
            VALUES (%s,%s,'RECEIPT','DUITNOW','prior-local-day',900,'2029-12-31T23:59:59+08:00',%s),
              (%s,%s,'REFUND','DUITNOW','period-refund',100,'2030-01-01T00:00:00+08:00',%s)
        """, (uuid4(), charge, merchant, uuid4(), charge, merchant))
    path = "/api/v1/admin/reports"
    params = {"from": "2030-01-01", "to": "2030-01-01"}
    response = client.get(path, params=params, headers=admin)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["totals"][0] == {"category": "STANDARD", "receivedMinor": 0, "refundedMinor": 100, "netMinor": -100}
    assert result["acceptedStandard"] == result["readyOnTime"] == result["dueWithPromise"] == 1
    assert result["prepByDay"] == [{"date": "2030-01-01", "units": 2}]
    filtered = client.get(path, params={**params, "orderStatus": "CANCELLED"}, headers=admin).json()
    assert filtered["acceptedStandard"] == filtered["duePrepUnits"] == 0
    assert filtered["totals"] == result["totals"]
    assert filtered["dueWithPromise"] == 1
    assert client.get(path, params=params, headers=customer_headers).status_code == 403
    assert client.get(path, params={**params, "to": "2030-04-03"}, headers=admin).status_code == 422


def test_quote_cohort_counts_revisions_once_and_later_booking(db, client, sign_in):
    customer, _ = sign_in()
    _, admin = sign_in("ADMIN")
    event = uuid4()
    with db.transaction() as conn:
        conn.execute("""
            INSERT INTO event_application
                (id,event_number,account_id,submission_intent_id,submission_digest,status,event_date,
                start_at,expected_end_at,setup_ready_at,request_snapshot,booked_at,created_at,updated_at)
            VALUES (%s,'EVENT-REPORT',%s,%s,%s,'BOOKED','2030-02-10','2030-02-10T12:00:00+08:00',
                '2030-02-10T14:00:00+08:00','2030-02-10T11:00:00+08:00','{}',
                '2030-02-01T01:00:00+08:00','2030-01-01T10:00:00+08:00','2030-02-01T01:00:00+08:00')
        """, (event, customer["accountId"], uuid4(), uuid4().bytes))
        for version, status in enumerate(("SUPERSEDED", "CONFIRMED"), start=1):
            conn.execute("""
                INSERT INTO event_quote
                  (id,event_id,version,status,total_minor,deposit_minor,balance_minor,issued_at,deposit_due_at,
                   balance_due_at,event_start_at,event_end_at,setup_ready_at,teardown_at,quote_snapshot,terms_version)
                VALUES (%s,%s,%s,%s,3,2,1,'2030-01-30T09:00:00+08:00','2030-02-02T09:00:00+08:00',
                   '2030-02-07T09:00:00+08:00','2030-02-10T12:00:00+08:00','2030-02-10T14:00:00+08:00',
                   '2030-02-10T11:00:00+08:00','2030-02-10T15:00:00+08:00','{}','test-terms')
            """, (uuid4(), event, version, status))
    response = client.get("/api/v1/admin/reports", params={"from": "2030-01-01", "to": "2030-01-31"}, headers=admin)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["confirmedEvents"] == 0
    assert result["quotedApplications"] == result["quotedWithConfirmedDeposit"] == 1
