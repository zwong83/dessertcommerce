import Link from "next/link";
import { notFound } from "next/navigation";
import { readBackend } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { ApiProblem } from "@/server/http/problem";
import { MerchantOrderActions } from "@/ui/merchant-order";
import { ChargeDetails, OrderDetails, Time } from "@/ui/order-details";
import { label, merchantChargePath, uuid, type ReadResult } from "@/ui/standard-model";

export default async function MerchantOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { accountId, role, csrfToken } = await requirePageSession("ADMIN");
  const { orderId } = await params;
  if (!uuid.test(orderId)) notFound();
  let order: ReadResult<"getMerchantOrder">;
  try {
    order = await readBackend<ReadResult<"getMerchantOrder">>("admin/orders/" + encodeURIComponent(orderId));
  } catch (error) {
    if (error instanceof ApiProblem && error.status === 404) notFound();
    throw error;
  }
  return (
    <main>
      <nav aria-label="Merchant"><Link href="/merchant">Workspace</Link> · <Link href="/merchant/work">Work queue</Link></nav>
      <h1>Order {order.number}</h1>
      <OrderDetails order={order} contactPhone={order.contactPhone} />
      <MerchantOrderActions key={accountId + ":" + order.id} order={order} session={{ accountId, role, csrfToken }} />
      {[...(order.charge ? [order.charge] : []), ...order.adjustments].map(charge => <section key={charge.id}>
        <h2>{charge.category === "STANDARD_ADJUSTMENT" ? "Separate delivery charge" : "Order payment"}</h2>
        <ChargeDetails charge={charge} />
        <p><Link href={merchantChargePath(charge.id, order.id)} prefetch={false}>Review {charge.category === "STANDARD_ADJUSTMENT" ? "delivery charge" : "payment and refunds"}</Link></p>
      </section>)}
      <section aria-label="Recent order activity">
        <h2>Recent order activity</h2>
        {!order.recentHistory.length && <p>No recent activity.</p>}
        <ul className="item-list">{order.recentHistory.map((entry, index) => <li key={entry.at + ":" + index}>
          <strong>{label(entry.action)}</strong> · <Time at={entry.at} />{entry.safeReason && <p>{entry.safeReason}</p>}
        </li>)}</ul>
      </section>
    </main>
  );
}
