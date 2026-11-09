import re
from contextlib import contextmanager
from hashlib import sha256
from io import BytesIO
from uuid import uuid4

from PIL import Image
from psycopg.errors import QueryCanceled
from psycopg.types.json import Jsonb

from ..capacity.order import bump_capacity_impact
from ..db import one, rows
from .domain import invalid_file, storage_unavailable

PROOF_COLUMNS = "id, charge_id, state, received_at, review_disposition"
OBJECT_KEY = re.compile(r"proofs/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{64}")
IMAGE_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG"}
MAX_PIXELS = 16_000_000
PDF_HEADER = re.compile(rb"%PDF-(?:1\.[0-7]|2\.0)[\r\n]")
PDF_FOOTER = re.compile(rb"startxref\s+([0-9]{1,10})\s+%%EOF[\x00\t\n\f\r ]*\Z")
PDF_ROOT = re.compile(rb"/Root\s+([1-9][0-9]{0,9})\s+([0-9]{1,5})\s+R\b")
PDF_SIZE = re.compile(rb"/Size\s+[1-9][0-9]*\b")
PDF_XREF_ENTRY = re.compile(rb"([0-9]{10}) ([0-9]{5}) ([fn]) ?")
PDF_OBJECT = re.compile(rb"([1-9][0-9]{0,9})\s+([0-9]{1,5})\s+obj\b")


def _valid_pdf(data: bytes) -> bool:
    # Validate the file envelope and last cross-reference section without rendering streams.
    footer = PDF_FOOTER.search(data, max(0, len(data) - 1024))
    if not PDF_HEADER.match(data) or footer is None:
        return False
    offset = int(footer[1])
    if not 9 <= offset < footer.start():
        return False
    section = data[offset:footer.start()].rstrip()
    if section.startswith((b"xref\n", b"xref\r")):
        table, marker, trailer = section.partition(b"trailer")
        if not marker or not trailer.lstrip().startswith(b"<<") or not trailer.endswith(b">>"):
            return False
        root = PDF_ROOT.search(trailer)
        if root is None or not PDF_SIZE.search(trailer):
            return False
        root_ref = int(root[1]), int(root[2])
        root_found = False
        object_number = 0
        remaining = 0
        for line in table.splitlines()[1:]:
            if remaining:
                entry = PDF_XREF_ENTRY.fullmatch(line)
                if entry is None:
                    return False
                if entry[3] == b"n":
                    position, generation = int(entry[1]), int(entry[2])
                    target = PDF_OBJECT.match(data, position, offset)
                    if target is None or (int(target[1]), int(target[2])) != (object_number, generation):
                        return False
                    root_found |= (object_number, generation) == root_ref
                object_number += 1
                remaining -= 1
            elif line.strip():
                subsection = re.fullmatch(rb"([0-9]{1,10})\s+([0-9]{1,10})\s*", line)
                if subsection is None:
                    return False
                object_number, remaining = int(subsection[1]), int(subsection[2])
        return remaining == 0 and (root_found or bool(re.search(rb"/Prev\s+[1-9][0-9]*\b", trailer)))

    header = re.match(rb"[1-9][0-9]*\s+[0-9]+\s+obj\s*<<", section)
    if header is None:
        return False
    dictionary = re.split(rb"\bstream\r?\n", section[header.end():], maxsplit=1)
    return (
        len(dictionary) == 2
        and dictionary[0].rstrip().endswith(b">>")
        and bool(re.search(rb"/Type\s*/XRef\b", dictionary[0]))
        and bool(re.search(rb"/W\s*\[\s*[0-9]+\s+[0-9]+\s+[0-9]+\s*\]", dictionary[0]))
        and bool(PDF_ROOT.search(dictionary[0]) and PDF_SIZE.search(dictionary[0]))
        and bool(re.search(rb"\bendstream\s+endobj\Z", dictionary[1]))
    )


