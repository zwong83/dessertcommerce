import { validation } from "../http/problem";
import { fieldUuid, readObject, requestCookie, requireSameOrigin, sessionCookieName } from "../http/request";
import type { Identity } from "../identity/service";
import type { CartService } from "./service";

export function cartRoutes(cart: CartService, identity: Identity, origin: string) {
  return async function handle(request: Request, path: string): Promise<Response | undefined> {
    if (request.method === "GET" && path === "cart") {
      const principal = await identity.getSession(requestCookie(request, sessionCookieName), "CUSTOMER");
      return Response.json(await cart.get(principal));
    }
    const item = /^cart\/items\/([^/]+)$/.exec(path);
    if (request.method !== "PUT" || !item) return undefined;
    requireSameOrigin(request, origin);
    const principal = await identity.getSession(requestCookie(request, sessionCookieName), "CUSTOMER", request.headers.get("x-csrf-token"));
    const body = await readObject(request, ["quantity"]);
    if (typeof body.quantity !== "number") throw validation("Enter a quantity from 0 to 999.");
    const variantId = fieldUuid(item[1], "the selected variant");
    const idempotencyKey = fieldUuid(request.headers.get("idempotency-key"), "the request key");
    const version = /^"([1-9]\d{0,17})"$/.exec(request.headers.get("if-match") ?? "");
    if (!version) throw validation("Refresh the cart version.");
    return Response.json(await cart.setQuantity(principal, { variantId, quantity: body.quantity, idempotencyKey, expectedVersion: version[1] }));
  };
}
