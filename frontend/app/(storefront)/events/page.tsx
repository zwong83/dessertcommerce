import Link from "next/link";
import { readBackend } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import type { EventRead } from "@/ui/event-model";
import { CustomerEventCard, EventBookingCaution } from "@/ui/customer-event-view";
import { Icon } from "@/ui/icons";
import { boundedQuery } from "@/ui/standard-model";

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  await requirePageSession("CUSTOMER", "/events");
  const query = boundedQuery(await searchParams);
  const page = await readBackend<EventRead<"listOwnEvents">>("events", query.toString());

  return <main className="customer-events-page">
    <header className="customer-events-heading"><div><p className="eyebrow"><Icon name="spark" size={16} />YOUR CELEBRATIONS</p><h1>Your events</h1><p>Every gathering, in one place. Follow your requests, review quotes, and keep your plans close.</p></div>
      <Link className="button" href="/events/new"><Icon name="cake" size={18} />Request a dessert table</Link></header>
    <EventBookingCaution />
    {page.items.length ? <section className="customer-event-list" aria-labelledby="event-list-title">
      <div className="customer-event-list-heading"><h2 id="event-list-title">{query.has("cursor") ? "Earlier requests" : "Your requests & bookings"}</h2><span>{page.items.length} on this page</span></div>
      <ul>{page.items.map(event => <li key={event.id}><CustomerEventCard event={event} /></li>)}</ul>
    </section> : <section className="customer-events-empty">
      <span className="customer-events-empty-icon"><Icon name="cake" size={36} /></span>
      <p className="eyebrow">SOMETHING TO LOOK FORWARD TO</p>
      <h2>{query.has("cursor") ? "No more event requests" : "Your next celebration starts here"}</h2>
      <p>{query.has("cursor") ? "Return to your newest requests to see your latest plans." : "Planning a birthday, a wedding, or a little get-together? Share your ideas and we’ll review the details for a dessert table quote."}</p>
      <Link className="button button-secondary" href={query.has("cursor") ? "/events" : "/events/new"}>{query.has("cursor") ? "Back to newest requests" : "Plan your first dessert table"}<Icon name="arrow" size={17} /></Link>
    </section>}
    {(query.has("cursor") || page.nextCursor) && <nav className="customer-event-pagination" aria-label="Event pages">
      {query.has("cursor") && <Link className="button button-quiet" href="/events">Back to newest requests</Link>}
      {page.nextCursor && <Link className="button button-secondary" href={"/events?" + new URLSearchParams({ cursor: page.nextCursor })}>Older requests<Icon name="arrow" size={16} /></Link>}
    </nav>}
  </main>;
}
