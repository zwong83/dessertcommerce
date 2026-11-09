from ..clock import iso

_ACTIONS = {
    "AWAITING_FEE": "Review delivery feasibility and offer a fee or alternate time.",
    "AWAITING_CASH": "Review capacity and accept or reject pickup.",
    "PENDING_PROOF": "Check the proof deadline and wait for customer evidence.",
    "PAYMENT_REVIEW": "Verify the payment independently.",
    "ACCEPTED": "Start production at the scheduled time.",
    "PREPARING": "Record when the order is ready.",
    "READY": "Record driver arrival or actual pickup as applicable.",
    "HANDED_OFF": "Close the order or record a delivery incident.",
    "PROOF": "Open protected proof and reconcile actual funds.",
    "PAYMENT_EXCEPTION": "Review the charge, settlement case or refund reservation.",
    "NOTICE": "Review the notice outcome before sending again.",
    "EVENT": "Review the current event plan and available actions.",
}


def work_item(row):
    return {
        "id": str(row["id"]), "kind": row["kind"], "status": row["status"], "number": row["number"],
        "updatedAt": iso(row["updated_at"]),
        "target": {
            "resourceType": row["kind"], "resourceId": str(row["id"]),
            "orderId": str(row["order_id"]) if row["order_id"] else None,
            "eventId": str(row["event_id"]) if row["event_id"] else None,
            "chargeId": str(row["charge_id"]) if row["charge_id"] else None,
        },
        "safeNextAction": _ACTIONS.get(row["kind"] if row["kind"] != "ORDER" else row["status"], "Review current order details."),
        "noticeOutcome": row["notice_outcome"],
    }
