"""PostgreSQL catalogue queries and private image adapters."""

import os
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from PIL import Image, ImageCms, ImageOps
from psycopg.types.json import Jsonb

from sweetcommerce.db import one, rows
from sweetcommerce.problems import Problem

from .domain import (
    MAX_SAFE_INTEGER,
    MAX_VARIANTS,
    CatalogueValidationProblem,
    missing_photo,
    missing_product,
)

SELLABLE = """
    p.status = 'LISTED' AND p.category IS NOT NULL
    AND EXISTS (SELECT 1 FROM variant eligible WHERE eligible.product_id = p.id AND eligible.available)
"""

PROJECTION = """
    SELECT p.id, p.name, p.category, p.status, p.version,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', v.id, 'productId', v.product_id, 'name', v.name, 'flavour', v.flavour,
          'unitMinor', v.unit_minor, 'prepMinutes', v.prep_minutes, 'available', v.available
        ) ORDER BY v.id)
        FROM variant v
        WHERE v.product_id = p.id AND (NOT %(storefront)s::boolean OR v.available)
      ), '[]'::jsonb) AS variants,
      COALESCE((
        SELECT jsonb_agg(g.media_id ORDER BY g.ordinal)
        FROM product_gallery g
        JOIN product_media m ON m.product_id = g.product_id AND m.id = g.media_id
        WHERE g.product_id = p.id AND m.lifecycle = 'ATTACHED'
      ), '[]'::jsonb) AS "imageRefs"
    FROM product p
"""


def as_product(row):
    if row["version"] > MAX_SAFE_INTEGER:
        raise ValueError("Product version exceeds the supported range.")
    return {**row, "id": str(row["id"])}


def read_product(conn, product_id, storefront):
    row = one(conn, f"""
        {PROJECTION}
        WHERE p.id = %(id)s AND (NOT %(storefront)s::boolean OR ({SELLABLE}))
    """, {"storefront": storefront, "id": product_id})
    if row is None:
        raise missing_product()
    return as_product(row)


def list_products(conn, storefront, filter_value, after, limit):
    filter_column = "p.category" if storefront else "p.status"
    return rows(conn, f"""
        {PROJECTION}
        WHERE (NOT %(storefront)s::boolean OR ({SELLABLE}))
          AND (%(after)s::uuid IS NULL OR p.id > %(after)s)
          AND (%(filter)s::text IS NULL OR {filter_column} = %(filter)s)
        ORDER BY p.id
        LIMIT %(limit)s
    """, {"storefront": storefront, "after": after, "filter": filter_value, "limit": limit})


def command_receipt(conn, identity):
    row = one(conn, """
        SELECT request_digest, result_reference FROM command_receipt
        WHERE actor_id = %s AND operation = %s AND idem_key = %s
    """, identity.receipt_key)
    if row is None:
        return None
    if row["request_digest"] != identity.digest:
        raise Problem("IDEMPOTENCY_CONFLICT", 409, "This key was already used for a different catalogue command.")
    return row["result_reference"]


def lock_command(conn, identity):
    lock_key = f"catalogue:{identity.actor_id}:{identity.operation}:{identity.key}"
    conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (lock_key,))


def save_receipt(conn, identity, result, timestamp):
    conn.execute("""
        INSERT INTO command_receipt (actor_id, operation, idem_key, request_digest, result_reference, created_at)
        VALUES (%s, %s, %s, %s, %s, %s)
    """, (*identity.receipt_key, identity.digest, Jsonb(result), timestamp))


def audit(conn, identity, product_id, change, timestamp):
    conn.execute("""
        INSERT INTO audit_event (id, actor_id, feature, resource_id, action, occurred_at, request_id, safe_change)
        VALUES (%s, %s, 'F02', %s, %s, %s, %s, %s)
    """, (uuid4(), identity.actor_id, product_id, identity.operation, timestamp, identity.request_id, Jsonb(change)))


def product_state(conn, product_id, *, lock=False):
    lock_clause = "FOR UPDATE" if lock else ""
    row = one(conn, f"SELECT status, category, version FROM product WHERE id = %s {lock_clause}", (product_id,))
    if row is None:
        raise missing_product()
    return row


