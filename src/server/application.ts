import { createHmac } from "node:crypto";
import { Pool } from "pg";
import sharp from "sharp";
import { capacityRoutes, createCapacity } from "./capacity";
import { cartRoutes } from "./cart/routes";
import { createCart } from "./cart/service";
import { CatalogueService } from "./catalogue";
import { catalogueRoutes } from "./catalogue/routes";
import { ApiProblem } from "./http/problem";
import { identityRoutes } from "./identity/routes";
import { createIdentity } from "./identity/service";
import { createOrderService, orderRoutes } from "./order";
import { localPrivateStore } from "./storage/local-private";

const unavailable = () => new ApiProblem("DEPENDENCY_UNAVAILABLE", 503, "The ordering service is temporarily unavailable.");

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw unavailable();
  return parsed;
}

function appOrigin() {
  const origin = process.env.SWEETCOMMERCE_ORIGIN ?? "http://127.0.0.1:3000";
  try {
    const parsed = new URL(origin);
    const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (parsed.origin !== origin || (parsed.protocol !== "https:" && !loopback)) throw unavailable();
    return { origin, loopback };
  } catch {
    throw unavailable();
  }
}

let application: ReturnType<typeof createApplication> | undefined;

function createApplication() {
  const databaseUrl = process.env.DATABASE_URL;
  const secret = process.env.SWEETCOMMERCE_IDENTITY_KEY;
  if (!databaseUrl || !secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw unavailable();

  const { origin, loopback } = appOrigin();
  const syntheticCode = process.env.SWEETCOMMERCE_SYNTHETIC_OTP;
  const useSynthetic = process.env.NODE_ENV !== "production"
    && loopback
    && process.env.SWEETCOMMERCE_OTP_MODE === "synthetic"
    && typeof syntheticCode === "string"
    && /^\d{6}$/.test(syntheticCode);

  const pool = new Pool({
    connectionString: databaseUrl,
    options: "-c search_path=sweetcommerce",
    max: positiveNumber(process.env.SWEETCOMMERCE_DB_POOL, 8),
    connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000,
  });
  pool.on("error", () => {
    process.stderr.write(JSON.stringify({ feature: "persistence", action: "idle-connection", outcome: "failed" }) + "\n");
  });

  const identity = createIdentity({
    pool,
    secret: Buffer.from(secret, "base64url"),
    delivery: {
      async deliver() {
        if (!useSynthetic) throw unavailable();
      },
    },
    newCode: useSynthetic ? () => syntheticCode : undefined,
    sessionTtlMs: 8 * 60 * 60 * 1000,
    globalSendLimit: positiveNumber(process.env.SWEETCOMMERCE_OTP_SEND_BUDGET, 250),
  });

  const privateKey = createHmac("sha256", Buffer.from(secret, "base64url")).update("local-private-v1").digest();
  const localStore = localPrivateStore(".cache/private-objects", privateKey);
  const objects = loopback && process.env.NODE_ENV !== "production" ? localStore : {
    async put(): Promise<never> { throw unavailable(); },
    async get(): Promise<never> { throw unavailable(); },
  };
  const catalogue = new CatalogueService(pool, objects, async (bytes, media) => {
    try {
      const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: "error" });
      const format = media === "image/jpeg" ? "jpeg" : media === "image/png" ? "png" : "webp";
      const metadata = await image.metadata();
      if (metadata.format !== format || (metadata.pages ?? 1) !== 1) return null;
      return await image.rotate().toFormat(format).toBuffer();
    } catch {
      return null;
    }
  });

  const handleIdentity = identityRoutes(identity, origin);
  const cart = createCart(pool);
  const handleCart = cartRoutes(cart, identity, origin);
  const handleCatalogue = catalogueRoutes(catalogue, identity, origin);
  const capacity = createCapacity({
    pool,
    impactKey: createHmac("sha256", Buffer.from(secret, "base64url")).update("capacity-impact-v1").digest(),
  });
  const handleCapacity = capacityRoutes(capacity, identity, origin);
  const order = createOrderService({
    pool,
    terms() {
      const version = process.env.SWEETCOMMERCE_TERMS_VERSION;
      const text = process.env.SWEETCOMMERCE_TERMS_TEXT;
      if (version && text) return { version, text };
      if (useSynthetic) return { version: "synthetic-v1", text: "Synthetic ordering terms for this local demonstration." };
      throw unavailable();
    },
    pickupDisplay() {
      const configured = process.env.SWEETCOMMERCE_PICKUP_DISPLAY;
      if (configured) return configured;
      if (useSynthetic) return "Sample pickup point (local demonstration)";
      throw unavailable();
    },
    reviewTtlMs: 10 * 60 * 1000,
    duitNowQrUrl: process.env.SWEETCOMMERCE_DUITNOW_QR_URL,
  });
  const handleOrder = orderRoutes(order, identity, origin);
  return {
    async handle(request: Request, path: string, requestId: string) {
      return await handleIdentity(request, path)
        ?? await handleCart(request, path)
        ?? await handleCatalogue(request, path, requestId)
        ?? await handleCapacity(request, path, requestId)
        ?? await handleOrder(request, path, requestId);
    },
    identity, catalogue, cart, capacity, order, pool, origin,
  };
}

export function getApplication() {
  application ??= createApplication();
  return application;
}
