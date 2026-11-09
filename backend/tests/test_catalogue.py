import base64
import json
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from io import BytesIO
from stat import S_IMODE
from types import SimpleNamespace
from uuid import uuid4
from zlib import crc32

import pytest
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from PIL import Image
from PIL.PngImagePlugin import PngInfo
from psycopg.types.json import Jsonb

from sweetcommerce.catalogue import CatalogueCommand, CatalogueService, LocalPrivateStore, sanitize_image
from sweetcommerce.catalogue.domain import MAX_PHOTO_BYTES
from sweetcommerce.db import one, rows
from sweetcommerce.problems import Problem

PRODUCT_ID = "00000000-0000-4000-8000-000000000001"
ADMIN = SimpleNamespace(account_id="00000000-0000-4000-8000-000000000002", role="ADMIN")
CUSTOMER = SimpleNamespace(account_id="00000000-0000-4000-8000-000000000003", role="CUSTOMER")
VARIANT = {"name": "Slice", "flavour": "Pandan", "unitMinor": 650, "prepMinutes": 15, "available": True}
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNYoJAAAAKEASFBcshFAAAAAElFTkSuQmCC"
)


class Objects:
    def __init__(self):
        self.data = {}

    def put(self, key, data):
        assert key not in self.data
        self.data[key] = data

    def get(self, key):
        return self.data.get(key)


def command():
    return CatalogueCommand(str(uuid4()), "catalogue-test")


def assert_problem(status, code, action, *args, **kwargs):
    with pytest.raises(Problem) as error:
        action(*args, **kwargs)
    assert (error.value.status, error.value.code) == (status, code)
    return error.value


def edit(product, **overrides):
    return {
        "name": product["name"],
        "status": product["status"],
        "variants": [{k: v for k, v in variant.items() if k != "productId"} for variant in product["variants"]],
        "imageRefs": product["imageRefs"],
        **overrides,
    }


@pytest.fixture
def catalogue(db):
    with db.transaction() as conn:
        conn.execute("""
            INSERT INTO account (id, role, phone_e164, recovery_email)
            VALUES (%s, 'ADMIN', NULL, 'merchant@example.invalid'), (%s, 'CUSTOMER', '+60100000001', NULL)
        """, (ADMIN.account_id, CUSTOMER.account_id))
    objects = Objects()
    return CatalogueService(db, objects), objects


def test_catalogue_use_cases_check_roles_before_resources():
    service = CatalogueService(object(), object())
    for use_case, args in [
        (service.list_merchant_products, (CUSTOMER,)),
        (service.get_merchant_product, (CUSTOMER, PRODUCT_ID)),
        (service.create_product, (CUSTOMER, {}, command())),
        (service.update_product, (CUSTOMER, PRODUCT_ID, 1, {}, command())),
        (service.upload_product_photo, (CUSTOMER, PRODUCT_ID, "image/jpeg", b"", command())),
        (service.get_merchant_product_photo, (CUSTOMER, PRODUCT_ID, PRODUCT_ID)),
        (service.list_catalog, (ADMIN,)),
        (service.get_listed_product, (ADMIN, PRODUCT_ID)),
        (service.get_listed_product_photo, (ADMIN, PRODUCT_ID)),
    ]:
        assert_problem(403, "FORBIDDEN", use_case, *args)
    assert_problem(401, "UNAUTHENTICATED", service.list_catalog, None)


