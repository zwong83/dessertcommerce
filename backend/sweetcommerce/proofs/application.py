from collections.abc import Iterable
from datetime import datetime
from hashlib import sha256
from itertools import islice
from typing import Protocol
from uuid import uuid4

from ..capacity.infrastructure import CapacityCommand, command
from ..db import Database, one
from . import infrastructure as store
from .domain import (
    MAX_PROOF_BYTES,
    adjustment_disposition,
    check_media_type,
    identifier,
    invalid_file,
    invalid_transition,
    missing,
    next_cursor,
    oversized,
    page_bounds,
    proof_view,
    require_role,
    standard_disposition,
    storage_unavailable,
)

SUBMIT_OPERATION = "submitChargeProof"


class ProofObjects(Protocol):
    def put(self, key: str, data: bytes) -> None: ...

    def get(self, key: str) -> bytes | None: ...


class ProofService:
    def __init__(self, db: Database, objects: ProofObjects, *, clock=None):
        self._db = db
        self._objects = objects
        self._clock = clock

    def _now(self, conn) -> datetime:
        if self._clock is None:
            return one(conn, "SELECT clock_timestamp() AS now")["now"]
        instant = self._clock()
        return datetime.fromisoformat(instant) if isinstance(instant, str) else instant

    def _read_object(self, key: str) -> bytes | None:
        try:
            return self._objects.get(key)
        except Exception:
            raise storage_unavailable() from None

    def _stage(self, key: str, data: bytes) -> None:
        if self._read_object(key) == data:
            return
        try:
            self._objects.put(key, data)
        except Exception:
            # The provider can report failure after durably writing the bytes.
            if self._read_object(key) != data:
                raise storage_unavailable() from None
        else:
            if self._read_object(key) != data:
                raise storage_unavailable()

    def _remove_unlinked(self, conn, key: str) -> bool:
        delete = getattr(self._objects, "delete", None)
        if delete is None:
            return False
        with conn.transaction():
            referenced = store.object_referenced(conn, key)
        if referenced:
            return False
        try:
            delete(key)
        except Exception:
            raise storage_unavailable() from None
        return True

    def reconcile_unlinked(self, candidates: Iterable[str]) -> int:
        """Reconcile one bounded batch of old keys supplied by private storage inventory."""
        removed = 0
        for key in islice(candidates, 25):
            if store.OBJECT_KEY.fullmatch(key):
                with self._db.connection() as conn, store.object_lock(conn, key):
                    removed += self._remove_unlinked(conn, key)
        return removed

    def submit_charge_proof(self, actor, charge_id: str, data: bytes, media_type: str, context: CapacityCommand) -> dict:
        actor_id = require_role(actor, "CUSTOMER")
        charge_id = identifier(charge_id, "charge ID")
        media_type = check_media_type(media_type)
        idem_key = identifier(context.idempotency_key, "Idempotency-Key")
        if len(data) > MAX_PROOF_BYTES:
            raise oversized()
        if not data:
            raise invalid_file()

        digest = sha256(data).digest()
        key = store.object_key(charge_id, digest)
        intent = {"chargeId": charge_id, "mediaType": media_type, "proofDigest": digest.hex()}
        with self._db.connection() as conn:
            with conn.transaction():
                target = store.owned_target(conn, charge_id, actor_id)
                if target is None:
                    raise missing()

            with store.object_lock(conn, key):
                with conn.transaction():
                    replay = store.has_receipt(conn, actor_id, SUBMIT_OPERATION, idem_key)
                    duplicate = store.proof_by_digest(conn, charge_id, digest)
                should_stage = not replay and duplicate is None
                if not replay:
                    store.validate_content(data, media_type)
                try:
                    if should_stage:
                        self._stage(key, data)
                    with conn.transaction():
                        return command(
                            conn, actor_id, SUBMIT_OPERATION, context, intent,
                            lambda: self._register(conn, target, charge_id, actor_id, len(data),
                                                   media_type, digest, key, context.request_id),
                        )
                except Exception:
                    if should_stage and not conn.closed:
                        try:
                            self._remove_unlinked(conn, key)
                        except Exception:
                            # Keep the original problem. A retry or inventory reconciliation can
                            # recover an interrupted write, including an ambiguous database commit.
                            pass
                    raise

    def _register(self, conn, target, charge_id, actor_id, byte_count, media_type, digest, key, request_id):
        event_id = target.get("event_id")
        if event_id is not None:
            from ..eventsettlement.application import mark_proof_review, proof_disposition

            parent, charge = store.lock_event_charge(conn, event_id, charge_id, actor_id)
        else:
            parent, charge = store.lock_standard(conn, target["order_id"], charge_id, actor_id)
        if charge is None:
            raise missing()
        if existing := store.proof_by_digest(conn, charge_id, digest):
            return proof_view(existing)

        now = self._now(conn)
        if event_id is not None:
            disposition = proof_disposition(conn, parent, charge, now)
        elif charge["category"] == "STANDARD_ADJUSTMENT":
            disposition = adjustment_disposition(parent, charge)
        else:
            disposition = standard_disposition(parent, charge, now)
            if disposition == "TIMELY" and not store.standard_hold_exists(conn, parent):
                raise invalid_transition()

        proof = store.record_proof(conn, charge_id, key, digest, byte_count, media_type, disposition, now)
        if disposition == "TIMELY":
            if event_id is not None:
                mark_proof_review(conn, parent, charge, now)
            elif charge["category"] == "STANDARD_ADJUSTMENT":
                store.mark_charge_in_review(conn, charge_id)
            else:
                store.mark_in_review(conn, parent, charge_id, now)
        else:
            store.record_late_case(conn, charge_id, proof["id"], now)
        store.audit(conn, actor_id, proof["id"], charge_id, "PROOF_REGISTERED", request_id, now, disposition)
        return proof_view(proof)

    def list_payment_proofs(self, actor, charge_id: str, *, limit=None, cursor=None, request_id=None) -> dict:
        actor_id = require_role(actor, "ADMIN")
        charge_id = identifier(charge_id, "charge ID")
        count, after, anchor = page_bounds(charge_id, limit, cursor)
        with self._db.transaction() as conn:
            if not store.charge_exists(conn, charge_id):
                raise missing()
            records = store.list_proofs(conn, charge_id, after, anchor, count + 1)
            store.audit(conn, actor_id, charge_id, charge_id, "PROOF_LIST_READ", request_id or str(uuid4()),
                        self._now(conn), "MERCHANT_REVIEW")
        return {
            "items": [proof_view(row) for row in records[:count]],
            "nextCursor": next_cursor(charge_id, records[count - 1]) if len(records) > count else None,
        }

    def get_payment_proof_content(self, actor, proof_id: str, request_id: str) -> tuple[bytes, str]:
        actor_id = require_role(actor, "ADMIN")
        proof_id = identifier(proof_id, "proof ID")
        with self._db.connection() as conn:
            record = store.proof_object(conn, proof_id)
        if record is None:
            raise missing()
        data = self._read_object(record["object_key"])
        if not store.verified_bytes(data, record["byte_count"], record["content_digest"]):
            raise storage_unavailable()
        with self._db.transaction() as conn:
            store.audit(conn, actor_id, proof_id, record["charge_id"], "PROOF_CONTENT_READ", request_id,
                        self._now(conn), "MERCHANT_REVIEW")
        return data, record["media_type"]
