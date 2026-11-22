import Link from "next/link";
import { notFound } from "next/navigation";
import { readBackend } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { ApiProblem } from "@/server/http/problem";
import { CustomerEvent } from "@/ui/event-customer";
import { CustomerEventOverview, CustomerEventStatus } from "@/ui/customer-event-view";
import { Icon } from "@/ui/icons";
import { EventInvoiceDownloads } from "@/ui/event-invoices";
import type { EventInvoices } from "@/ui/invoice-model";
import { customerEventStep, type EventRead } from "@/ui/event-model";
import { uuid, whatsAppLink } from "@/ui/standard-model";

export default async function CustomerEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { accountId, role, csrfToken } = await requirePageSession("CUSTOMER");
  const { eventId } = await params;
  if (!uuid.test(eventId)) notFound();
  const event = await readBackend<EventRead<"getOwnEvent">>("events/" + eventId).catch(error => {
    if (error instanceof ApiProblem && error.status === 404) notFound();
    throw error;
  });
  const invoices = await readBackend<EventInvoices>("events/" + eventId + "/invoices");
  return <main className="customer-events-page customer-event-detail">
    <nav aria-label="Breadcrumb" className="customer-event-breadcrumb"><Link href="/events">Your events</Link><Icon name="chevronRight" size={14} /><span>{event.number}</span></nav>
    <header className="customer-events-heading"><div><p className="eyebrow"><Icon name="spark" size={16} />YOUR DESSERT TABLE</p><h1>{event.request.occasion}</h1><p className="event-reference">Event {event.number}</p></div><CustomerEventStatus event={event} /></header>
    <section className="event-next-step" aria-labelledby="event-update-title"><Icon name="inbox" size={22} /><div><h2 id="event-update-title">Latest update</h2><p>{customerEventStep(event)}</p></div></section>
    <nav className="customer-event-jump-nav" aria-label="Event sections"><a href="#event-details">Event details</a><a href="#event-quote-payments">Quote & payments</a><a href="#event-documents">Invoices</a></nav>
    <div id="event-details" className="event-anchor"><CustomerEventOverview event={event} /></div>
    <div id="event-quote-payments" className="event-anchor">
      <CustomerEvent key={accountId + ":" + event.id} event={event} session={{ accountId, role, csrfToken }}
        whatsApp={whatsAppLink(process.env.SWEETCOMMERCE_WHATSAPP_URL)} />
    </div>
    <div id="event-documents" className="event-anchor event-documents">
      {invoices.items.length ? <EventInvoiceDownloads eventId={event.id} invoices={invoices} /> : <section className="event-panel"><div className="event-panel-heading"><Icon name="down" /><h2>Invoices</h2></div><p className="event-muted">No invoices have been issued yet. Issued invoices will appear here for PDF download.</p></section>}
    </div>
  </main>;
}