def test_catalogue_validates_versions_fields_pages_and_media_before_database():
    service = CatalogueService(object(), object())
    product = {"name": "Pandan cake", "status": "LISTED", "variants": [VARIANT], "imageRefs": []}
    assert_problem(422, "VALIDATION", service.create_product, ADMIN, {"name": "  "}, command())
    assert_problem(400, "VALIDATION", service.update_product, ADMIN, PRODUCT_ID, 0, product, command())
    for changes, field, code in [
        ({"category": None}, "category", "REQUIRED"),
        ({"variants": [{**VARIANT, "unitMinor": 6.5}]}, "variants.0.unitMinor", "INVALID_PRICE"),
        ({"variants": [{**VARIANT, "prepMinutes": 10_081}]}, "variants.0.prepMinutes", "INVALID_PREPARATION"),
        ({"variants": [{**VARIANT, "flavour": " "}]}, "variants.0.flavour", "INVALID_TEXT"),
        ({"variants": [{**VARIANT, "available": False}]}, "variants", "REQUIRED"),
        ({"imageRefs": [PRODUCT_ID] * 13}, "imageRefs", "INVALID_GALLERY"),
        ({"imageRefs": [PRODUCT_ID] * 2}, "imageRefs", "DUPLICATE_PHOTO"),
    ]:
        error = assert_problem(422, "VALIDATION", service.update_product, ADMIN, PRODUCT_ID, 1, product | changes, command())
        assert error.field_errors == [{"field": field, "code": code}]
    for media_type, data, status, code in [
        ("image/png", b"0" * (MAX_PHOTO_BYTES + 1), 413, "PAYLOAD_TOO_LARGE"),
        ("image/png", b"\xff\xd8\xff\xd9", 415, "UNSUPPORTED_MEDIA"),
        ("image/gif", b"GIF", 415, "UNSUPPORTED_MEDIA"),
        ("image/webp", b"", 415, "UNSUPPORTED_MEDIA"),
    ]:
        assert_problem(status, code, service.upload_product_photo, ADMIN, PRODUCT_ID, media_type, data, command())
    assert_problem(400, "VALIDATION", service.list_catalog, CUSTOMER, limit=101)
    assert_problem(400, "VALIDATION", service.list_catalog, CUSTOMER, cursor="bad-cursor")


def test_catalogue_replays_typescript_receipts_and_projects_eligible_variants(db, catalogue):
    service, _ = catalogue
    key = command()
    prior_result = {
        "id": PRODUCT_ID, "name": "Pandan 🍰", "category": None,
        "status": "DRAFT", "version": 1, "variants": [], "imageRefs": [],
    }
    # Node SHA-256 of JSON.stringify({ name: "Pandan 🍰", category: null }).
    prior_digest = bytes.fromhex("e72717e5cd7630f3ce9a1e67d91b314b5f20242c7862c842a2cc775e48823be0")
    with db.transaction() as conn:
        conn.execute("""
            INSERT INTO command_receipt (actor_id, operation, idem_key, request_digest, result_reference, created_at)
            VALUES (%s, 'createProduct', %s, %s, %s, now())
        """, (ADMIN.account_id, key.idempotency_key, prior_digest, Jsonb(prior_result)))
    assert service.create_product(ADMIN, {"name": " Pandan 🍰 "}, key) == prior_result
    assert_problem(409, "IDEMPOTENCY_CONFLICT", service.create_product, ADMIN, {"name": "Different"}, key)

    first = service.create_product(ADMIN, {"name": "Pandan cake", "category": "Cakes"}, command())
    assert first == {**prior_result, "id": first["id"], "name": "Pandan cake", "category": "Cakes"}
    assert service.list_catalog(CUSTOMER, category="Cakes") == {"items": [], "nextCursor": None}
    first_listed = service.update_product(
        ADMIN, first["id"], 1,
        edit(first, status="LISTED", variants=[VARIANT, {**VARIANT, "flavour": "Chocolate", "available": False}]),
        command(),
    )
    second = service.create_product(ADMIN, {"name": "Chocolate cake", "category": "Cakes"}, command())
    service.update_product(ADMIN, second["id"], 1, edit(second, status="LISTED", variants=[VARIANT]), command())
    other = service.create_product(ADMIN, {"name": "Tart", "category": "Pastries"}, command())
    service.update_product(ADMIN, other["id"], 1, edit(other, status="LISTED", variants=[VARIANT]), command())

    page = service.list_catalog(CUSTOMER, category="Cakes", limit=1)
    cursor = page["nextCursor"]
    assert cursor
    page_two = service.list_catalog(CUSTOMER, category=" Cakes ", limit=1, cursor=cursor)
    assert page_two["nextCursor"] is None
    assert [item["id"] for item in page["items"] + page_two["items"]] == sorted([first["id"], second["id"]])
    assert_problem(400, "VALIDATION", service.list_catalog, CUSTOMER, category="Pastries", cursor=cursor)
    assert_problem(400, "VALIDATION", service.list_catalog, CUSTOMER, category="Cakes", cursor=cursor + "=")
    detail = service.get_listed_product(CUSTOMER, first["id"])
    assert detail == {**first_listed, "variants": [variant for variant in first_listed["variants"] if variant["available"]]}
    assert detail["variants"] == [{**VARIANT, "id": detail["variants"][0]["id"], "productId": first["id"]}]
    assert service.get_merchant_product(ADMIN, first["id"]) == first_listed
    assert second["id"] in {item["id"] for item in service.list_merchant_products(ADMIN, status="LISTED")["items"]}


