import { createHash, randomUUID } from "node:crypto";
import { type Queryable, type TransactionPool, withTransaction } from "../db";
import { ApiProblem } from "../http/problem";
import {
  CatalogueValidationProblem,
  catalogueFilter,
  commandKey,
  expectedVersion,
  MAX_VARIANTS,
  merchantFilter,
  missingCategory,
  missingPhoto,
  missingProduct,
  pageBounds,
  pathId,
  productCategory,
  productName,
  requireRole,
  requireTransition,
  unreadablePhoto,
  validatePhoto,
  validateUpdate,
  type CatalogueCommand,
  type CataloguePrincipal,
  type CreateProduct,
  type PhotoMediaType,
  type Product,
  type ProductMedia,
  type UpdateProduct,
} from "./policy";

export { CatalogueValidationProblem, MAX_PHOTO_BYTES } from "./policy";
export type { CatalogueCommand, CataloguePrincipal, CreateProduct, PhotoMediaType, Product, ProductMedia, UpdateProduct } from "./policy";

export interface CatalogueObjectStore {
  /** Durably create a private immutable object at a service-generated key. */
  put(key: string, bytes: Uint8Array, mediaType: PhotoMediaType): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

/** Fully decode with bounded resources, returning safe bytes in the same format or null for invalid images. */
export type DecodeCataloguePhoto = (bytes: Uint8Array, mediaType: PhotoMediaType) => Promise<Uint8Array | null>;

export type CataloguePhoto = { bytes: Uint8Array; mediaType: PhotoMediaType };

type Database = Queryable & TransactionPool;
type Principal = CataloguePrincipal | null;
type ProductPage = { items: Product[]; nextCursor: string | null };
type Page = { limit?: number; cursor?: string };
type ProductRow = Omit<Product, "version"> & { version: string };
type ProductState = Pick<ProductRow, "status" | "category" | "version">;
type PhotoRow = { object_key: string; media_type: PhotoMediaType; byte_count: number; content_digest: Buffer };
type CommandIdentity = { actorId: string; operation: string; key: string; digest: Buffer };

const sellable = `
  p.status = 'LISTED' AND p.category IS NOT NULL
  AND EXISTS (SELECT 1 FROM variant eligible WHERE eligible.product_id = p.id AND eligible.available)
`;

const projection = `
  SELECT p.id, p.name, p.category, p.status, p.version::text AS version,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', v.id, 'productId', v.product_id, 'name', v.name, 'flavour', v.flavour,
        'unitMinor', v.unit_minor, 'prepMinutes', v.prep_minutes, 'available', v.available
      ) ORDER BY v.id)
      FROM variant v
      WHERE v.product_id = p.id AND (NOT $1::boolean OR v.available)
    ), '[]'::jsonb) AS variants,
    COALESCE((
      SELECT jsonb_agg(g.media_id ORDER BY g.ordinal)
      FROM product_gallery g
      JOIN product_media m ON m.product_id = g.product_id AND m.id = g.media_id
      WHERE g.product_id = p.id AND m.lifecycle = 'ATTACHED'
    ), '[]'::jsonb) AS "imageRefs"
  FROM product p
`;

function asProduct(row: ProductRow): Product {
  const version = Number(row.version);
  if (!Number.isSafeInteger(version)) throw new Error("Product version exceeds the supported range.");
  return { ...row, version };
}

function digest(bytes: string | Uint8Array) {
  return createHash("sha256").update(bytes).digest();
}

function identifyCommand(actorId: string, operation: string, command: CatalogueCommand, input: unknown): CommandIdentity {
  return { actorId, operation, key: commandKey(command), digest: digest(JSON.stringify(input)) };
}

async function receipt<T>(database: Queryable, identity: CommandIdentity) {
  const { rows: [row] } = await database.query<{ request_digest: Buffer; result_reference: T }>(`
    SELECT request_digest, result_reference FROM command_receipt
    WHERE actor_id = $1 AND operation = $2 AND idem_key = $3
  `, [identity.actorId, identity.operation, identity.key]);
  if (row && !row.request_digest.equals(identity.digest)) {
    throw new ApiProblem("IDEMPOTENCY_CONFLICT", 409, "This key was already used for a different catalogue command.");
  }
  return row?.result_reference;
}

async function audit(
  client: Queryable,
  identity: CommandIdentity,
  productId: string,
  requestId: string,
  change: object,
) {
  await client.query(`
    INSERT INTO audit_event (id, actor_id, feature, resource_id, action, occurred_at, request_id, safe_change)
    VALUES ($1, $2, 'F02', $3, $4, now(), $5, $6)
  `, [randomUUID(), identity.actorId, productId, identity.operation, requestId, change]);
}

async function productState(client: Queryable, id: string) {
  const { rows: [row] } = await client.query<ProductState>(`
    SELECT status, category, version::text AS version FROM product WHERE id = $1 FOR UPDATE
  `, [id]);
  if (!row) throw missingProduct();
  return row;
}

async function readProduct(database: Queryable, id: string, storefront: boolean) {
  const { rows: [row] } = await database.query<ProductRow>(`
    ${projection}
    WHERE p.id = $2 AND (NOT $1::boolean OR (${sellable}))
  `, [storefront, id]);
  if (!row) throw missingProduct();
  return asProduct(row);
}

async function saveVariants(client: Queryable, productId: string, variants: ReturnType<typeof validateUpdate>["variants"]) {
  const { rows } = await client.query<{ id: string }>("SELECT id FROM variant WHERE product_id = $1", [productId]);
  const existing = new Set(rows.map((row) => row.id));
  const toSave = variants.map((variant) => {
    if (variant.id !== undefined && !existing.has(variant.id)) {
      throw new ApiProblem("NOT_FOUND", 404, "Variant not found.");
    }
    return { ...variant, id: variant.id ?? randomUUID() };
  });
  // Historical orders and carts may still reference omitted variants. Keep their IDs and disable them.
  if (existing.size + toSave.filter((variant) => !existing.has(variant.id)).length > MAX_VARIANTS) {
    throw new CatalogueValidationProblem("variants", "INVALID_COUNT", "A product can have at most 100 variants. Reuse existing variants.");
  }
  await client.query(`
    UPDATE variant SET available = false
    WHERE product_id = $1 AND available AND NOT (id = ANY($2::uuid[]))
  `, [productId, toSave.map((variant) => variant.id)]);
  if (toSave.length === 0) return;
  await client.query(`
    INSERT INTO variant (id, product_id, name, flavour, available, unit_minor, prep_minutes)
    SELECT v.id, $1, v.name, v.flavour, v.available, v."unitMinor", v."prepMinutes"
    FROM jsonb_to_recordset($2::jsonb) AS v(
      id uuid, name text, flavour text, available boolean, "unitMinor" bigint, "prepMinutes" integer
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, flavour = EXCLUDED.flavour, available = EXCLUDED.available,
      unit_minor = EXCLUDED.unit_minor, prep_minutes = EXCLUDED.prep_minutes
    WHERE variant.product_id = EXCLUDED.product_id
  `, [productId, JSON.stringify(toSave)]);
}

async function saveGallery(client: Queryable, productId: string, imageRefs: string[]) {
  const { rowCount } = await client.query(`
    SELECT id FROM product_media
    WHERE product_id = $1 AND id = ANY($2::uuid[]) AND lifecycle IN ('STAGED', 'ATTACHED')
    ORDER BY id FOR UPDATE
  `, [productId, imageRefs]);
  if (rowCount !== imageRefs.length) throw missingPhoto();
  await client.query("DELETE FROM product_gallery WHERE product_id = $1", [productId]);
  await client.query(`
    UPDATE product_media SET lifecycle = 'RETIRED', retired_at = now()
    WHERE product_id = $1 AND lifecycle = 'ATTACHED' AND NOT (id = ANY($2::uuid[]))
  `, [productId, imageRefs]);
  await client.query(`
    UPDATE product_media SET lifecycle = 'ATTACHED'
    WHERE product_id = $1 AND lifecycle = 'STAGED' AND id = ANY($2::uuid[])
  `, [productId, imageRefs]);
  await client.query(`
    INSERT INTO product_gallery (product_id, ordinal, media_id)
    SELECT $1, position::integer, id FROM unnest($2::uuid[]) WITH ORDINALITY AS image(id, position)
  `, [productId, imageRefs]);
}

function storageUnavailable() {
  return new ApiProblem("DEPENDENCY_UNAVAILABLE", 503, "Photo storage is temporarily unavailable.");
}

function requirePhotoStaging(status: Product["status"]) {
  if (status === "ARCHIVED") {
    throw new ApiProblem("INVALID_TRANSITION", 409, "Archived products cannot stage new photos.");
  }
}

export class CatalogueService {
  constructor(
    private readonly pool: Database,
    private readonly objects: CatalogueObjectStore,
    private readonly decodePhoto: DecodeCataloguePhoto,
  ) {}