def insert_draft(conn, product_id, name, category):
    conn.execute("INSERT INTO product (id, name, category, status) VALUES (%s, %s, %s, 'DRAFT')", (product_id, name, category))


def update_product(conn, product_id, name, category, status):
    conn.execute("""
        UPDATE product SET name = %s, category = %s, status = %s, version = version + 1 WHERE id = %s
    """, (name, category, status, product_id))


def save_variants(conn, product_id, variants):
    existing = {str(row["id"]) for row in rows(conn, "SELECT id FROM variant WHERE product_id = %s", (product_id,))}
    to_save = []
    new_count = 0
    for variant in variants:
        variant_id = variant.get("id")
        if variant_id is None:
            variant_id = str(uuid4())
            new_count += 1
        elif variant_id not in existing:
            raise Problem("NOT_FOUND", 404, "Variant not found.")
        to_save.append({**variant, "id": variant_id})

    if len(existing) + new_count > MAX_VARIANTS:
        raise CatalogueValidationProblem("variants", "INVALID_COUNT", "A product can have at most 100 variants. Reuse existing variants.")
    # Historical orders and carts can still reference omitted variants.
    conn.execute("""
        UPDATE variant SET available = false
        WHERE product_id = %s AND available AND NOT (id = ANY(%s::uuid[]))
    """, (product_id, [variant["id"] for variant in to_save]))
    if not to_save:
        return
    conn.execute("""
        INSERT INTO variant (id, product_id, name, flavour, available, unit_minor, prep_minutes)
        SELECT v.id, %s::uuid, v.name, v.flavour, v.available, v."unitMinor", v."prepMinutes"
        FROM jsonb_to_recordset(%s::jsonb) AS v(
          id uuid, name text, flavour text, available boolean, "unitMinor" bigint, "prepMinutes" integer
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, flavour = EXCLUDED.flavour, available = EXCLUDED.available,
          unit_minor = EXCLUDED.unit_minor, prep_minutes = EXCLUDED.prep_minutes
        WHERE variant.product_id = EXCLUDED.product_id
    """, (product_id, Jsonb(to_save)))


def save_gallery(conn, product_id, image_refs, timestamp):
    matches = rows(conn, """
        SELECT id FROM product_media
        WHERE product_id = %s AND id = ANY(%s::uuid[]) AND lifecycle IN ('STAGED', 'ATTACHED')
        ORDER BY id FOR UPDATE
    """, (product_id, image_refs))
    if len(matches) != len(image_refs):
        raise missing_photo()
    conn.execute("DELETE FROM product_gallery WHERE product_id = %s", (product_id,))
    conn.execute("""
        UPDATE product_media SET lifecycle = 'RETIRED', retired_at = %s
        WHERE product_id = %s AND lifecycle = 'ATTACHED' AND NOT (id = ANY(%s::uuid[]))
    """, (timestamp, product_id, image_refs))
    conn.execute("""
        UPDATE product_media SET lifecycle = 'ATTACHED'
        WHERE product_id = %s AND lifecycle = 'STAGED' AND id = ANY(%s::uuid[])
    """, (product_id, image_refs))
    conn.execute("""
        INSERT INTO product_gallery (product_id, ordinal, media_id)
        SELECT %s::uuid, position::integer, id FROM unnest(%s::uuid[]) WITH ORDINALITY AS image(id, position)
    """, (product_id, image_refs))


def stage_photo(conn, product_id, media_id, object_key, digest, byte_count, media_type, timestamp):
    conn.execute("""
        INSERT INTO product_media (id, product_id, object_key, content_digest, byte_count, media_type, lifecycle, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, 'STAGED', %s)
    """, (media_id, product_id, object_key, digest, byte_count, media_type, timestamp))


def merchant_photo(conn, product_id, media_id):
    return one(conn, """
        SELECT object_key, media_type, byte_count, content_digest FROM product_media
        WHERE product_id = %s AND id = %s AND lifecycle IN ('STAGED', 'ATTACHED')
    """, (product_id, media_id))


