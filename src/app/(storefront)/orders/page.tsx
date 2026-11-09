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
      <nav aria-label="Shopping"><Link href="/shop">Shop</Link> · <Link href="/cart">Your cart</Link></nav>
      <h1>Your orders</h1>
      {!page.items.length && <p>There are no orders on this page.</p>}
      <ul className="item-list">
        {page.items.map(order => <li key={order.id}>
          <h2><Link href={"/orders/" + encodeURIComponent(order.id)} prefetch={false}>Order {order.number}</Link></h2>
          <p>{orderStatuses[order.status]}{order.totalMinor !== null && <> · {money(order.totalMinor)}</>}</p>
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