  async listCatalog(principal: Principal, input: Page & { category?: string } = {}): Promise<ProductPage> {
    requireRole(principal, "CUSTOMER");
    return this.listProducts(true, catalogueFilter(input.category), input);
  }

  async listMerchantProducts(principal: Principal, input: Page & { status?: Product["status"] } = {}): Promise<ProductPage> {
    requireRole(principal, "ADMIN");
    return this.listProducts(false, merchantFilter(input.status), input);
  }

  async getListedProduct(principal: Principal, id: string): Promise<Product> {
    requireRole(principal, "CUSTOMER");
    return readProduct(this.pool, pathId(id, missingProduct), true);
  }

  async getMerchantProduct(principal: Principal, id: string): Promise<Product> {
    requireRole(principal, "ADMIN");
    return readProduct(this.pool, pathId(id, missingProduct), false);
  }

  async createProduct(principal: Principal, input: CreateProduct, command: CatalogueCommand): Promise<Product> {
    const actorId = requireRole(principal, "ADMIN");
    const name = productName(input?.name);
    const category = productCategory(input.category) ?? null;
    const identity = identifyCommand(actorId, "createProduct", command, { name, category });
    return this.runCommand<Product>(identity, async (client) => {
      const id = randomUUID();
      await client.query("INSERT INTO product (id, name, category, status) VALUES ($1, $2, $3, 'DRAFT')", [id, name, category]);
      const product = await readProduct(client, id, false);
      await audit(client, identity, id, command.requestId, { status: product.status, version: product.version });
      return product;
    });
  }

