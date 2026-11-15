import Link from "next/link";
import { notFound } from "next/navigation";
import { readBackend } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { ApiProblem } from "@/server/http/problem";
import { EventDetails } from "@/ui/event-details";
import { EventInvoiceDownloads } from "@/ui/event-invoices";
import type { EventInvoices } from "@/ui/invoice-model";
import { MerchantEventControls } from "@/ui/event-merchant";
import type { EventRead } from "@/ui/event-model";
import { uuid } from "@/ui/standard-model";

export default async function MerchantEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { accountId, role, csrfToken } = await requirePageSession("ADMIN");
  const { eventId } = await params;
  if (!uuid.test(eventId)) notFound();
  const event = await readBackend<EventRead<"getMerchantEvent">>("admin/events/" + eventId).catch(error => {
    if (error instanceof ApiProblem && error.status === 404) notFound();
    throw error;
  });
  const termsVersion = process.env.SWEETCOMMERCE_TERMS_VERSION?.trim();
  const invoices = await readBackend<EventInvoices>("admin/events/" + eventId + "/invoices");
  return <main>
    <nav aria-label="Merchant"><Link href="/merchant/work?kind=EVENT">Event work</Link> · <Link href="/merchant/capacity">Production calendar</Link></nav>
    <h1>Event {event.number}</h1>
    <EventDetails event={event} />
    <EventInvoiceDownloads key={event.id} eventId={event.id} invoices={invoices} csrfToken={csrfToken} />
    <MerchantEventControls key={accountId + ":" + event.id} event={event} session={{ accountId, role, csrfToken }}
      termsVersion={termsVersion && termsVersion.length <= 40 ? termsVersion : undefined} />
  </main>;
}
