import Link from "next/link";
import { readBackend } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { customerEventStep, eventStatuses, type EventRead } from "@/ui/event-model";
import { Time } from "@/ui/order-details";
import { boundedQuery } from "@/ui/standard-model";

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  await requirePageSession("CUSTOMER", "/events");
  const query = boundedQuery(await searchParams);
  const page = await readBackend<EventRead<"listOwnEvents">>("events", query.toString());

  return <main>
    <header className="page-heading"><div><p className="eyebrow">Celebrations</p><h1>Your dessert table events</h1><p>Keep track of requests, quotes and booking details.</p></div>
      <Link className="button" href="/events/new">Request a dessert table</Link></header>
    {page.items.length ? <ul className="item-list">{page.items.map(event => <li key={event.id}>
      <h2><Link href={"/events/" + event.id} prefetch={false}>{event.number} · {event.request.occasion}</Link></h2>
      <p><span className="status-chip">{eventStatuses[event.status]}</span></p>
      <p>{event.effectiveSchedule ? "Confirmed start" : "Requested start"} <Time at={event.effectiveSchedule?.eventStartAt ?? event.request.startAt} /></p>
      <p>{customerEventStep(event)}</p>
    </li>)}</ul> : <div className="empty-state"><h2>No event requests yet</h2><p>Tell us about your celebration to get started.</p></div>}
    {query.has("cursor") && <p><Link href="/events">Back to newest requests</Link></p>}
    {page.nextCursor && <p><Link href={"/events?" + new URLSearchParams({ cursor: page.nextCursor })}>Next event page</Link></p>}
  </main>;
}