  async updateProduct(
    principal: Principal, id: string, version: number, input: UpdateProduct, command: CatalogueCommand,
  ): Promise<Product> {
    const actorId = requireRole(principal, "ADMIN");
    const productId = pathId(id, missingProduct);
    const expected = expectedVersion(version);
    const edit = validateUpdate(input);
    const identity = identifyCommand(actorId, "updateProduct", command, { productId, expected, edit });
    return this.runCommand<Product>(identity, async (client) => {
      const before = await productState(client, productId);
      if (before.version !== String(expected)) {
        throw new ApiProblem("VERSION_CONFLICT", 409, "This product changed. Refresh before saving.");
      }
      requireTransition(before.status, edit.status);
      const category = edit.category === undefined ? before.category : edit.category;
      if (edit.status === "LISTED" && category === null) throw missingCategory();
      await saveVariants(client, productId, edit.variants);
      await saveGallery(client, productId, edit.imageRefs);
      await client.query(`
        UPDATE product SET name = $2, category = $3, status = $4, version = version + 1 WHERE id = $1
      `, [productId, edit.name, category, edit.status]);
      const product = await readProduct(client, productId, false);
      await audit(client, identity, productId, command.requestId, {
        previousStatus: before.status, status: product.status, version: product.version, photoCount: product.imageRefs.length,
      });
      return product;
    });
  }

