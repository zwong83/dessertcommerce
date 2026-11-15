import { CatalogueError, readProducts, type Product, type ProductStatus } from "./merchant-catalog-model";

export type CatalogueFilters = {
  search: string;
  category: string;
  status: ProductStatus | "";
  photos: "" | "with" | "without";
  sort: "name" | "name-desc" | "price-low" | "price-high";
};

export const defaultCatalogueFilters: CatalogueFilters = {
  search: "", category: "", status: "", photos: "", sort: "name",
};
export const cataloguePageSize = 24;

// Complete the cursor traversal before exposing results: filters must cover the
// entire catalogue, and a failed later page must not look like an empty match.
export async function readCatalogue(signal: AbortSignal): Promise<Product[]> {
  const products = new Map<string, Product>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    signal.throwIfAborted();
    const page = await readProducts("", cursor, signal);
    page.items.forEach(product => products.set(product.id, product));
    cursor = page.nextCursor;
    if (cursor && seenCursors.has(cursor)) {
      throw new CatalogueError(null, 0, "The catalogue could not finish loading. Please refresh products.");
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return [...products.values()];
}

export function filterCatalogue(products: Product[], filters: CatalogueFilters): Product[] {
  const terms = filters.search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = products.filter(product => {
    if (filters.status && product.status !== filters.status) return false;
    if (filters.category && product.category !== filters.category) return false;
    if (filters.photos === "with" && !product.imageRefs.length) return false;
    if (filters.photos === "without" && product.imageRefs.length) return false;
    const searchable = [product.name, product.category ?? "",
      ...product.variants.flatMap(variant => [variant.name, variant.flavour])].join(" ").toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  });
  const price = (product: Product) => product.variants.length
    ? Math.min(...product.variants.map(variant => variant.unitMinor)) : null;
  return matches.sort((left, right) => {
    if (filters.sort === "price-low" || filters.sort === "price-high") {
      const a = price(left), b = price(right);
      // Quotation-only products belong last in both price directions.
      if (a === null && b !== null) return 1;
      if (b === null && a !== null) return -1;
      if (a !== null && b !== null && a !== b) return filters.sort === "price-low" ? a - b : b - a;
    }
    const byName = left.name.localeCompare(right.name, "en", { numeric: true, sensitivity: "base" });
    return (filters.sort === "name-desc" ? -byName : byName) || left.id.localeCompare(right.id);
  });
}
