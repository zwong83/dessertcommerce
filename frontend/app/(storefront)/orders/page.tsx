import Link from "next/link";
import { readBackend } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { Logout } from "@/ui/logout";
import { Time } from "@/ui/order-details";
import { boundedQuery, customerNextStep, money, orderStatuses, type ReadResult } from "@/ui/standard-model";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const session = await requirePageSession("CUSTOMER");
  const query = boundedQuery(await searchParams);
  const page = await readBackend<ReadResult<"listOwnOrders">>("orders", query.toString());
  return (
    <main>
      <header className="page-heading"><div><p className="eyebrow">Order history</p><h1>Your orders</h1><p>Track payment, preparation and handoff for each order.</p></div></header>
      {!page.items.length && <div className="empty-state"><h2>No orders to show</h2><p>When you place an order, it’ll appear here.</p><Link className="button" href="/shop">Browse desserts</Link></div>}
      <ul className="item-list">
        {page.items.map(order => <li key={order.id}>
          <h2><Link href={"/orders/" + encodeURIComponent(order.id)} prefetch={false}>Order {order.number}</Link></h2>
          <p><span className="status-chip">{orderStatuses[order.status]}</span>{order.totalMinor !== null && <> · {money(order.totalMinor)}</>}</p>
          <p>{order.promisedHandoffAt ? "Promised handoff " : "Requested handoff "}<Time at={order.promisedHandoffAt ?? order.requestedHandoffAt} /></p>
          <p>{customerNextStep(order)}</p>
        </li>)}
      </ul>
      {query.has("cursor") && <p><Link href="/orders">Back to newest orders</Link></p>}
      {page.nextCursor && <p><Link href={"/orders?" + new URLSearchParams({ cursor: page.nextCursor })}>Next orders page</Link></p>}
      <Logout csrfToken={session.csrfToken} login="/login" />
    </main>
  );
}
