import { createHash } from "node:crypto";
import type { components, operations } from "../../contracts/standard-v1";
import { ApiProblem } from "../http/problem";

export type Product = components["schemas"]["Product"];
export type ProductMedia = components["schemas"]["ProductMedia"];
export type PhotoMediaType = ProductMedia["mediaType"];
export type CreateProduct = operations["createProduct"]["requestBody"]["content"]["application/json"];
export type UpdateProduct = operations["updateProduct"]["requestBody"]["content"]["application/json"];

export type CataloguePrincipal = Readonly<{ accountId: string; role: "ADMIN" | "CUSTOMER" }>;
export type CatalogueCommand = Readonly<{ idempotencyKey: string; requestId: string }>;

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_VARIANTS = 100;
const statuses: Record<Product["status"], readonly Product["status"][]> = {
  DRAFT: ["DRAFT", "LISTED", "ARCHIVED"],
  LISTED: ["LISTED", "UNLISTED", "SUSPENDED", "SOLD_OUT", "ARCHIVED"],
  UNLISTED: ["UNLISTED", "LISTED", "ARCHIVED"],
  SUSPENDED: ["SUSPENDED", "LISTED", "ARCHIVED"],
  SOLD_OUT: ["SOLD_OUT", "LISTED", "ARCHIVED"],
  ARCHIVED: [],
};

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function requireRole(principal: CataloguePrincipal | null, role: CataloguePrincipal["role"]) {
  if (!principal || !isUuid(principal.accountId)) {
    throw new ApiProblem("UNAUTHENTICATED", 401, "Sign in to continue.");
  }
  if (principal.role !== role) {
    throw new ApiProblem("FORBIDDEN", 403, "This account cannot access the requested catalogue operation.");
  }
  return principal.accountId.toLowerCase();
}

export function missingProduct() {
  return new ApiProblem("NOT_FOUND", 404, "Product not found.");
}

export function missingPhoto() {
  return new ApiProblem("NOT_FOUND", 404, "Photo not found.");
}

export function pathId(value: string, missing: () => ApiProblem) {
  if (!isUuid(value)) throw missing();
  return value.toLowerCase();
}

export function commandKey(command: CatalogueCommand) {
  if (!isUuid(command?.idempotencyKey)) throw new ApiProblem("VALIDATION", 400, "Provide a valid Idempotency-Key.");
  if (!isText(command.requestId, 80)) throw new ApiProblem("VALIDATION", 400, "Provide a valid request ID.");
  return command.idempotencyKey.toLowerCase();
}

export class CatalogueValidationProblem extends ApiProblem {
  readonly fieldErrors: NonNullable<components["schemas"]["Problem"]["fieldErrors"]>;

  constructor(field: string, code: string, message: string) {
    super("VALIDATION", 422, message);
    this.fieldErrors = [{ field, code }];
  }
}

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && !value.includes("\0") && [...value].length <= max;
}

function requiredText(value: unknown, field: string, max: number) {
  if (!isText(value, max)) {
    throw new CatalogueValidationProblem(field, "INVALID_TEXT", `Enter a value for ${field} up to ${max} characters.`);
  }
  return value.trim();
}

export function productCategory(value: string | null | undefined) {
  return value == null ? value : requiredText(value, "category", 80);
}

export function productName(value: unknown) {
  return requiredText(value, "name", 120);
}

function knownStatus(value: unknown): value is Product["status"] {
  return typeof value === "string" && Object.hasOwn(statuses, value);
}

function inIntegerRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function expectedVersion(version: number) {
  if (!inIntegerRange(version, 1, Number.MAX_SAFE_INTEGER)) {
    throw new ApiProblem("VALIDATION", 400, "Provide a valid product version.");
  }
  return version;
}