def test_catalogue_visibility_preserves_historical_order_and_variant(db, catalogue):
    service, _ = catalogue
    product = service.create_product(ADMIN, {"name": "Old cake", "category": "History"}, command())
    product_id = product["id"]
    assert_problem(404, "NOT_FOUND", service.get_listed_product, CUSTOMER, product_id)
    product = service.update_product(ADMIN, product_id, 1, edit(product, status="LISTED", variants=[VARIANT]), command())
    original_variant = product["variants"][0]
    order_id, review_id = uuid4(), uuid4()
    snapshot = {"product": product["name"], "variant": original_variant["name"], "flavour": original_variant["flavour"]}
    with db.transaction() as conn:
        conn.execute("""
            INSERT INTO checkout_review
              (id, account_id, cart_version, review_digest, terms_version, review_snapshot, expires_at, status, consumed_at, updated_at)
            VALUES (%s, %s, 1, %s, 'v1', '{}', now() + interval '1 hour', 'SUBMITTED', now(), now())
        """, (review_id, CUSTOMER.account_id, b"\0"))
        conn.execute("""
            INSERT INTO standard_order
              (id, order_number, account_id, checkout_review_id, status, fulfilment, payment_method, service_date,
               requested_handoff_at, fulfilment_snapshot, subtotal_minor, fee_minor, terms_version, created_at, updated_at)
            VALUES (%s, 'CAT-HISTORY', %s, %s, 'COMPLETED', 'PICKUP', 'CASH', current_date,
                    now(), '{}', 650, 0, 'v1', now(), now())
        """, (order_id, CUSTOMER.account_id, review_id))
        conn.execute("""
            INSERT INTO standard_order_line (order_id, variant_id, product_id, quantity, unit_minor, display_snapshot)
            VALUES (%s, %s, %s, 1, 650, %s)
        """, (order_id, original_variant["id"], product_id, Jsonb(snapshot)))

    for status in ("UNLISTED", "SUSPENDED", "SOLD_OUT", "ARCHIVED"):
        product = service.update_product(ADMIN, product_id, product["version"], edit(product, status=status), command())
        assert_problem(404, "NOT_FOUND", service.get_listed_product, CUSTOMER, product_id)
        assert service.list_catalog(CUSTOMER, category="History")["items"] == []
        assert product in service.list_merchant_products(ADMIN, status=status)["items"]
        if status != "ARCHIVED":
            product = service.update_product(
                ADMIN, product_id, product["version"],
                edit(product, status="LISTED", name="Renamed cake", variants=[{**VARIANT, "unitMinor": 750}]), command(),
            )
            assert [variant["unitMinor"] for variant in service.get_listed_product(CUSTOMER, product_id)["variants"]] == [750]
            assert next(variant for variant in product["variants"] if variant["id"] == original_variant["id"])["available"] is False
    assert_problem(
        409, "INVALID_TRANSITION", service.update_product, ADMIN, product_id, product["version"],
        edit(product, status="LISTED", variants=[VARIANT]), command(),
    )
    assert_problem(409, "INVALID_TRANSITION", service.upload_product_photo, ADMIN, product_id, "image/png", PNG, command())
    with db.connection() as conn:
        line = one(conn, "SELECT variant_id::text, unit_minor, display_snapshot FROM standard_order_line WHERE order_id = %s", (order_id,))
    assert line == {"variant_id": original_variant["id"], "unit_minor": 650, "display_snapshot": snapshot}


def test_catalogue_serializes_competing_updates_and_replays_before_version_check(db, catalogue):
    service, _ = catalogue
    draft = service.create_product(ADMIN, {"name": "Race", "category": "Races"}, command())
    product_id = draft["id"]
    submissions = [(edit(draft, name=name), command()) for name in ("Winner A", "Winner B")]

    def update(submission):
        try:
            return service.update_product(ADMIN, product_id, 1, *submission)
        except Problem as error:
            return error

    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(update, submissions))
    winner_index = next(index for index, result in enumerate(results) if isinstance(result, dict))
    winner, loser = results[winner_index], results[1 - winner_index]
    assert isinstance(loser, Problem) and (loser.status, loser.code) == (409, "VERSION_CONFLICT")
    assert update(submissions[winner_index]) == winner
    assert service.get_merchant_product(ADMIN, product_id) == winner

    body, key = submissions[winner_index]
    compact = json.dumps({"productId": product_id, "expected": 1, "edit": body}, separators=(",", ":"))
    with db.connection() as conn:
        audit = rows(conn, "SELECT action FROM audit_event WHERE resource_id = %s ORDER BY occurred_at", (product_id,))
        receipt = one(conn, "SELECT request_digest FROM command_receipt WHERE idem_key = %s", (key.idempotency_key,))
    assert audit == [{"action": "createProduct"}, {"action": "updateProduct"}]
    assert receipt["request_digest"] == sha256(compact.encode()).digest()


