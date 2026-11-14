import type { components, operations } from "../contracts/standard-v1";

export type Product = components["schemas"]["Product"];
export type ProductStatus = Product["status"];
export type ProductPage = operations["listMerchantProducts"]["responses"][200]["content"]["application/json"];
export type CreateProduct = operations["createProduct"]["requestBody"]["content"]["application/json"];
export type UpdateProduct = operations["updateProduct"]["requestBody"]["content"]["application/json"];
export type ProductMedia = components["schemas"]["ProductMedia"];
export type MerchantSession = Pick<components["schemas"]["Session"], "accountId" | "csrfToken">;
type Problem = components["schemas"]["Problem"];

export const cataloguePath = "/merchant/catalog";
const productsPath = "/api/v1/admin/products";
export const productPagePath = (id: string) => cataloguePath + "/" + encodeURIComponent(id);
const productPath = (id: string) => productsPath + "/" + encodeURIComponent(id);
export const photoPath = (id: string, mediaId: string) => productPath(id) + "/media/" + encodeURIComponent(mediaId);

export const statusNames: Record<ProductStatus, string> = {
  DRAFT: "Draft",
  LISTED: "Listed",
  UNLISTED: "Unlisted",
  SUSPENDED: "Suspended",
  SOLD_OUT: "Sold out",
  ARCHIVED: "Archived",
};

type PublicationAction = { to: ProductStatus; label: string; effect: string };
const list = { to: "LISTED", label: "List product", effect: "Customers will be able to order available variants." } as const;
const resume = { ...list, label: "Resume listing" };
const archive = { to: "ARCHIVED", label: "Archive product", effect: "Archiving is permanent and closes this product to new orders." } as const;

export const publicationActions: Record<ProductStatus, readonly PublicationAction[]> = {
  DRAFT: [list, archive],
  LISTED: [
    { to: "UNLISTED", label: "Unlist product", effect: "Customers will no longer see this product in the catalogue." },
    { to: "SUSPENDED", label: "Suspend product", effect: "The product will be hidden until you resume its listing." },
    { to: "SOLD_OUT", label: "Mark as sold out", effect: "The product will be unavailable to customers until you resume its listing." },
    archive,
  ],
  UNLISTED: [list, archive],
  SUSPENDED: [resume, archive],
  SOLD_OUT: [resume, archive],
  ARCHIVED: [],
};

export const photoTypes = ["image/jpeg", "image/png", "image/webp"] as const satisfies readonly ProductMedia["mediaType"][];
export const maxPhotos = 12;

export function photoIssue(file: Pick<File, "size" | "type">): string | null {
  if (file.size > 5 * 1024 * 1024) return "Choose a photo no larger than 5 MiB.";
  if (file.size === 0 || !photoTypes.some((type) => type === file.type)) return "Choose a valid JPEG, PNG or WebP photo.";
  return null;
}

export function movePhoto(ids: string[], from: number, to: number): string[] {
  if (to < 0 || to >= ids.length) return ids;
  const ordered = [...ids];
  const [photo] = ordered.splice(from, 1);
  ordered.splice(to, 0, photo);
  return ordered;
}

export function addStagedPhoto(ids: string[], photo: string, position: number | null): string[] {
  return position === null ? [...ids, photo] : ids.map((id, index) => index === position ? photo : id);
}

export function priceInSen(value: string): number | null {
  const amount = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value.trim());
  return amount ? Number(amount[1]) * 100 + Number((amount[2] ?? "").padEnd(2, "0")) : null;
}

export type FieldIssues = Record<string, string>;

export type VariantFields = {
  key: string;
  id?: string;
  name: string;
  flavour: string;
  price: string;
  prep: string;
  available: boolean;
};

