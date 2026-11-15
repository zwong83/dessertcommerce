import { createHash, randomUUID } from "node:crypto";
import type { components } from "../../../frontend/contracts/standard-v1";
import { type Queryable, type TransactionPool, withTransaction } from "../db";
import { ApiProblem } from "../http/problem";

type Cart = components["schemas"]["Cart"];
type Principal = Pick<components["schemas"]["Session"], "accountId" | "role">;
type Database = Queryable & TransactionPool;

interface CartRow {
  version: string;
  variant_id: string | null;
  quantity: number | null;
  product: string | null;
  variant: string | null;
  unit_minor: string | null;
  available: boolean | null;
}

function customer(principal: Principal) {
  if (principal.role !== "CUSTOMER") throw new ApiProblem("FORBIDDEN", 403, "Use a customer account for the cart.");
  return principal.accountId;
}

async function ownedCart(db: Queryable, accountId: string): Promise<Cart> {
  const { rows } = await db.query<CartRow>(
    `SELECT c.version, l.variant_id, l.quantity, p.name AS product, v.name AS variant, v.unit_minor,
       (v.available AND p.status = 'LISTED') AS available
     FROM cart c LEFT JOIN cart_line l ON l.account_id = c.account_id
     LEFT JOIN variant v ON v.id = l.variant_id LEFT JOIN product p ON p.id = v.product_id
     WHERE c.account_id = $1 ORDER BY l.id LIMIT 100`,
    [accountId],
  );
  const lines: Cart["lines"] = [];
  for (const row of rows) {
    if (row.variant_id === null || row.quantity === null || row.product === null
        || row.variant === null || row.unit_minor === null || row.available === null) continue;
    lines.push({
      variantId: row.variant_id,
      quantity: row.quantity,
      product: row.product,
      variant: row.variant,
      unitMinor: Number(row.unit_minor),
      available: row.available,
    });
  }
  return {
    version: Number(rows[0]?.version ?? "1"),
    lines,
    referenceSubtotalMinor: lines.reduce((subtotal, line) => subtotal + line.unitMinor * line.quantity, 0),
  };
}

export function createCart(db: Database) {
  return {
    get(principal: Principal) {
      return ownedCart(db, customer(principal));
    },
    async setQuantity(principal: Principal, input: {
      variantId: string;
      quantity: number;
      expectedVersion: string;
      idempotencyKey: string;
    }) {
      const accountId = customer(principal);
      if (!Number.isInteger(input.quantity) || input.quantity < 0 || input.quantity > 999) {
        throw new ApiProblem("VALIDATION", 422, "Enter a quantity from 0 to 999.");
      }
      const variantId = input.variantId.toLowerCase();
      const digest = createHash("sha256").update(JSON.stringify([variantId, input.quantity, input.expectedVersion])).digest();

      return withTransaction(db, async (tx) => {
        await tx.query("INSERT INTO cart (account_id) VALUES ($1) ON CONFLICT DO NOTHING", [accountId]);
        const { rows: [cart] } = await tx.query<{ version: string }>(
          "SELECT version FROM cart WHERE account_id = $1 FOR UPDATE", [accountId],
        );
        const { rows: [receipt] } = await tx.query<{ request_digest: Buffer; result_reference: Cart }>(
          "SELECT request_digest, result_reference FROM command_receipt WHERE actor_id = $1 AND operation = 'setCartQuantity' AND idem_key = $2",
          [accountId, input.idempotencyKey],
        );
        if (receipt) {
          if (!receipt.request_digest.equals(digest)) throw new ApiProblem("IDEMPOTENCY_CONFLICT", 409, "Use a new request for a different cart edit.");
          return receipt.result_reference;
        }
        if (cart.version !== input.expectedVersion) throw new ApiProblem("VERSION_CONFLICT", 409, "Refresh the cart before changing it.");

        if (input.quantity === 0) {
          await tx.query("DELETE FROM cart_line WHERE account_id = $1 AND variant_id = $2", [accountId, variantId]);
        } else {
          const { rows: [variant] } = await tx.query<{ available: boolean }>(
            "SELECT (v.available AND p.status = 'LISTED') AS available FROM variant v JOIN product p ON p.id = v.product_id WHERE v.id = $1 FOR SHARE OF v,p",
            [variantId],
          );
          if (!variant?.available) throw new ApiProblem("VALIDATION", 422, "This selection is no longer available.");
          const { rows: [limit] } = await tx.query<{ full: boolean }>(
            "SELECT count(*) FILTER (WHERE variant_id <> $2) >= 100 AS full FROM cart_line WHERE account_id = $1",
            [accountId, variantId],
          );
          if (limit.full) throw new ApiProblem("VALIDATION", 422, "A cart can contain up to 100 selections.");
          await tx.query(
            "INSERT INTO cart_line (id, account_id, variant_id, quantity) VALUES ($1,$2,$3,$4) " +
            "ON CONFLICT (account_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity",
            [randomUUID(), accountId, variantId, input.quantity],
          );
        }

        await tx.query("UPDATE cart SET version = version + 1, updated_at = clock_timestamp() WHERE account_id = $1", [accountId]);
        const result = await ownedCart(tx, accountId);
        await tx.query(
          "INSERT INTO command_receipt (actor_id, operation, idem_key, request_digest, result_reference, created_at) VALUES ($1,'setCartQuantity',$2,$3,$4,clock_timestamp())",
          [accountId, input.idempotencyKey, digest, result],
        );
        return result;
      });
    },
  };
}

export type CartService = ReturnType<typeof createCart>;