def image_bytes(format, **options):
    output = BytesIO()
    Image.new("RGB", (2, 3), "red").save(output, format, **options)
    return output.getvalue()


def png_at_limit():
    payload = b"npAd" + bytes(MAX_PHOTO_BYTES - len(PNG) - 12)
    return PNG[:-12] + (len(payload) - 4).to_bytes(4, "big") + payload + crc32(payload).to_bytes(4, "big") + PNG[-12:]


def test_catalogue_stages_scoped_media_and_reorders_and_retires_atomically(catalogue):
    service, objects = catalogue
    draft = service.create_product(ADMIN, {"name": "Gallery", "category": "Gallery"}, command())
    product_id = draft["id"]
    other = service.create_product(ADMIN, {"name": "Foreign photo"}, command())
    key = command()
    padded = png_at_limit()
    boundary = service.upload_product_photo(ADMIN, product_id, "image/png", padded, key)
    assert boundary["state"] == "STAGED" and boundary["productId"] == product_id
    assert boundary["byteCount"] < MAX_PHOTO_BYTES
    assert "objectKey" not in boundary
    assert service.upload_product_photo(ADMIN, product_id, "image/png", padded, key) == boundary
    assert len(objects.data) == 1
    assert_problem(409, "IDEMPOTENCY_CONFLICT", service.upload_product_photo, ADMIN, product_id, "image/png", PNG, key)
    jpeg = service.upload_product_photo(ADMIN, product_id, "image/jpeg", image_bytes("JPEG"), command())
    webp = service.upload_product_photo(ADMIN, product_id, "image/webp", image_bytes("WEBP"), command())
    foreign = service.upload_product_photo(ADMIN, other["id"], "image/png", PNG, command())
    assert_problem(404, "NOT_FOUND", service.get_merchant_product_photo, ADMIN, other["id"], boundary["id"])
    assert_problem(404, "NOT_FOUND", service.get_listed_product_photo, CUSTOMER, boundary["id"])
    assert_problem(415, "UNSUPPORTED_MEDIA", service.upload_product_photo, ADMIN, product_id, "image/png", PNG[:8], command())
    preview = service.get_merchant_product_photo(ADMIN, product_id, boundary["id"])
    assert preview.media_type == "image/png" and preview.bytes == sanitize_image(PNG, "image/png")
    assert service.get_merchant_product(ADMIN, product_id) == draft

    refs = [boundary["id"], jpeg["id"], webp["id"]]
    refs.extend(service.upload_product_photo(ADMIN, product_id, "image/png", PNG, command())["id"] for _ in range(9))
    listed = service.update_product(ADMIN, product_id, 1, edit(draft, status="LISTED", variants=[VARIANT], imageRefs=refs), command())
    assert service.get_listed_product(CUSTOMER, product_id)["imageRefs"] == refs
    assert service.get_listed_product_photo(CUSTOMER, jpeg["id"]).media_type == "image/jpeg"
    assert service.get_listed_product_photo(CUSTOMER, webp["id"]).media_type == "image/webp"
    assert_problem(
        404, "NOT_FOUND", service.update_product, ADMIN, product_id, listed["version"],
        edit(listed, name="Roll back", variants=[{**VARIANT, "unitMinor": 800}], imageRefs=[foreign["id"]]), command(),
    )
    assert_problem(409, "VERSION_CONFLICT", service.update_product, ADMIN, product_id, 1, edit(listed, imageRefs=[]), command())
    assert service.get_merchant_product(ADMIN, product_id) == listed

    reordered_refs = [webp["id"], jpeg["id"], *refs[3:]]
    reordered = service.update_product(ADMIN, product_id, listed["version"], edit(listed, imageRefs=reordered_refs), command())
    assert service.get_listed_product(CUSTOMER, product_id)["imageRefs"] == reordered_refs
    assert_problem(404, "NOT_FOUND", service.get_listed_product_photo, CUSTOMER, boundary["id"])
    assert_problem(404, "NOT_FOUND", service.get_merchant_product_photo, ADMIN, product_id, boundary["id"])
    assert_problem(
        404, "NOT_FOUND", service.update_product, ADMIN, product_id, reordered["version"],
        edit(reordered, imageRefs=[boundary["id"]]), command(),
    )
    service.update_product(ADMIN, product_id, reordered["version"], edit(reordered, status="SOLD_OUT"), command())
    assert_problem(404, "NOT_FOUND", service.get_listed_product_photo, CUSTOMER, webp["id"])
    assert service.get_merchant_product_photo(ADMIN, product_id, webp["id"]).media_type == "image/webp"


