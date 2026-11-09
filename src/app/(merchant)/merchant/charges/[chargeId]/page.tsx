import Link from "next/link";
import type { operations } from "@/contracts/commercial-v1";
import { notFound } from "next/navigation";
import { readBackend } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { ApiProblem } from "@/server/http/problem";
import { eventChargeNames, eventChargePath } from "@/ui/event-model";
import { MerchantSettlement } from "@/ui/merchant-settlement";
import { boundedQuery, merchantChargePath, uuid, type ReadResult } from "@/ui/standard-model";

export default async function MerchantChargePage({ params, searchParams }: {
  params: Promise<{ chargeId: string }>; searchParams: Promise<{ cursor?: string; order?: string; event?: string }>;
}) {
  const { accountId, role, csrfToken } = await requirePageSession("ADMIN");
  const { chargeId } = await params;
  if (!uuid.test(chargeId)) notFound();
  const search = await searchParams;
  const query = boundedQuery(search);
  const path = "admin/charges/" + encodeURIComponent(chargeId);
  let review: ReadResult<"getChargeForReview">;
  try {
    review = await readBackend<ReadResult<"getChargeForReview">>(path);
  } catch (error) {
    if (error instanceof ApiProblem && error.status === 404) notFound();
    throw error;
  }
  const proofs = await readBackend<ReadResult<"listPaymentProofs">>(path + "/proofs", query.toString());
  const relatedOrder = typeof search.order === "string" && uuid.test(search.order)
    ? await readBackend<ReadResult<"getMerchantOrder">>("admin/orders/" + encodeURIComponent(search.order)).catch(error => {
      if (error instanceof ApiProblem && error.status === 404) return null;
      throw error;
    }) : null;
  const order = relatedOrder && (relatedOrder.charge?.id === chargeId || relatedOrder.adjustments.some(charge => charge.id === chargeId))
    ? relatedOrder : null;
  type MerchantEvent = operations["getMerchantEvent"]["responses"][200]["content"]["application/json"];
  const relatedEvent = typeof search.event === "string" && uuid.test(search.event)
    ? await readBackend<MerchantEvent>("admin/events/" + encodeURIComponent(search.event)).catch(error => {
      if (error instanceof ApiProblem && error.status === 404) return null;
      throw error;
    }) : null;
  const event = relatedEvent?.charges.some(charge => charge.id === chargeId) ? relatedEvent : null;
  const cashPickup = order?.charge?.id === chargeId && order.paymentMethod === "CASH";
  const href = event ? eventChargePath(chargeId, event.id) : merchantChargePath(chargeId, order?.id ?? null);
  const eventCharge = eventChargeNames[review.charge.category];
  const next = new URLSearchParams({ cursor: proofs.nextCursor ?? "" });
  if (order) next.set("order", order.id);
  if (event) next.set("event", event.id);
  return (
    <main>
      <nav aria-label="Merchant"><Link href="/merchant/work">Work queue</Link>{order && <> · <Link href={"/merchant/orders/" + order.id}>Order {order.number}</Link></>}{event && <> · <Link href={"/merchant/events/" + event.id}>Event {event.number}</Link></>}</nav>
      <h1>{eventCharge ? "Review " + eventCharge.toLowerCase() : review.charge.category === "STANDARD_ADJUSTMENT"
        ? "Review delivery adjustment" : "Review order payment"}</h1>
      {query.has("cursor") && <p><Link href={href}>Back to newest proofs</Link></p>}
      {proofs.nextCursor && <p><Link href={merchantChargePath(chargeId, null) + "?" + next}>Next proof page</Link></p>}
      <MerchantSettlement key={accountId + ":" + chargeId} review={review} proofs={proofs.items} cashPickup={cashPickup} session={{ accountId, role, csrfToken }} />
    </main>
  );
}
