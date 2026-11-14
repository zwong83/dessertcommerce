import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Queryable } from "../db";
import { ApiProblem, validation } from "../http/problem";
import { uuid } from "./store";

export type CapacityActor = { accountId: string; role: "CUSTOMER" | "ADMIN" };
export type CapacityCommand = { idempotencyKey: string; requestId: string };

export function requireRole(actor: CapacityActor | null | undefined, role: CapacityActor["role"]): string {
  if (!actor) throw new ApiProblem("UNAUTHENTICATED", 401, "Sign in to continue.");
  if (actor.role !== role) throw new ApiProblem("FORBIDDEN", 403, "This action requires a different account role.");
  return uuid(actor.accountId);
}

export function conflict() {
  return new ApiProblem("VERSION_CONFLICT", 409, "Refresh and review the current capacity before saving.");
}

export async function command<T>(
  tx: Queryable, actor: string, operation: string, context: CapacityCommand, intent: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const key = uuid(context.idempotencyKey);
  const digest = createHash("sha256").update(JSON.stringify(intent)).digest();
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${actor}:${operation}:${key}`]);
  const { rows: [existing] } = await tx.query<{ request_digest: Buffer; result_reference: T }>(
    "SELECT request_digest, result_reference FROM command_receipt WHERE actor_id = $1 AND operation = $2 AND idem_key = $3",
    [actor, operation, key],
  );
  if (existing) {
    if (!digest.equals(existing.request_digest)) {
      throw new ApiProblem("IDEMPOTENCY_CONFLICT", 409, "Use a new key for a different request.");
    }
    return existing.result_reference;
  }

  const result = await run();
  await tx.query(
    `INSERT INTO command_receipt (actor_id, operation, idem_key, request_digest, result_reference, created_at)
     VALUES ($1, $2, $3, $4, $5, clock_timestamp())`,
    [actor, operation, key, digest, JSON.stringify(result)],
  );
  return result;
}

export async function audit(
  tx: Queryable, actor: string, action: string, resource: string, context: CapacityCommand, change: object,
): Promise<void> {
  await tx.query(
    `INSERT INTO audit_event (id, actor_id, feature, resource_id, action, occurred_at, request_id, safe_change)
     VALUES ($1, $2, 'CAPACITY', $3, $4, clock_timestamp(), $5, $6)`,
    [randomUUID(), actor, resource, action, context.requestId, JSON.stringify(change)],
  );
}

export function createImpactSigner(secret: Uint8Array) {
  if (secret.byteLength < 32) throw new Error("Capacity impact signing requires a key of at least 32 bytes.");
  const key = Buffer.from(secret);
  const sign = (payload: string, binding: unknown) =>
    createHmac("sha256", key).update(JSON.stringify([binding, payload])).digest("base64url");

  return {
    encode(value: unknown, binding: unknown): string {
      const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
      return `${payload}.${sign(payload, binding)}`;
    },
    decode(token: string, binding: unknown): unknown {
      if (typeof token !== "string" || token.length > 600 || !/^[\w-]+\.[\w-]{43}$/.test(token)) return undefined;
      const [payload, signature] = token.split(".");
      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload, binding)))) return undefined;
      try {
        return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      } catch {
        throw validation("Invalid capacity preview value.");
      }
    },
  };
}