def test_catalogue_media_dependency_failures_preserve_saved_gallery(db, catalogue):
    service, objects = catalogue
    draft = service.create_product(ADMIN, {"name": "Dependency failure"}, command())
    product_id = draft["id"]
    photo = service.upload_product_photo(ADMIN, product_id, "image/png", PNG, command())
    saved = service.update_product(ADMIN, product_id, 1, edit(draft, imageRefs=[photo["id"]]), command())

    def unavailable(*_args):
        raise OSError("Synthetic dependency failure")

    failing_decoder = CatalogueService(db, SimpleNamespace(put=lambda *_args: pytest.fail("Unexpected write")), unavailable)
    failing_storage = CatalogueService(db, SimpleNamespace(put=unavailable))
    for unavailable_service in (failing_decoder, failing_storage):
        assert_problem(503, "DEPENDENCY_UNAVAILABLE", unavailable_service.upload_product_photo, ADMIN, product_id, "image/png", PNG, command())
    object_key = f"catalogue/{product_id}/{photo['id']}"
    objects.data[object_key] = bytes(photo["byteCount"])
    assert_problem(503, "DEPENDENCY_UNAVAILABLE", service.get_merchant_product_photo, ADMIN, product_id, photo["id"])
    assert service.get_merchant_product(ADMIN, product_id) == saved
    with db.connection() as conn:
        media = rows(conn, "SELECT id::text, lifecycle FROM product_media WHERE product_id = %s", (product_id,))
    assert media == [{"id": photo["id"], "lifecycle": "ATTACHED"}]


def test_catalogue_private_store_matches_typescript_format_and_authenticates_key(tmp_path):
    directory = tmp_path / "local" / "private-objects"
    key = bytes([42]) * 32
    object_key = "catalogue/product/media"
    store = LocalPrivateStore(directory, key)
    assert store.get(object_key) is None
    path = directory / sha256(object_key.encode()).hexdigest()
    # TypeScript's AES-256-GCM output with a fixed synthetic key, nonce, and object-key AAD.
    path.write_bytes(bytes.fromhex(
        "0b0b0b0b0b0b0b0b0b0b0b0bf41767e48084058cb4cce00480f469ce977403f001684e753db19158074d664efbbc555a0ae64794"
    ))
    assert store.get(object_key) == b"TypeScript private bytes"
    with pytest.raises(FileExistsError):
        store.put(object_key, b"replacement")
    next_key = "catalogue/product/next"
    store.put(next_key, b"Python private bytes")
    next_path = directory / sha256(next_key.encode()).hexdigest()
    stored = next_path.read_bytes()
    assert AESGCM(key).decrypt(stored[:12], stored[28:] + stored[12:28], next_key.encode()) == b"Python private bytes"
    assert S_IMODE(next_path.stat().st_mode) == 0o600
    assert S_IMODE(directory.stat().st_mode) == 0o700
    assert S_IMODE(directory.parent.stat().st_mode) == 0o700
    next_path.write_bytes(path.read_bytes())
    with pytest.raises(InvalidTag):
        store.get(next_key)


def test_catalogue_sanitizer_orients_images_strips_metadata_and_bounds_input():
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = "private text"
    jpeg = sanitize_image(image_bytes("JPEG", exif=exif), "image/jpeg")
    with Image.open(BytesIO(jpeg)) as decoded:
        assert decoded.size == (3, 2)
        assert not decoded.getexif()
    metadata = PngInfo()
    metadata.add_text("comment", "private text")
    png = sanitize_image(image_bytes("PNG", pnginfo=metadata), "image/png")
    with Image.open(BytesIO(png)) as decoded:
        assert decoded.text == {}
    options = {"save_all": True, "append_images": [Image.new("RGB", (2, 3), "blue")]}
    apng = sanitize_image(image_bytes("PNG", **options), "image/png")
    with Image.open(BytesIO(apng)) as decoded:
        assert decoded.n_frames == 1
        assert decoded.getpixel((0, 0)) == (255, 0, 0)
    assert sanitize_image(image_bytes("WEBP", **options), "image/webp") is None
    assert sanitize_image(PNG[:-16], "image/png") is None
    assert sanitize_image(PNG, "image/webp") is None
    ihdr = PNG[12:16] + (4001).to_bytes(4, "big") + (4000).to_bytes(4, "big") + PNG[24:29]
    oversized = PNG[:12] + ihdr + crc32(ihdr).to_bytes(4, "big") + PNG[33:]
    assert sanitize_image(oversized, "image/png") is None


