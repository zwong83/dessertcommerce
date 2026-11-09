from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

ACTIVE_ORDERS = {"PENDING_PROOF", "PAYMENT_REVIEW", "EXCEPTION"}
ACTIVE_CHARGES = {"OPEN", "PROOF_REVIEW", "DISPUTED"}


@dataclass(frozen=True)
class Claim:
    id: UUID
    resource_id: UUID
    kind: str
    payload_version: int
    payload: object
    token: UUID


def expected_deadline(work: dict) -> datetime | None:
    payload = work["payload"]
    if work["payload_version"] != 1 or not isinstance(payload, dict):
        return None
    value = payload.get("deadline")
    if not isinstance(value, str):
        return None
    try:
        deadline = datetime.fromisoformat(value)
    except ValueError:
        return None
    return deadline if deadline.tzinfo is not None else deadline.replace(tzinfo=UTC)


def active_deadline(work: dict, order: dict | None, charge: dict | None, expected: datetime) -> datetime | None:
    if order is None or charge is None or order["status"] not in ACTIVE_ORDERS or charge["state"] not in ACTIVE_CHARGES:
        return None
    top_up = work["kind"] == "STANDARD_TOP_UP_EXPIRY"
    deadline = charge["top_up_due_at"] if top_up else order["proof_due_at"]
    if deadline is None or deadline != expected:
        return None
    if not top_up:
        due_at = charge["due_at"]
        if charge["top_up_due_at"] is not None or due_at is None or due_at != expected:
            return None
    charge_id = work["payload"].get("chargeId")
    if charge_id and charge_id != str(charge["id"]):
        return None
    return deadline


def review_window_start(work: dict, charge: dict) -> datetime | None:
    requested_at = charge["top_up_requested_at"]
    if work["kind"] == "STANDARD_TOP_UP_EXPIRY" and requested_at is not None:
        return requested_at
    return None
