import Link from "next/link";
import { readBackend } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { customerEventStep, eventStatuses, type EventRead } from "@/ui/event-model";
import { Time } from "@/ui/order-details";
import { boundedQuery } from "@/ui/standard-model";

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  await requirePageSession("CUSTOMER");
  const query = boundedQuery(await searchParams);
  const page = await readBackend<EventRead<"listOwnEvents">>("events", query.toString());

  return <main>
    <nav aria-label="Shopping"><Link href="/shop">Shop</Link> · <Link href="/orders">Your orders</Link></nav>
    <h1>Your dessert table events</h1>
    <p><Link href="/events/new">Request a dessert table</Link></p>
    {page.items.length ? <ul className="item-list">{page.items.map(event => <li key={event.id}>
      <h2><Link href={"/events/" + event.id} prefetch={false}>{event.number} · {event.request.occasion}</Link></h2>
      <p>{eventStatuses[event.status]}</p>
      <p>{event.effectiveSchedule ? "Confirmed start" : "Requested start"} <Time at={event.effectiveSchedule?.eventStartAt ?? event.request.startAt} /></p>
      <p>{customerEventStep(event)}</p>
    </li>)}</ul> : <p>There are no event requests on this page.</p>}
    {query.has("cursor") && <p><Link href="/events">Back to newest requests</Link></p>}
    {page.nextCursor && <p><Link href={"/events?" + new URLSearchParams({ cursor: page.nextCursor })}>Next event page</Link></p>}
  </main>;
}