export function prepareProductUpdate(name: string, category: string, status: ProductStatus, variants: VariantFields[], imageRefs: string[]) {
  const issues: FieldIssues = {};
  if (!name.trim()) issues.name = "Enter a product name.";
  if (status === "LISTED" && !category.trim()) issues.category = "Enter a category before listing.";
  if (status === "LISTED" && !variants.some(variant => variant.available)) issues.variants = "Make at least one variant available before listing.";

  const values = variants.map((variant, index) => {
    const field = `variants.${index}`;
    const unitMinor = priceInSen(variant.price);
    const prepMinutes = Number(variant.prep);
    if (!variant.name.trim()) issues[field + ".name"] = "Enter a variant name.";
    if (!variant.flavour.trim()) issues[field + ".flavour"] = "Enter a flavour.";
    if (unitMinor === null) issues[field + ".unitMinor"] = "Enter a MYR amount up to 9,999,999.99 with at most two decimal places.";
    if (!/^\d+$/.test(variant.prep) || prepMinutes > 10_080) issues[field + ".prepMinutes"] = "Enter whole minutes from 0 to 10,080.";
    return { id: variant.id, name: variant.name.trim(), flavour: variant.flavour.trim(),
      unitMinor: unitMinor ?? 0, prepMinutes, available: variant.available };
  });

  if (Object.keys(issues).length) return { issues, input: null };
  const input: UpdateProduct = { name: name.trim(), category: category.trim() || null, status, variants: values, imageRefs };
  return { issues, input };
}

export class CatalogueError extends Error {
  constructor(readonly problem: Problem | null, readonly status: number, message: string) {
    super(message);
  }

  get uncertain() {
    return this.status === 0 || this.status >= 500;
  }

  get needsSignIn() {
    return this.status === 401 || this.status === 403;
  }
}

async function request<T>(url: string, init?: RequestInit, timeoutMs = 5_000): Promise<T> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal, cache: "no-store" });
  } catch {
    const message = deadline.aborted ? "The catalogue request timed out." : "The connection was interrupted. Try again when you’re back online.";
    throw new CatalogueError(null, 0, message);
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as Problem | null;
    throw new CatalogueError(problem, response.status, problem?.message ?? "The catalogue request failed. Try again.");
  }
  try {
    return await response.json() as T;
  } catch {
    throw new CatalogueError(null, 0, "The catalogue response could not be read.");
  }
}

export function readProducts(status: ProductStatus | "", cursor: string | null, signal: AbortSignal) {
  const query = new URLSearchParams({ limit: "25" });
  if (status) query.set("status", status);
  if (cursor) query.set("cursor", cursor);
  return request<ProductPage>(productsPath + "?" + query, { signal });
}

export function readProduct(id: string, signal: AbortSignal) {
  return request<Product>(productPath(id), { signal });
}

export async function refreshMerchantSession(accountId: string) {
  const session = await request<components["schemas"]["Session"]>("/api/v1/session");
  if (session.role !== "ADMIN" || session.accountId !== accountId) {
    throw new CatalogueError(null, 403, "Sign in to the original merchant account to continue this draft.");
  }
  return session.csrfToken;
}

function writeHeaders(csrfToken: string, key: string, contentType: string) {
  return { "X-CSRF-Token": csrfToken, "Idempotency-Key": key, "Content-Type": contentType };
}

export function createProduct(input: CreateProduct, csrfToken: string, key: string) {
  return request<Product>(productsPath, {
    method: "POST", headers: writeHeaders(csrfToken, key, "application/json"), body: JSON.stringify(input),
  });
}

export function updateProduct(id: string, version: number, input: UpdateProduct, csrfToken: string, key: string) {
  return request<Product>(productPath(id), {
    method: "PUT",
    headers: { ...writeHeaders(csrfToken, key, "application/json"), "If-Match": '"' + version + '"' },
    body: JSON.stringify(input),
  });
}

export function stagePhoto(id: string, file: File, csrfToken: string, key: string) {
  return request<ProductMedia>(productPath(id) + "/media", {
    method: "POST",
    headers: { ...writeHeaders(csrfToken, key, "application/octet-stream"), "X-File-Media-Type": file.type },
    body: file,
  }, 30_000);
}
