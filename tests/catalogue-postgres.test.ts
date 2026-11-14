import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { crc32 } from "node:zlib";
import { CatalogueService, MAX_PHOTO_BYTES, type Product, type UpdateProduct } from "../frontend/server/catalogue";
import { ApiProblem } from "../frontend/server/http/problem";
import { startTestPostgres } from "./postgres-harness";

const admin = { accountId: randomUUID(), role: "ADMIN" } as const;
const customer = { accountId: randomUUID(), role: "CUSTOMER" } as const;
const command = () => ({ idempotencyKey: randomUUID(), requestId: "catalogue-test" });
const slice = { name: "Slice", flavour: "Pandan", unitMinor: 650, prepMinutes: 15, available: true };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNYoJAAAAKEASFBcshFAAAAAElFTkSuQmCC", "base64");
const jpeg = Buffer.from(
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/" +
  "2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAAR" +
  "CAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAA" +
  "AAAAAAAAAAAABAf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCeAFqG/9k=",
  "base64",
);
const webp = Buffer.from("UklGRjgAAABXRUJQVlA4ICwAAABwAQCdASoBAAEAAUAmJaACdAFAAAD+8ql8CStWF7/6tD//lof/8tD9uwAAAA==", "base64");
const invalidPng = png.subarray(0, 8);

function pngAtLimit() {
  const chunk = Buffer.alloc(MAX_PHOTO_BYTES - png.length);
  chunk.writeUInt32BE(chunk.length - 12);
  chunk.write("npAd", 4, "ascii");
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
}

function edit(product: Product, overrides: Partial<UpdateProduct> = {}): UpdateProduct {
  return {
    name: product.name,
    status: product.status,
    variants: product.variants.map(({ productId: _productId, ...variant }) => variant),
    imageRefs: product.imageRefs,
    ...overrides,
  };
}

function problem(status: number, code: string) {
  return (error: unknown) => error instanceof ApiProblem && error.status === status && error.code === code;
}

