import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GalleryEditor } from "../src/ui/merchant-catalog-gallery";
import { ProductIdentityFields } from "../src/ui/merchant-catalog";
import {
  CatalogueError, addStagedPhoto, createProduct, movePhoto, photoIssue, prepareProductUpdate,
  priceInSen, publicationActions, readProducts, refreshMerchantSession, stagePhoto, updateProduct,
  type Product,
} from "../src/ui/merchant-catalog-model";

const product: Product = {
  id: "8e109917-7b8e-4ba1-8765-cbfae1af7192", name: "Lemon tart",
  category: "Tarts", status: "DRAFT", variants: [], imageRefs: ["cover", "second"], version: 3,
};
const variant = {
  key: "tart", id: "6d7e2155-8cf9-460a-b4f5-70cb9e079f84", name: "Box of 4",
  flavour: "Lemon", price: "6.50", prep: "10080", available: true,
};
const key = "85a62cdc-85d2-4c9f-88e7-a65e53582f75";
const token = "synthetic-csrf";

test("SC-14 exposes the supported publication actions and closes archived products to further changes", () => {
  assert.deepEqual(publicationActions.DRAFT.map(action => action.to), ["LISTED", "ARCHIVED"]);
  assert.deepEqual(publicationActions.LISTED.map(action => action.to), ["UNLISTED", "SUSPENDED", "SOLD_OUT", "ARCHIVED"]);
  for (const status of ["UNLISTED", "SUSPENDED", "SOLD_OUT"] as const) {
    assert.deepEqual(publicationActions[status].map(action => action.to), ["LISTED", "ARCHIVED"]);
  }
  assert.deepEqual(publicationActions.ARCHIVED, []);
});

test("SC-15 identifies invalid fields and converts accepted MYR prices to exact integer sen", () => {
  for (const [value, expected] of [["0", 0], ["6.5", 650], ["0.29", 29], ["9999999.99", 999999999]] as const) {
    assert.equal(priceInSen(value), expected);
  }
  for (const value of ["", "-1", "1.001", "1e3", "10000000", "1,000.00"]) {
    assert.equal(priceInSen(value), null);
  }

  const incomplete = { ...variant, flavour: " ", price: "6.555", prep: "10081", available: false };
  const rejected = prepareProductUpdate("  ", "", "LISTED", [incomplete], product.imageRefs);
  assert.equal(rejected.input, null);
  assert.deepEqual(Object.keys(rejected.issues), [
    "name", "category", "variants", "variants.0.flavour", "variants.0.unitMinor", "variants.0.prepMinutes",
  ]);

  const { input } = prepareProductUpdate(" Lemon tart ", " Tarts ", "LISTED", [variant], product.imageRefs);
  assert.deepEqual(input, {
    name: "Lemon tart", category: "Tarts", status: "LISTED", imageRefs: ["cover", "second"],
    variants: [{ id: variant.id, name: "Box of 4", flavour: "Lemon", unitMinor: 650, prepMinutes: 10080, available: true }],
  });

  const html = renderToStaticMarkup(createElement(ProductIdentityFields, {
    name: "Lemon tart", category: "", onName() {}, onCategory() {}, issues: rejected.issues,
  }));
  assert.match(html, /<label for="category">Category<\/label>/);
  assert.match(html, /<input[^>]*id="category"[^>]*aria-invalid="true"[^>]*aria-describedby="category-error"/);
  assert.match(html, /id="category-error"> Enter a category before listing\./);
});

test("SC-24 and SC-25 render ordered protected previews, keep a separate saved gallery and allow replacement at the limit", () => {
  const saved = ["cover", "second"];
  const moved = movePhoto(saved, 1, 0);
  const changed = addStagedPhoto(moved, "new-cover", 0);
  assert.deepEqual(addStagedPhoto(changed, "third", null), ["new-cover", "cover", "third"]);
  assert.deepEqual(movePhoto(changed, 0, -1), changed);
  assert.deepEqual(saved, ["cover", "second"]);

  const html = renderToStaticMarkup(createElement(GalleryEditor, {
    productId: product.id, ids: [...changed, ...Array.from({ length: 10 }, (_, i) => `photo-${i}`)],
    savedIds: saved, onUpload() {}, onMove() {}, onRemove() {},
  }));
  assert.match(html, /Photo 1 · Cover · Staged/);
  assert.match(html, new RegExp(`/api/v1/admin/products/${product.id}/media/new-cover" alt="Cover photo"`));
  assert.match(html, /aria-label="Move photo 1 earlier"/);
  assert.match(html, /aria-label="Replace photo 12"/);
  assert.match(html, /id="catalogue-photo"[^>]*disabled=""/);
  assert.match(html, /View currently saved gallery/);
  assert.match(html, new RegExp(`/api/v1/admin/products/${product.id}/media/cover" alt="Cover photo"`));
  assert.ok(html.indexOf("/media/new-cover") < html.indexOf("/media/cover"));
});

