import type { CatalogueService, CreateProduct, Product, UpdateProduct } from "./index";
import { MAX_PHOTO_BYTES } from "./index";
import { ApiProblem, validation } from "../http/problem";
import { fieldUuid, readObject, requestCookie, requireSameOrigin, sessionCookieName } from "../http/request";
import type { Identity } from "../identity/service";

async function imageBytes(request: Request) {
  const media = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (media !== "application/octet-stream") {
    throw new ApiProblem("UNSUPPORTED_MEDIA", 415, "Upload the photo as binary data.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw validation("Choose a photo.");
  const buffers: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PHOTO_BYTES) {
        await reader.cancel();
        throw new ApiProblem("PAYLOAD_TOO_LARGE", 413, "Photo must be at most 5 MiB.");
      }
      buffers.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(buffers);
}

const productStatuses = ["DRAFT", "LISTED", "UNLISTED", "SUSPENDED", "SOLD_OUT", "ARCHIVED"] as const;

export function catalogueRoutes(catalogue: CatalogueService, identity: Identity, origin: string) {
  return async function handle(request: Request, path: string, requestId: string): Promise<Response | undefined> {
    const parts = path.split("/");
    const [prefix, segment, id, sub, mediaId] = parts;
    const merchant = prefix === "admin" && segment === "products";
    const storefront = prefix === "catalog" && (parts.length === 1 || segment === "products" || segment === "media");
    if (!merchant && !storefront) return undefined;

    const method = request.method;
    if (method !== "GET" && (!merchant || (method !== "POST" && method !== "PUT"))) return undefined;
    if (method !== "GET") requireSameOrigin(request, origin);
    const actor = await identity.getSession(
      requestCookie(request, sessionCookieName), merchant ? "ADMIN" : "CUSTOMER",
      method === "GET" ? undefined : request.headers.get("x-csrf-token"),
    );
    const query = new URL(request.url).searchParams;
    const limit = query.has("limit") ? Number(query.get("limit")) : undefined;
    const cursor = query.get("cursor") ?? undefined;

    if (method === "GET") {
      if (storefront && parts.length === 1) {
        return Response.json(await catalogue.listCatalog(actor, { limit, cursor, category: query.get("category") ?? undefined }));
      }
      if (merchant && parts.length === 2) {
        const status = query.get("status");
        if (status !== null && !productStatuses.some((value) => value === status)) throw validation("Choose a product status.");
        return Response.json(await catalogue.listMerchantProducts(actor, { limit, cursor, status: (status ?? undefined) as Product["status"] | undefined }));
      }
      if (id && parts.length === 3 && segment === "products") {
        const product = merchant ? await catalogue.getMerchantProduct(actor, id) : await catalogue.getListedProduct(actor, id);
        return Response.json(product);
      }
      if (id && ((merchant && sub === "media" && mediaId && parts.length === 5) || (storefront && segment === "media" && parts.length === 3))) {
        const photo = merchant ? await catalogue.getMerchantProductPhoto(actor, id, mediaId) : await catalogue.getListedProductPhoto(actor, id);
        return new Response(Uint8Array.from(photo.bytes), { headers: { "Content-Type": photo.mediaType, "X-Content-Type-Options": "nosniff" } });
      }
      return undefined;
    }

    const command = { idempotencyKey: fieldUuid(request.headers.get("idempotency-key"), "the request key"), requestId };
    if (method === "POST" && parts.length === 2) {
      const body = await readObject(request, ["name", "category"]);
      const product = await catalogue.createProduct(actor, body as unknown as CreateProduct, command);
      return Response.json(product, { status: 201 });
    }
    if (method === "PUT" && id && parts.length === 3) {
      const version = /^"([1-9]\d*)"$/.exec(request.headers.get("if-match") ?? "");
      if (!version || !Number.isSafeInteger(Number(version[1]))) throw validation("Refresh the product version.");
      const body = await readObject(request, ["name", "status", "variants", "imageRefs", "category"], 96_000);
      return Response.json(await catalogue.updateProduct(actor, id, Number(version[1]), body as unknown as UpdateProduct, command));
    }
    if (method === "POST" && id && sub === "media" && parts.length === 4) {
      const bytes = await imageBytes(request);
      const photo = await catalogue.uploadProductPhoto(actor, id, request.headers.get("x-file-media-type") ?? "", bytes, command);
      return Response.json(photo, { status: 201 });
    }
  };
}