def listed_photo(conn, media_id):
    return one(conn, f"""
        SELECT m.object_key, m.media_type, m.byte_count, m.content_digest
        FROM product_media m
        JOIN product_gallery g ON g.product_id = m.product_id AND g.media_id = m.id
        JOIN product p ON p.id = g.product_id
        WHERE m.id = %s AND m.lifecycle = 'ATTACHED' AND ({SELLABLE})
    """, (media_id,))


def _mkdir_private(directory: Path) -> None:
    try:
        directory.mkdir(mode=0o700, exist_ok=True)
    except FileNotFoundError:
        _mkdir_private(directory.parent)
        directory.mkdir(mode=0o700, exist_ok=True)


class LocalPrivateStore:
    """Read and write the TypeScript local-private AES-256-GCM file format."""

    def __init__(self, path: str | os.PathLike[str], key: bytes):
        if len(key) != 32:
            raise ValueError("Private storage requires a 32-byte key.")
        self._directory = Path(os.path.abspath(path))
        self._cipher = AESGCM(key)

    def _path(self, key: bytes) -> Path:
        _mkdir_private(self._directory)
        if self._directory.resolve(strict=True) != self._directory:
            raise ValueError("Invalid private storage root.")
        return self._directory / sha256(key).hexdigest()

    def put(self, key: str, data: bytes) -> None:
        aad = key.encode()
        nonce = os.urandom(12)
        encrypted = self._cipher.encrypt(nonce, data, aad)
        # Node stores the 16-byte tag before the ciphertext. AESGCM returns it last.
        with open(self._path(aad), "xb", opener=self._private_file) as handle:
            handle.write(nonce + encrypted[-16:] + encrypted[:-16])

    def delete(self, key: str) -> None:
        self._path(key.encode()).unlink(missing_ok=True)

    @staticmethod
    def _private_file(path, flags):
        return os.open(path, flags, 0o600)

    def get(self, key: str) -> bytes | None:
        aad = key.encode()
        path = self._path(aad)
        try:
            payload = path.read_bytes()
        except FileNotFoundError:
            return None
        return self._cipher.decrypt(payload[:12], payload[28:] + payload[12:28], aad)


_IMAGE_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
_MAX_PIXELS = 16_000_000


def sanitize_image(data: bytes, media_type: str) -> bytes | None:
    """Decode bounded photo pixels and re-encode a static image without metadata."""
    image_format = _IMAGE_FORMATS.get(media_type)
    if image_format is None:
        return None
    try:
        with Image.open(BytesIO(data), formats=[image_format]) as source:
            if source.width * source.height > _MAX_PIXELS:
                return None
            # Sharp exposes WebP frame counts and decodes the default image of APNG.
            if image_format == "WEBP" and source.n_frames != 1:
                return None
            # PNG load alone can accept truncated containers. Verify the chunk stream first.
            if image_format == "PNG":
                source.verify()
        with Image.open(BytesIO(data), formats=[image_format]) as source:
            source.load()
            image = ImageOps.exif_transpose(source)
            profile = image.info.get("icc_profile")
            if image_format == "JPEG":
                mode = "RGB"
            elif "transparency" in image.info or "A" in image.getbands():
                mode = "RGBA"
            else:
                mode = "RGB"
            if profile:
                try:
                    alpha = image.convert("RGBA").getchannel("A") if mode == "RGBA" else None
                    color_source = image.convert("RGB") if image.mode in {"P", "RGBA"} else image
                    if color_source.mode == "LA":
                        color_source = color_source.getchannel("L")
                    converted = ImageCms.profileToProfile(
                        color_source, BytesIO(profile), ImageCms.createProfile("sRGB"), outputMode="RGB",
                    )
                    if alpha is not None:
                        converted.putalpha(alpha)
                    image = converted
                except ImageCms.PyCMSError:
                    pass  # Ignore unusable profiles, as the reference decoder does.
            if image.mode == "I;16":
                image = image.point(lambda value: value * (1 / 256)).convert("L")
            image = image.convert(mode)
            image.info.clear()
            result = BytesIO()
            image.save(result, format=image_format, **({"quality": 80} if image_format == "JPEG" else {}))
            return result.getvalue()
    except Exception:
        return None