  async uploadProductPhoto(
    principal: Principal, id: string, declaredType: string, bytes: Uint8Array, command: CatalogueCommand,
  ): Promise<ProductMedia> {
    const actorId = requireRole(principal, "ADMIN");
    const productId = pathId(id, missingProduct);
    const mediaType = validatePhoto(bytes, declaredType);
    const original = Buffer.from(bytes);
    const identity = identifyCommand(actorId, "uploadProductPhoto", command, {
      productId, mediaType, byteDigest: digest(original).toString("hex"),
    });
    const replay = await receipt<ProductMedia>(this.pool, identity);
    if (replay) return replay;

    const { rows: [product] } = await this.pool.query<{ status: Product["status"] }>(
      "SELECT status FROM product WHERE id = $1", [productId],
    );
    if (!product) throw missingProduct();
    requirePhotoStaging(product.status);

    let decoded: Uint8Array | null;
    try {
      decoded = await this.decodePhoto(original, mediaType);
    } catch {
      throw new ApiProblem("DEPENDENCY_UNAVAILABLE", 503, "Photo processing is temporarily unavailable.");
    }
    if (!decoded) throw unreadablePhoto();
    validatePhoto(decoded, mediaType);
    const normalized = Buffer.from(decoded);
    const mediaId = randomUUID();
    const objectKey = `catalogue/${productId}/${mediaId}`;
    const contentDigest = digest(normalized);
    try {
      await this.objects.put(objectKey, normalized, mediaType);
    } catch {
      throw storageUnavailable();
    }

    // An unlinked object after a failed or competing command belongs to storage reconciliation.
    return this.runCommand<ProductMedia>(identity, async (client) => {
      const current = await productState(client, productId);
      requirePhotoStaging(current.status);
      const { rows: [row] } = await client.query<{ created_at: Date }>(`
        INSERT INTO product_media (id, product_id, object_key, content_digest, byte_count, media_type, lifecycle, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'STAGED', now()) RETURNING created_at
      `, [mediaId, productId, objectKey, contentDigest, normalized.byteLength, mediaType]);
      await audit(client, identity, productId, command.requestId, { mediaId, state: "STAGED" });
      return {
        id: mediaId, productId, state: "STAGED", byteCount: normalized.byteLength, mediaType,
        createdAt: row.created_at.toISOString(),
      };
    });
  }

  async getMerchantProductPhoto(principal: Principal, productId: string, mediaId: string): Promise<CataloguePhoto> {
    requireRole(principal, "ADMIN");
    const { rows: [row] } = await this.pool.query<PhotoRow>(`
      SELECT object_key, media_type, byte_count, content_digest FROM product_media
      WHERE product_id = $1 AND id = $2 AND lifecycle IN ('STAGED', 'ATTACHED')
    `, [pathId(productId, missingPhoto), pathId(mediaId, missingPhoto)]);
    return this.readPhoto(row);
  }

  async getListedProductPhoto(principal: Principal, mediaId: string): Promise<CataloguePhoto> {
    requireRole(principal, "CUSTOMER");
    const { rows: [row] } = await this.pool.query<PhotoRow>(`
      SELECT m.object_key, m.media_type, m.byte_count, m.content_digest
      FROM product_media m
      JOIN product_gallery g ON g.product_id = m.product_id AND g.media_id = m.id
      JOIN product p ON p.id = g.product_id
      WHERE m.id = $1 AND m.lifecycle = 'ATTACHED' AND (${sellable})
    `, [pathId(mediaId, missingPhoto)]);
    return this.readPhoto(row);
  }

  private async listProducts(storefront: boolean, filter: string | null, input: Page): Promise<ProductPage> {
    const { limit, after, encodeCursor } = pageBounds(input, { storefront, filter });
    const filterColumn = storefront ? "p.category" : "p.status";
    const { rows } = await this.pool.query<ProductRow>(`
      ${projection}
      WHERE (NOT $1::boolean OR (${sellable}))
        AND ($2::uuid IS NULL OR p.id > $2)
        AND ($3::text IS NULL OR ${filterColumn} = $3)
      ORDER BY p.id
      LIMIT $4
    `, [storefront, after, filter, limit + 1]);
    const items = rows.slice(0, limit).map(asProduct);
    return { items, nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1].id) : null };
  }

  private runCommand<T>(identity: CommandIdentity, work: (client: Queryable) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, async (client) => {
      const lockKey = `catalogue:${identity.actorId}:${identity.operation}:${identity.key}`;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
      const replay = await receipt<T>(client, identity);
      if (replay !== undefined) return replay;
      const result = await work(client);
      await client.query(`
        INSERT INTO command_receipt (actor_id, operation, idem_key, request_digest, result_reference, created_at)
        VALUES ($1, $2, $3, $4, $5, now())
      `, [identity.actorId, identity.operation, identity.key, identity.digest, result]);
      return result;
    });
  }

  private async readPhoto(row: PhotoRow | undefined): Promise<CataloguePhoto> {
    if (!row) throw missingPhoto();
    let bytes: Uint8Array | null;
    try {
      bytes = await this.objects.get(row.object_key);
    } catch {
      throw storageUnavailable();
    }
    if (!bytes || bytes.byteLength !== row.byte_count || !digest(bytes).equals(row.content_digest)) {
      throw storageUnavailable();
    }
    return { bytes, mediaType: row.media_type };
  }
}