def validate_content(data: bytes, media_type: str) -> None:
    if media_type == "application/pdf":
        if not _valid_pdf(data):
            raise invalid_file()
        return

    image_format = IMAGE_FORMATS[media_type]
    try:
        with Image.open(BytesIO(data), formats=[image_format]) as image:
            if image.width * image.height > MAX_PIXELS or getattr(image, "n_frames", 1) != 1:
                raise invalid_file()
            image.verify()
        with Image.open(BytesIO(data), formats=[image_format]) as image:
            image.load()
    except (OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        raise invalid_file() from None


def object_key(charge_id: str, digest: bytes) -> str:
    return f"proofs/{charge_id}/{digest.hex()}"


@contextmanager
def object_lock(conn, key: str):
    # Serialize staging, registration and cleanup for these bytes, without keeping a
    # database transaction or parent row lock open while talking to object storage.
    try:
        with conn.transaction():
            conn.execute("SELECT pg_advisory_lock(hashtextextended(%s, 0))", (key,))
    except BaseException as error:
        conn.close()
        if isinstance(error, QueryCanceled):
            raise storage_unavailable() from None
        raise
    try:
        yield
    finally:
        if not conn.closed:
            try:
                with conn.transaction():
                    conn.execute("SELECT pg_advisory_unlock(hashtextextended(%s, 0))", (key,))
            except Exception:
                # Dropping the session also drops the lock when the connection is lost.
                conn.close()


def owned_target(conn, charge_id: str, actor_id: str):
    charge = one(
        conn,
        """SELECT c.* FROM charge c LEFT JOIN standard_order o ON o.id = c.order_id
            WHERE c.id = %s AND (c.order_id IS NULL OR o.account_id = %s)""",
        (charge_id, actor_id),
    )
    if charge is not None and (event_id := charge.get("event_id")) is not None:
        owner = one(conn, "SELECT 1 FROM event_application WHERE id = %s AND account_id = %s", (event_id, actor_id))
        if owner is None:
            return None
    return charge


def lock_standard(conn, order_id, charge_id: str, actor_id: str):
    order = one(
        conn,
        """SELECT id, status, payment_method, fulfilment, service_date, proof_due_at, accepted_at
             FROM standard_order WHERE id = %s AND account_id = %s FOR UPDATE""",
        (order_id, actor_id),
    )
    charge = one(
        conn,
        """SELECT id, category, state, due_at, top_up_requested_at, top_up_due_at
             FROM charge WHERE id = %s AND order_id = %s FOR UPDATE""",
        (charge_id, order_id),
    ) if order is not None else None
    return order, charge


def standard_hold_exists(conn, order: dict) -> bool:
    return one(
        conn,
        """SELECT 1 FROM capacity_allocation WHERE order_id = %s AND service_date = %s AND state = 'HELD' LIMIT 1""",
        (order["id"], order["service_date"]),
    ) is not None


def lock_event_charge(conn, event_id, charge_id: str, actor_id: str):
    from ..events.infrastructure import lock_event

    event = lock_event(conn, event_id, account_id=actor_id)
    charge = one(
        conn,
        "SELECT * FROM charge WHERE id = %s AND event_id = %s FOR UPDATE",
        (charge_id, event_id),
    )
    return event, charge


def proof_by_digest(conn, charge_id: str, digest: bytes):
    return one(
        conn,
        f"SELECT {PROOF_COLUMNS} FROM payment_proof WHERE charge_id = %s AND content_digest = %s",
        (charge_id, digest),
    )


def has_receipt(conn, actor_id: str, operation: str, key: str) -> bool:
    return one(
        conn,
        "SELECT 1 FROM command_receipt WHERE actor_id = %s AND operation = %s AND idem_key = %s",
        (actor_id, operation, key),
    ) is not None


def object_referenced(conn, key: str) -> bool:
    return one(conn, "SELECT 1 FROM payment_proof WHERE object_key = %s", (key,)) is not None


def record_proof(conn, charge_id: str, key: str, digest: bytes, byte_count: int, media_type: str, disposition: str, now):
    return one(
        conn,
        f"""INSERT INTO payment_proof (id, charge_id, object_key, content_digest, byte_count, media_type,
                       state, review_disposition, received_at)
              VALUES (%s,%s,%s,%s,%s,%s,'REVIEW',%s,%s) RETURNING {PROOF_COLUMNS}""",
        (uuid4(), charge_id, key, digest, byte_count, media_type, disposition, now),
    )


def mark_in_review(conn, order: dict, charge_id: str, now) -> None:
    conn.execute(
        "UPDATE standard_order SET status = 'PAYMENT_REVIEW', version = version + 1, updated_at = %s WHERE id = %s",
        (now, order["id"]),
    )
    mark_charge_in_review(conn, charge_id)
    if order["status"] != "PAYMENT_REVIEW":
        bump_capacity_impact(conn, [order["service_date"]])


def mark_charge_in_review(conn, charge_id: str) -> None:
    conn.execute("UPDATE charge SET state = 'PROOF_REVIEW', version = version + 1 WHERE id = %s", (charge_id,))


def record_late_case(conn, charge_id: str, proof_id, now) -> None:
    conn.execute(
        """INSERT INTO settlement_case (id, charge_id, proof_id, kind, status, opened_at)
           VALUES (%s,%s,%s,'LATE_PROOF','OPEN',%s)""",
        (uuid4(), charge_id, proof_id, now),
    )
    conn.execute("UPDATE charge SET version = version + 1 WHERE id = %s", (charge_id,))


def audit(conn, actor_id: str, resource_id, charge_id, action: str, request_id: str, now, reason: str):
    conn.execute(
        """INSERT INTO audit_event (id, actor_id, feature, resource_id, action, occurred_at,
                                    reason_code, request_id, safe_change)
           VALUES (%s,%s,'SETTLEMENT',%s,%s,%s,%s,%s,%s)""",
        (uuid4(), actor_id, resource_id, action, now, reason, request_id, Jsonb({"chargeId": str(charge_id)})),
    )


def charge_exists(conn, charge_id: str) -> bool:
    return one(conn, "SELECT 1 FROM charge WHERE id = %s", (charge_id,)) is not None


def list_proofs(conn, charge_id: str, after, anchor, limit: int) -> list[dict]:
    return rows(
        conn,
        f"""SELECT {PROOF_COLUMNS} FROM payment_proof WHERE charge_id = %s
              AND (%s::timestamptz IS NULL OR (received_at, id) < (%s, %s))
              ORDER BY received_at DESC, id DESC LIMIT %s""",
        (charge_id, after, after, anchor, limit),
    )


def proof_object(conn, proof_id: str):
    return one(
        conn,
        "SELECT id, charge_id, object_key, byte_count, content_digest, media_type FROM payment_proof WHERE id = %s",
        (proof_id,),
    )


def verified_bytes(data: bytes | None, count: int, digest: bytes) -> bool:
    return isinstance(data, bytes) and len(data) == count and sha256(data).digest() == digest
