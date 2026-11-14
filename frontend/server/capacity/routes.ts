import { validation } from "../http/problem";
import { fieldString, fieldUuid, readObject, requestCookie, requireSameOrigin, sessionCookieName } from "../http/request";
import type { Identity } from "../identity/service";
import type { Capacity } from "./service";
import { weekdays } from "./store";

const adminRoutes = new Set([
  "GET admin/capacity-calendar",
  "GET admin/operating-policy",
  "PUT admin/operating-policy",
  "POST admin/capacity/preview",
  "PUT admin/capacity",
]);

function fields(value: unknown, first: string, second: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 2 || !Object.hasOwn(value, first) || !Object.hasOwn(value, second)) {
    throw validation("Check the submitted fields.");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 100) throw validation("Check the submitted list.");
  return value;
}

async function readImpactEdit(request: Request, confirm: boolean) {
  const allowed = ["date", "closed", "dayLimit", "productLimits", "expectedVersion"];
  if (confirm) allowed.push("impactToken");
  const body = await readObject(request, allowed);
  const { closed, dayLimit, expectedVersion } = body;
  if (typeof closed !== "boolean" || typeof dayLimit !== "number" || typeof expectedVersion !== "number") {
    throw validation("Check the date, revision and capacity limits.");
  }
  const productLimits = array(body.productLimits).map((entry) => {
    const { productId, limit } = fields(entry, "productId", "limit");
    if (typeof limit !== "number") throw validation("Enter a product limit.");
    return { productId: fieldUuid(productId, "the product"), limit };
  });
  const edit = { date: fieldString(body.date, "the date", undefined, 10), closed, dayLimit, expectedVersion, productLimits };
  return { edit, impactToken: body.impactToken };
}

function weekday(value: unknown): value is (typeof weekdays)[number] {
  return weekdays.some((day) => day === value);
}

export function capacityRoutes(capacity: Capacity, identity: Pick<Identity, "getSession">, origin: string) {
  return async function handle(request: Request, path: string, requestId: string): Promise<Response | undefined> {
    const route = `${request.method} ${path}`;
    const customer = route === "POST availability";
    if (!customer && !adminRoutes.has(route)) return undefined;

    const write = request.method !== "GET";
    if (write) requireSameOrigin(request, origin);
    const actor = await identity.getSession(
      requestCookie(request, sessionCookieName),
      customer ? "CUSTOMER" : "ADMIN",
      write ? request.headers.get("x-csrf-token") : undefined,
    );
    const query = new URL(request.url).searchParams;
    if (route === "GET admin/operating-policy") return Response.json(await capacity.getOperatingPolicy(actor));
    if (route === "GET admin/capacity-calendar") {
      return Response.json(await capacity.getCapacityCalendar(actor, {
        from: fieldString(query.get("from"), "the start date", undefined, 10),
        to: fieldString(query.get("to"), "the end date", undefined, 10),
      }));
    }
    if (customer) {
      const body = await readObject(request, ["items", "requestedHandoffAt", "fulfilment"]);
      const { fulfilment } = body;
      if (fulfilment !== "PICKUP" && fulfilment !== "MERCHANT_LALAMOVE" && fulfilment !== "CUSTOMER_LALAMOVE") {
        throw validation("Choose a fulfilment mode.");
      }
      const items = array(body.items).map((entry) => {
        const { variantId, quantity } = fields(entry, "variantId", "quantity");
        if (typeof quantity !== "number") throw validation("Enter an item quantity.");
        return { variantId: fieldUuid(variantId, "the variant"), quantity };
      });
      return Response.json(await capacity.evaluateAvailability(actor, {
        items, fulfilment, requestedHandoffAt: fieldString(body.requestedHandoffAt, "the handoff time"),
      }));
    }

    const command = { idempotencyKey: fieldUuid(request.headers.get("idempotency-key"), "the request key"), requestId };
    if (route === "PUT admin/operating-policy") {
      const body = await readObject(request, ["openWeekdays", "opensAt", "closesAt"]);
      const { openWeekdays, opensAt, closesAt } = body;
      if (!Array.isArray(openWeekdays) || !openWeekdays.every(weekday)) throw validation("Check the operating weekdays.");
      return Response.json(await capacity.updateOperatingPolicy(actor, {
        openWeekdays,
        opensAt: fieldString(opensAt, "the opening time", undefined, 5),
        closesAt: fieldString(closesAt, "the closing time", undefined, 5),
      }, request.headers.get("if-match") ?? "", command));
    }

    const confirm = route === "PUT admin/capacity";
    const { edit, impactToken } = await readImpactEdit(request, confirm);
    if (confirm) {
      return Response.json(await capacity.configureCapacity(actor, {
        ...edit, impactToken: fieldString(impactToken, "the impact token", undefined, 600),
      }, command));
    }

    const rawLimit = query.get("limit");
    if (rawLimit !== null && !/^\d+$/.test(rawLimit)) throw validation("Enter an impact page size from 1 to 100.");
    return Response.json(await capacity.previewCapacityImpact(actor, edit, command, {
      limit: rawLimit === null ? undefined : Number(rawLimit), cursor: query.get("cursor") ?? undefined,
    }));
  };
}
