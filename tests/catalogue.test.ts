import assert from "node:assert/strict";
import test from "node:test";
import { CatalogueService, type CatalogueObjectStore } from "../frontend/server/catalogue";
import { ApiProblem } from "../frontend/server/http/problem";

const productId = "00000000-0000-4000-8000-000000000001";
const admin = { accountId: "00000000-0000-4000-8000-000000000002", role: "ADMIN" } as const;
const customer = { accountId: "00000000-0000-4000-8000-000000000003", role: "CUSTOMER" } as const;
const command = { idempotencyKey: "00000000-0000-4000-8000-000000000004", requestId: "test-request" };
const draft = { name: "Pandan cake" };
const update = {
  ...draft,
  status: "LISTED" as const,
  category: "Cakes",
  variants: [{ name: "Slice", flavour: "Pandan", unitMinor: 650, prepMinutes: 15, available: true }],
  imageRefs: [],
};
const noDatabase = {
  query: async () => assert.fail("Database queried"),
  connect: async () => assert.fail("Database connection requested"),
};
const noStore: CatalogueObjectStore = {
  put: async () => assert.fail("Object written"),
  get: async () => assert.fail("Object read"),
};
const service = new CatalogueService(noDatabase, noStore, async () => assert.fail("Image decoded"));

function problem(status: number, code: string) {
  return (error: unknown) => error instanceof ApiProblem && error.status === status && error.code === code;
}

test("CAT-01 and CAT-05 enforce their actor role before looking up resources", async () => {
  for (const useCase of [
    service.listMerchantProducts(customer),
    service.getMerchantProduct(customer, productId),
    service.createProduct(customer, draft, command),
    service.updateProduct(customer, productId, 1, update, command),
    service.uploadProductPhoto(customer, productId, "image/jpeg", Uint8Array.of(1), command),
    service.getMerchantProductPhoto(customer, productId, productId),
    service.listCatalog(admin),
    service.getListedProduct(admin, productId),
    service.getListedProductPhoto(admin, productId),
  ]) {
    await assert.rejects(useCase, problem(403, "FORBIDDEN"));
  }
  await assert.rejects(service.listCatalog(null), problem(401, "UNAUTHENTICATED"));
});

test("SC-15 rejects invalid versions and fields before requesting a transaction", async () => {
  await assert.rejects(service.createProduct(admin, { name: "  " }, command), problem(422, "VALIDATION"));
  await assert.rejects(service.updateProduct(admin, productId, 0, update, command), problem(400, "VALIDATION"));
  for (const edit of [
    { ...update, category: null },
    { ...update, variants: [{ ...update.variants[0], unitMinor: 6.5 }] },
    { ...update, variants: [{ ...update.variants[0], prepMinutes: 10081 }] },
    { ...update, variants: [{ ...update.variants[0], flavour: " " }] },
    { ...update, variants: [{ ...update.variants[0], available: false }] },
    { ...update, imageRefs: Array.from({ length: 13 }, () => productId) },
    { ...update, imageRefs: [productId, productId] },
  ]) {
    await assert.rejects(service.updateProduct(admin, productId, 1, edit, command), problem(422, "VALIDATION"));
  }
});

test("SC-25 rejects oversized uploads and forged MIME types before decoding or storing", async () => {
  for (const [type, bytes, status, code] of [
    ["image/png", new Uint8Array(5 * 1024 * 1024 + 1), 413, "PAYLOAD_TOO_LARGE"],
    ["image/png", Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), 415, "UNSUPPORTED_MEDIA"],
    ["image/gif", Uint8Array.of(71, 73, 70), 415, "UNSUPPORTED_MEDIA"],
    ["image/webp", new Uint8Array(), 415, "UNSUPPORTED_MEDIA"],
  ] as const) {
    await assert.rejects(service.uploadProductPhoto(admin, productId, type, bytes, command), problem(status, code));
  }
});

test("malformed page requests return a contract problem before querying", async () => {
  await assert.rejects(service.listCatalog(customer, { limit: 101 }), problem(400, "VALIDATION"));
  await assert.rejects(service.listCatalog(customer, { cursor: "bad-cursor" }), problem(400, "VALIDATION"));
});
