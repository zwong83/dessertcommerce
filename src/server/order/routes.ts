import { fieldString, fieldUuid, readObject, requestCookie, requireSameOrigin, sessionCookieName } from "../http/request";
import type { Identity } from "../identity/service";
import { checkoutFields, submitFields } from "./input";
import type { OrderService } from "./service";

export function orderRoutes(order: OrderService, identity: Pick<Identity, "getSession">, origin: string) {
  return async function handle(request: Request, path: string, requestId: string): Promise<Response | undefined> {
    const reviewAction = /^checkout\/reviews\/([^/]+)\/(outcome|abandon)$/.exec(path);
    const orderDetail = /^orders\/([^/]+)$/.exec(path);
    const commandOutcome = /^commands\/([^/]+)$/.exec(path);
    const review = request.method === "POST" && path === "checkout/review";
    const submit = request.method === "POST" && path === "orders";
    const abandon = request.method === "POST" && reviewAction?.[2] === "abandon";
    const outcome = request.method === "GET" && reviewAction?.[2] === "outcome";
    const detail = request.method === "GET" && orderDetail;
    const command = request.method === "GET" && commandOutcome;
    if (!(review || submit || abandon || outcome || detail || command)) return undefined;

    const write = review || submit || abandon;
    if (write) requireSameOrigin(request, origin);
    const actor = await identity.getSession(requestCookie(request, sessionCookieName), "CUSTOMER",
      write ? request.headers.get("x-csrf-token") : undefined);
    if (review) return Response.json(await order.reviewCheckout(actor, await readObject(request, checkoutFields)));
    if (outcome) return Response.json(await order.getCheckoutOutcome(actor, fieldUuid(reviewAction[1], "the review")));
    if (detail) return Response.json(await order.getOwnOrder(actor, fieldUuid(orderDetail[1], "the order")));
    if (command) {
      const operation = fieldString(new URL(request.url).searchParams.get("operation"), "the command operation", undefined, 80);
      return Response.json(await order.getOwnCommandOutcome(actor, operation, fieldUuid(commandOutcome[1], "the request key")));
    }
    const context = { idempotencyKey: fieldUuid(request.headers.get("idempotency-key"), "the request key"), requestId };
    if (abandon) {
      return Response.json(await order.abandonOrResolveCheckout(actor, fieldUuid(reviewAction[1], "the review"), context));
    }
    return Response.json(await order.submitOrder(actor, await readObject(request, submitFields), context), { status: 201 });
  };
}