def test_catalogue_routes_keep_role_origin_version_body_and_media_contract(client, sign_in):
    path = "/api/v1/admin/products"
    assert client.get(path).status_code == 401
    _, admin = sign_in("ADMIN")
    _, customer = sign_in()
    assert client.get(path, headers=customer).status_code == 403
    assert client.get("/api/v1/catalog", headers=admin).status_code == 403
    assert client.get(path + "?status=INVALID", headers=admin).status_code == 422
    assert client.get("/api/v1/catalog?limit=0", headers=customer).status_code == 400
    assert client.get(path + "/not-a-uuid", headers=admin).status_code == 404

    headers = {**admin, "Idempotency-Key": str(uuid4())}
    assert client.post(path, headers={**headers, "Origin": "https://foreign.example"}, json={}).status_code == 403
    assert client.post(path, headers={**headers, "X-CSRF-Token": ""}, json={}).status_code == 403
    invalid = client.post(path, headers=headers, json={"name": ""})
    assert invalid.status_code == 422
    assert invalid.json()["fieldErrors"] == [{"field": "name", "code": "INVALID_TEXT"}]
    assert invalid.json()["requestId"] == invalid.headers["x-request-id"]
    assert client.post(path, headers=admin, json={"name": "Route cake"}).status_code == 422

    created = client.post(path, headers=headers, json={"name": "Route cake", "category": "Cakes"})
    assert created.status_code == 201
    assert created.headers["cache-control"] == "no-store"
    draft = created.json()
    detail_path = f"{path}/{draft['id']}"
    storefront_path = f"/api/v1/catalog/products/{draft['id']}"
    assert client.get(detail_path, headers=admin).json() == draft
    assert client.get(storefront_path, headers=customer).status_code == 404
    assert client.post(path, headers=headers, json={"name": "Route cake", "category": "Cakes"}).json() == draft

    media_headers = {
        **admin, "Idempotency-Key": str(uuid4()),
        "Content-Type": "application/octet-stream", "X-File-Media-Type": "image/png",
    }
    media_path = detail_path + "/media"
    assert client.post(media_path, headers={**media_headers, "Content-Type": "image/png"}, content=PNG).status_code == 415
    oversize = client.post(media_path, headers=media_headers, content=bytes(MAX_PHOTO_BYTES + 1))
    assert (oversize.status_code, oversize.json()["code"]) == (413, "PAYLOAD_TOO_LARGE")
    upload = client.post(media_path, headers=media_headers, content=PNG)
    assert upload.status_code == 201
    photo = upload.json()
    preview = client.get(f"{media_path}/{photo['id']}", headers=admin)
    assert preview.status_code == 200
    assert preview.headers["content-type"] == "image/png"
    assert preview.headers["x-content-type-options"] == "nosniff"
    assert len(preview.content) == photo["byteCount"]
    listed_photo = f"/api/v1/catalog/media/{photo['id']}"
    assert client.get(listed_photo, headers=customer).status_code == 404

    body = edit(draft, status="LISTED", variants=[VARIANT], imageRefs=[photo["id"]])
    update_headers = {**admin, "Idempotency-Key": str(uuid4())}
    assert client.put(detail_path, headers={**update_headers, "If-Match": "1"}, json=body).status_code == 422
    listed = client.put(detail_path, headers={**update_headers, "If-Match": '"1"'}, json=body)
    assert listed.status_code == 200
    assert client.get(storefront_path, headers=customer).json() == listed.json()
    assert client.get("/api/v1/catalog?category=Cakes&limit=1&limit=0", headers=customer).json()["items"] == [listed.json()]
    assert client.get(path + "?status=LISTED", headers=admin).json()["items"] == [listed.json()]
    assert client.get(listed_photo, headers=customer).content == preview.content