export function validateUpdate(input: UpdateProduct) {
  const name = productName(input?.name);
  const category = productCategory(input.category);
  if (!knownStatus(input.status)) {
    throw new CatalogueValidationProblem("status", "INVALID_STATUS", "Choose a product status.");
  }
  if (!Array.isArray(input.variants) || input.variants.length > MAX_VARIANTS) {
    throw new CatalogueValidationProblem("variants", "INVALID_COUNT", "Provide at most 100 variants.");
  }
  const variantIds = new Set<string>();
  const variants = input.variants.map((variant, index) => {
    const field = `variants.${index}`;
    const name = requiredText(variant?.name, `${field}.name`, 120);
    const flavour = requiredText(variant.flavour, `${field}.flavour`, 120);
    if (!inIntegerRange(variant.unitMinor, 0, 999_999_999)) {
      throw new CatalogueValidationProblem(`${field}.unitMinor`, "INVALID_PRICE", "Enter the variant price in whole sen.");
    }
    if (!inIntegerRange(variant.prepMinutes, 0, 10_080)) {
      throw new CatalogueValidationProblem(`${field}.prepMinutes`, "INVALID_PREPARATION", "Enter preparation time in whole minutes from 0 to 10080.");
    }
    if (typeof variant.available !== "boolean") {
      throw new CatalogueValidationProblem(`${field}.available`, "INVALID_AVAILABILITY", "Choose whether the variant is available.");
    }
    if (variant.id !== undefined && (!isUuid(variant.id) || variantIds.has(variant.id.toLowerCase()))) {
      throw new CatalogueValidationProblem(`${field}.id`, "INVALID_ID", "Provide each existing variant ID at most once.");
    }
    const id = variant.id?.toLowerCase();
    if (id !== undefined) variantIds.add(id);
    return { id, name, flavour, unitMinor: variant.unitMinor, prepMinutes: variant.prepMinutes, available: variant.available };
  });

  if (!Array.isArray(input.imageRefs) || input.imageRefs.length > 12 || !input.imageRefs.every(isUuid)) {
    throw new CatalogueValidationProblem("imageRefs", "INVALID_GALLERY", "Provide at most 12 valid photo IDs.");
  }
  const imageRefs = input.imageRefs.map((id) => id.toLowerCase());
  if (new Set(imageRefs).size !== imageRefs.length) {
    throw new CatalogueValidationProblem("imageRefs", "DUPLICATE_PHOTO", "Include each photo at most once.");
  }

  if (input.status === "LISTED") {
    if (category === null) throw missingCategory();
    if (!variants.some((variant) => variant.available)) {
      throw new CatalogueValidationProblem("variants", "REQUIRED", "Make at least one variant available before listing.");
    }
  }
  return { name, category, status: input.status, variants, imageRefs };
}

export function missingCategory() {
  return new CatalogueValidationProblem("category", "REQUIRED", "Choose a category before listing.");
}

export function requireTransition(current: Product["status"], next: Product["status"]) {
  if (!statuses[current].includes(next)) {
    throw new ApiProblem("INVALID_TRANSITION", 409, "This product cannot move to the selected status.");
  }
}

export function pageBounds(input: { limit?: number; cursor?: string }, scope: unknown) {
  const limit = input.limit ?? 25;
  if (!inIntegerRange(limit, 1, 100)) {
    throw new ApiProblem("VALIDATION", 400, "Choose a page limit between 1 and 100.");
  }
  const prefix = createHash("sha256").update(JSON.stringify(scope)).digest("hex") + ":";
  function encodeCursor(id: string) {
    return Buffer.from(prefix + id).toString("base64url");
  }
  if (input.cursor === undefined) return { limit, after: null, encodeCursor };
  if (typeof input.cursor !== "string" || input.cursor.length > 500) {
    throw new ApiProblem("VALIDATION", 400, "Use a valid cursor for this catalogue filter.");
  }
  const decoded = Buffer.from(input.cursor, "base64url").toString("utf8");
  const after = decoded.slice(prefix.length);
  if (!decoded.startsWith(prefix) || !isUuid(after) || encodeCursor(after) !== input.cursor) {
    throw new ApiProblem("VALIDATION", 400, "Use a valid cursor for this catalogue filter.");
  }
  return { limit, after, encodeCursor };
}

export function catalogueFilter(category: string | undefined) {
  if (category === undefined) return null;
  if (!isText(category, 80)) throw new ApiProblem("VALIDATION", 400, "Use a category between 1 and 80 characters.");
  return category.trim();
}

export function merchantFilter(status: Product["status"] | undefined) {
  if (status === undefined) return null;
  if (!knownStatus(status)) throw new ApiProblem("VALIDATION", 400, "Choose a valid product status.");
  return status;
}

function hasSignature(bytes: Uint8Array, signature: readonly number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

export function validatePhoto(bytes: Uint8Array, declaredType: string): PhotoMediaType {
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new ApiProblem("PAYLOAD_TOO_LARGE", 413, "Choose a photo no larger than 5 MiB.");
  }
  if (declaredType === "image/jpeg" && hasSignature(bytes, [0xff, 0xd8, 0xff])) return declaredType;
  if (declaredType === "image/png" && hasSignature(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return declaredType;
  if (declaredType === "image/webp" && hasSignature(bytes, [82, 73, 70, 70]) && hasSignature(bytes, [87, 69, 66, 80], 8)) {
    return declaredType;
  }
  throw unreadablePhoto();
}

export function unreadablePhoto() {
  return new ApiProblem("UNSUPPORTED_MEDIA", 415, "Choose a valid JPEG, PNG or WebP photo.");
}