test("CAT-01 and CAT-05 catalogue service on migrated PostgreSQL", async (t) => {
  const db = await startTestPostgres();
  t.after(db.close);
  const { api, storage } = db;
  await api.query(`
    INSERT INTO account (id, role, phone_e164, recovery_email)
    VALUES ($1, 'ADMIN', NULL, 'merchant@example.invalid'), ($2, 'CUSTOMER', '+60100000001', NULL)
  `, [admin.accountId, customer.accountId]);
  const { rows: [version] } = await api.query("SHOW server_version");
  t.diagnostic(`PostgreSQL ${version.server_version}; private storage and decoder are test doubles`);
  const service = new CatalogueService(api, { put: storage.put, get: storage.read }, async (bytes) =>
    bytes.byteLength <= invalidPng.length ? null : bytes,
  );

  await t.test("SC-12 projects only listed and available selections with bounded category pagination", async () => {
    const key = command();
    const first = await service.createProduct(admin, { name: "Pandan cake", category: "Cakes" }, key);
    assert.deepEqual(first, { id: first.id, name: "Pandan cake", category: "Cakes", status: "DRAFT", version: 1, variants: [], imageRefs: [] });
    assert.deepEqual(await service.createProduct(admin, { name: "Pandan cake", category: "Cakes" }, key), first);
    await assert.rejects(service.createProduct(admin, { name: "Different cake" }, key), problem(409, "IDEMPOTENCY_CONFLICT"));
    assert.deepEqual(await service.listCatalog(customer, { category: "Cakes" }), { items: [], nextCursor: null });
    const firstListed = await service.updateProduct(admin, first.id, first.version, edit(first, {
      status: "LISTED", variants: [slice, { ...slice, flavour: "Chocolate", available: false }],
    }), command());
    const second = await service.createProduct(admin, { name: "Chocolate cake", category: "Cakes" }, command());
    const secondListed = await service.updateProduct(admin, second.id, second.version, edit(second, {
      status: "LISTED", variants: [{ ...slice, flavour: "Chocolate" }],
    }), command());
    const other = await service.createProduct(admin, { name: "Tart", category: "Pastries" }, command());
    await service.updateProduct(admin, other.id, other.version, edit(other, { status: "LISTED", variants: [slice] }), command());
    const firstPage = await service.listCatalog(customer, { category: "Cakes", limit: 1 });
    assert.equal(firstPage.items.length, 1);
    assert.ok(firstPage.nextCursor);
    const secondPage = await service.listCatalog(customer, { category: "Cakes", limit: 1, cursor: firstPage.nextCursor });
    assert.equal(secondPage.nextCursor, null);
    assert.deepEqual([...firstPage.items, ...secondPage.items].map(({ id }) => id), [first.id, second.id].sort());
    await assert.rejects(service.listCatalog(customer, { category: "Pastries", cursor: firstPage.nextCursor }), problem(400, "VALIDATION"));
    const detail = await service.getListedProduct(customer, first.id);
    assert.deepEqual(detail, { ...firstListed, variants: firstListed.variants.filter(({ available }) => available) });
    assert.deepEqual(detail.variants, [{ ...slice, id: detail.variants[0].id, productId: first.id }]);
    assert.deepEqual(await service.getMerchantProduct(admin, first.id), firstListed);
    assert.ok((await service.listMerchantProducts(admin, { status: "LISTED" })).items.some(({ id }) => id === secondListed.id));
  });

  await t.test("SC-13–14 control visibility and preserve the committed order line and variant ID", async () => {
    let product = await service.createProduct(admin, { name: "Old cake", category: "History" }, command());
    await assert.rejects(service.getListedProduct(customer, product.id), problem(404, "NOT_FOUND"));
    product = await service.updateProduct(admin, product.id, product.version, edit(product, {
      status: "LISTED", variants: [slice],
    }), command());
    const originalVariant = product.variants[0];
    const orderId = randomUUID();
    const reviewId = randomUUID();
    const snapshot = { product: product.name, variant: originalVariant.name, flavour: originalVariant.flavour };
    await api.query(`
      INSERT INTO checkout_review
        (id, account_id, cart_version, review_digest, terms_version, review_snapshot, expires_at, status, consumed_at, updated_at)
      VALUES ($1, $2, 1, '\\x00', 'v1', '{}', now() + interval '1 hour', 'SUBMITTED', now(), now())
    `, [reviewId, customer.accountId]);
    await api.query(`
      INSERT INTO standard_order
        (id, order_number, account_id, checkout_review_id, status, fulfilment, payment_method, service_date,
         requested_handoff_at, fulfilment_snapshot, subtotal_minor, fee_minor, terms_version, created_at, updated_at)
      VALUES ($1, 'CAT-HISTORY', $2, $3, 'COMPLETED', 'PICKUP', 'CASH', current_date,
              now(), '{}', 650, 0, 'v1', now(), now())
    `, [orderId, customer.accountId, reviewId]);
    await api.query(`
      INSERT INTO standard_order_line (order_id, variant_id, product_id, quantity, unit_minor, display_snapshot)
      VALUES ($1, $2, $3, 1, 650, $4)
    `, [orderId, originalVariant.id, product.id, snapshot]);

    for (const status of ["UNLISTED", "SUSPENDED", "SOLD_OUT", "ARCHIVED"] as const) {
      product = await service.updateProduct(admin, product.id, product.version, edit(product, { status }), command());
      await assert.rejects(service.getListedProduct(customer, product.id), problem(404, "NOT_FOUND"));
      assert.deepEqual((await service.listCatalog(customer, { category: "History" })).items, []);
      assert.ok((await service.listMerchantProducts(admin, { status })).items.some(({ id }) => id === product.id));
      if (status !== "ARCHIVED") {
        product = await service.updateProduct(admin, product.id, product.version, edit(product, {
          status: "LISTED", name: "Renamed cake", variants: [{ ...slice, unitMinor: 750 }],
        }), command());
        const shown = await service.getListedProduct(customer, product.id);
        assert.deepEqual(shown.variants.map(({ unitMinor }) => unitMinor), [750]);
        assert.equal(product.variants.find(({ id }) => id === originalVariant.id)?.available, false);
      }
    }
    await assert.rejects(service.updateProduct(admin, product.id, product.version, edit(product, {
      status: "LISTED", variants: [slice],
    }), command()), problem(409, "INVALID_TRANSITION"));
    const line = await api.query(
      "SELECT variant_id, unit_minor::int AS unit_minor, display_snapshot FROM standard_order_line WHERE order_id = $1", [orderId],
    );
    assert.deepEqual(line.rows, [{ variant_id: originalVariant.id, unit_minor: 650, display_snapshot: snapshot }]);
  });

  await t.test("SC-15 serializes competing saves, checks replay before version, and keeps the winning edit", async () => {
    const product = await service.createProduct(admin, { name: "Race", category: "Races" }, command());
    await assert.rejects(service.updateProduct(admin, product.id, product.version, edit(product, {
      status: "LISTED", category: null, variants: [slice],
    }), command()), problem(422, "VALIDATION"));

    const inputs = ["Winner A", "Winner B"].map((name) => ({ body: edit(product, { name }), key: command() }));
    const results = await Promise.allSettled(inputs.map(({ body, key }) =>
      service.updateProduct(admin, product.id, product.version, body, key),
    ));
    const winnerIndex = results.findIndex((result) => result.status === "fulfilled");
    assert.ok(winnerIndex >= 0);
    const winner = results[winnerIndex];
    const loser = results[1 - winnerIndex];
    assert.equal(winner.status, "fulfilled");
    assert.equal(loser.status, "rejected");
    assert.ok(problem(409, "VERSION_CONFLICT")(loser.reason));
    const { body, key } = inputs[winnerIndex];
    assert.deepEqual(await service.updateProduct(admin, product.id, product.version, body, key), winner.value);
    assert.deepEqual(await service.getMerchantProduct(admin, product.id), winner.value);
    const audit = await api.query("SELECT action FROM audit_event WHERE resource_id = $1 ORDER BY occurred_at", [product.id]);
    assert.deepEqual(audit.rows, [{ action: "createProduct" }, { action: "updateProduct" }]);
  });

  await t.test("SC-24–25 stage supported types, enforce attachment scope, and atomically save and retire photos", async () => {
    const product = await service.createProduct(admin, { name: "Gallery", category: "Gallery" }, command());
    const other = await service.createProduct(admin, { name: "Foreign photo", category: "Gallery" }, command());
    const key = command();
    const bytes = pngAtLimit();
    const large = await service.uploadProductPhoto(admin, product.id, "image/png", bytes, key);
    assert.equal(large.byteCount, MAX_PHOTO_BYTES);
    assert.equal(large.state, "STAGED");
    assert.equal(large.productId, product.id);
    assert.equal(Object.hasOwn(large, "objectKey"), false);
    assert.deepEqual(await service.uploadProductPhoto(admin, product.id, "image/png", bytes, key), large);
    await assert.rejects(service.uploadProductPhoto(admin, product.id, "image/png", png, key), problem(409, "IDEMPOTENCY_CONFLICT"));
    const first = await service.uploadProductPhoto(admin, product.id, "image/jpeg", jpeg, command());
    const second = await service.uploadProductPhoto(admin, product.id, "image/webp", webp, command());
    const foreign = await service.uploadProductPhoto(admin, other.id, "image/png", png, command());
    await assert.rejects(service.getMerchantProductPhoto(admin, other.id, large.id), problem(404, "NOT_FOUND"));
    const preview = await service.getMerchantProductPhoto(admin, product.id, large.id);
    assert.equal(preview.mediaType, "image/png");
    assert.deepEqual(preview.bytes, bytes);
    await assert.rejects(service.getListedProductPhoto(customer, large.id), problem(404, "NOT_FOUND"));
    await assert.rejects(service.uploadProductPhoto(admin, product.id, "image/png", invalidPng, command()), problem(415, "UNSUPPORTED_MEDIA"));
    assert.deepEqual(await service.getMerchantProduct(admin, product.id), product);

    const refs = [large.id, first.id, second.id];
    for (let i = 0; i < 9; i++) {
      refs.push((await service.uploadProductPhoto(admin, product.id, "image/png", png, command())).id);
    }
    const listed = await service.updateProduct(admin, product.id, product.version, edit(product, {
      status: "LISTED", variants: [slice], imageRefs: refs,
    }), command());
    assert.deepEqual((await service.getListedProduct(customer, product.id)).imageRefs, refs);
    assert.equal((await service.getListedProductPhoto(customer, first.id)).mediaType, "image/jpeg");
    assert.equal((await service.getListedProductPhoto(customer, second.id)).mediaType, "image/webp");

    await assert.rejects(service.updateProduct(admin, product.id, listed.version, edit(listed, {
      name: "Should roll back", variants: [{ ...slice, unitMinor: 800 }], imageRefs: [foreign.id],
    }), command()), problem(404, "NOT_FOUND"));
    await assert.rejects(service.updateProduct(admin, product.id, product.version, edit(listed, {
      imageRefs: [],
    }), command()), problem(409, "VERSION_CONFLICT"));
    assert.deepEqual(await service.getMerchantProduct(admin, product.id), listed);
    assert.deepEqual((await service.getListedProduct(customer, product.id)).imageRefs, refs);

    const reordered = await service.updateProduct(admin, product.id, listed.version, edit(listed, {
      imageRefs: [second.id, first.id, ...refs.slice(3)],
    }), command());
    assert.equal((await service.getListedProduct(customer, product.id)).imageRefs[0], second.id);
    await assert.rejects(service.getListedProductPhoto(customer, large.id), problem(404, "NOT_FOUND"));
    await assert.rejects(service.getMerchantProductPhoto(admin, product.id, large.id), problem(404, "NOT_FOUND"));
    await assert.rejects(service.updateProduct(admin, product.id, reordered.version, edit(reordered, {
      imageRefs: [large.id],
    }), command()), problem(404, "NOT_FOUND"));
    await service.updateProduct(admin, product.id, reordered.version, edit(reordered, { status: "SOLD_OUT" }), command());
    await assert.rejects(service.getListedProductPhoto(customer, second.id), problem(404, "NOT_FOUND"));
    assert.equal((await service.getMerchantProductPhoto(admin, product.id, second.id)).mediaType, "image/webp");
  });

  await t.test("dependency failures do not register staged photos or change the saved gallery", async () => {
    const draft = await service.createProduct(admin, { name: "Dependency failure" }, command());
    const photo = await service.uploadProductPhoto(admin, draft.id, "image/png", png, command());
    const saved = await service.updateProduct(admin, draft.id, draft.version, edit(draft, { imageRefs: [photo.id] }), command());
    const decoderUnavailable = new CatalogueService(api, {
      put: async () => assert.fail("Image write attempted after decoder failure"),
      get: storage.read,
    }, async () => { throw new Error("Synthetic decoder failure"); });
    const storageUnavailable = new CatalogueService(api, {
      put: async () => { throw new Error("Synthetic object write failure"); },
      get: storage.read,
    }, async (bytes) => bytes);

    await assert.rejects(decoderUnavailable.uploadProductPhoto(admin, draft.id, "image/png", png, command()),
      problem(503, "DEPENDENCY_UNAVAILABLE"));
    await assert.rejects(storageUnavailable.uploadProductPhoto(admin, draft.id, "image/png", png, command()),
      problem(503, "DEPENDENCY_UNAVAILABLE"));
    assert.deepEqual(await service.getMerchantProduct(admin, draft.id), saved);
    const { rows } = await api.query("SELECT id, lifecycle FROM product_media WHERE product_id = $1", [draft.id]);
    assert.deepEqual(rows, [{ id: photo.id, lifecycle: "ATTACHED" }]);
  });
});