test("SC-25 applies the approved photo type and size limits before upload", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(photoIssue({ type, size: 5 * 1024 * 1024 }), null);
  }
  assert.match(photoIssue({ type: "image/png", size: 5 * 1024 * 1024 + 1 }) ?? "", /5 MiB/);
  assert.match(photoIssue({ type: "image/gif", size: 1 }) ?? "", /JPEG, PNG or WebP/);
  assert.match(photoIssue({ type: "image/webp", size: 0 }) ?? "", /JPEG, PNG or WebP/);
});

test("SC-14 uses the typed draft endpoint and bounded status and cursor queries", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(product));
  await createProduct({ name: "Lemon tart", category: "Tarts" }, token, key);
  const [createUrl, createInit] = fetch.mock.calls[0].arguments as unknown as [string, RequestInit];
  assert.equal(createUrl, "/api/v1/admin/products");
  assert.equal(createInit.method, "POST");
  assert.equal(new Headers(createInit.headers).get("x-csrf-token"), token);
  assert.equal(new Headers(createInit.headers).get("idempotency-key"), key);
  assert.deepEqual(JSON.parse(String(createInit.body)), { name: "Lemon tart", category: "Tarts" });

  fetch.mock.mockImplementation(async () => Response.json({ items: [product], nextCursor: null }));
  const page = await readProducts("DRAFT", "opaque+cursor", new AbortController().signal);
  assert.deepEqual(page.items, [product]);
  const [listUrl, listInit] = fetch.mock.calls[1].arguments as unknown as [string, RequestInit];
  assert.equal(listUrl, "/api/v1/admin/products?limit=25&status=DRAFT&cursor=opaque%2Bcursor");
  assert.equal(listInit.cache, "no-store");
});

test("SC-15 and SC-24 send only photo bytes to stage and ordered photo IDs in the guarded save", async (t) => {
  const media = { id: "new-cover", productId: product.id, state: "STAGED", mediaType: "image/webp" };
  const conflict = { code: "VERSION_CONFLICT", message: "This product changed. Refresh before saving.", requestId: "fixture", retryable: false };
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(media, { status: 201 }));
  const file = new File(["fixture"], "tart.webp", { type: "image/webp" });

  const staged = await stagePhoto(product.id, file, token, key);
  const [uploadUrl, uploadInit] = fetch.mock.calls[0].arguments as unknown as [string, RequestInit];
  assert.equal(uploadUrl, `/api/v1/admin/products/${product.id}/media`);
  assert.equal(uploadInit.method, "POST");
  assert.equal(uploadInit.body, file);
  const uploadHeaders = new Headers(uploadInit.headers);
  assert.equal(uploadHeaders.get("content-type"), "application/octet-stream");
  assert.equal(uploadHeaders.get("x-file-media-type"), "image/webp");
  assert.equal(uploadHeaders.get("idempotency-key"), key);

  fetch.mock.mockImplementation(async () => Response.json(conflict, { status: 409 }));
  const ids = addStagedPhoto(product.imageRefs, staged.id, 0);
  const { input } = prepareProductUpdate(product.name, "Tarts", "DRAFT", [variant], ids);
  assert.ok(input);
  await assert.rejects(updateProduct(product.id, product.version, input, token, key), (error: unknown) =>
    error instanceof CatalogueError && error.problem?.code === "VERSION_CONFLICT" && !error.uncertain);
  const [saveUrl, saveInit] = fetch.mock.calls[1].arguments as unknown as [string, RequestInit];
  assert.equal(saveUrl, `/api/v1/admin/products/${product.id}`);
  assert.equal(saveInit.method, "PUT");
  const saveHeaders = new Headers(saveInit.headers);
  assert.equal(saveHeaders.get("if-match"), '"3"');
  assert.equal(saveHeaders.get("x-csrf-token"), token);
  assert.deepEqual(JSON.parse(String(saveInit.body)).imageRefs, ["new-cover", "second"]);
  assert.deepEqual(product.imageRefs, ["cover", "second"]);
});

test("SC-59 session recovery accepts a renewed token for the original administrator only", async (t) => {
  const session = { accountId: "merchant", role: "ADMIN", csrfToken: "renewed" };
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(session));
  assert.equal(await refreshMerchantSession("merchant"), "renewed");
  await assert.rejects(refreshMerchantSession("other"), (error: unknown) =>
    error instanceof CatalogueError && error.needsSignIn);
  fetch.mock.mockImplementation(async () => Response.json({ ...session, role: "CUSTOMER" }));
  await assert.rejects(refreshMerchantSession("merchant"), (error: unknown) =>
    error instanceof CatalogueError && error.needsSignIn);
});
