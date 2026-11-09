import Link from "next/link";
import { notFound } from "next/navigation";
import { readBackend } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { ApiProblem } from "@/server/http/problem";
import { CustomerEvent } from "@/ui/event-customer";
import { EventDetails } from "@/ui/event-details";
import type { EventRead } from "@/ui/event-model";
import { uuid, whatsAppLink } from "@/ui/standard-model";

export default async function CustomerEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { accountId, role, csrfToken } = await requirePageSession("CUSTOMER");
  const { eventId } = await params;
  if (!uuid.test(eventId)) notFound();
  const event = await readBackend<EventRead<"getOwnEvent">>("events/" + eventId).catch(error => {
    if (error instanceof ApiProblem && error.status === 404) notFound();
    throw error;
  });
  return <main>
    <nav aria-label="Events"><Link href="/events">Your events</Link> · <Link href="/shop">Shop</Link></nav>
    <h1>Event {event.number}</h1>
    <EventDetails event={event} />
    <CustomerEvent key={accountId + ":" + event.id} event={event} session={{ accountId, role, csrfToken }}
      whatsApp={whatsAppLink(process.env.SWEETCOMMERCE_WHATSAPP_URL)} />
  </main>;
}
