import assert from "node:assert/strict";
import test from "node:test";
import { defaultCatalogueFilters, filterCatalogue, readCatalogue } from "../frontend/ui/merchant-catalog-filters";
import type { Product } from "../frontend/ui/merchant-catalog-model";

function product(id: string, name: string, category: string | null, price?: number): Product {
  return { id, name, category, status: "DRAFT", imageRefs: [], version: 1,
    variants: price === undefined ? [] : [{ id: `variant-${id}`, productId: id,
      name: "Box of 6", flavour: "Chocolate", unitMinor: price, prepMinutes: 0, available: true }] };
}
const tart = { ...product("1", "Christmas Tart", "Christmas", 700), imageRefs: ["photo"] };
const cake = product("2", "Whole Cake", "Cakes");
const choux = { ...product("3", "Mini Choux", "Desserts", 500), status: "LISTED" as const };
const products = [tart, cake, choux];

test("catalogue search combines words across product, category, flavour and variant with all filters", () => {
  const filters = { ...defaultCatalogueFilters, search: "  CHOCOLATE  box Christmas ", category: "Christmas", status: "DRAFT" as const, photos: "with" as const };
  assert.deepEqual(filterCatalogue(products, filters), [tart]);
  assert.deepEqual(filterCatalogue(products, { ...filters, photos: "without" }), []);
  assert.deepEqual(filterCatalogue(products, { ...filters, category: "Desserts" }), []);
  assert.deepEqual(filterCatalogue(products, { ...filters, status: "LISTED" }), []);
  assert.deepEqual(filterCatalogue(products, { ...defaultCatalogueFilters, photos: "without" }), [choux, cake]);
  assert.equal(filterCatalogue([...products, product("4", "No category", null)], defaultCatalogueFilters).length, 4);
});

test("catalogue sorting uses starting price, puts quotations last, and never mutates source order", () => {
  const multi = { ...tart, variants: [...tart.variants, { ...tart.variants[0], id: "cheaper", unitMinor: 300 }] };
  const source = [cake, choux, multi];
  assert.deepEqual(filterCatalogue(source, { ...defaultCatalogueFilters, sort: "price-low" }), [multi, choux, cake]);
  assert.deepEqual(filterCatalogue(source, { ...defaultCatalogueFilters, sort: "price-high" }), [choux, multi, cake]);
  assert.deepEqual(filterCatalogue(source, { ...defaultCatalogueFilters, sort: "name-desc" }), [cake, choux, multi]);
  assert.deepEqual(source, [cake, choux, multi]);
});

test("search finds a product beyond the first API page and deduplicates overlapping pages", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const second = String(url).includes("cursor=");
    return Response.json(second ? { items: [tart, choux], nextCursor: null } : { items: [tart, cake], nextCursor: "next+page" });
  });
  const all = await readCatalogue(new AbortController().signal);
  assert.equal(all.length, 3);
  assert.deepEqual(filterCatalogue(all, { ...defaultCatalogueFilters, search: "choux" }), [choux]);
  assert.match(String(fetch.mock.calls[1].arguments[0]), /cursor=next%2Bpage/);
});

test("an incomplete, repeating or cancelled catalogue load cannot silently return partial search results", async t => {
  let calls = 0;
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return calls === 1 ? Response.json({ items: [tart], nextCursor: "next" })
      : Response.json({ message: "Unavailable" }, { status: 503 });
  });
  await assert.rejects(readCatalogue(new AbortController().signal), /Unavailable/);
  fetch.mock.mockImplementation(async () => Response.json({ items: [tart], nextCursor: "loop" }));
  await assert.rejects(readCatalogue(new AbortController().signal), /finish loading/);
  const controller = new AbortController();
  controller.abort();
  const before = fetch.mock.callCount();
  await assert.rejects(readCatalogue(controller.signal));
  assert.equal(fetch.mock.callCount(), before);
});
