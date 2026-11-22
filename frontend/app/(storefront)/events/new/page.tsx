import Link from "next/link";
import { requirePageSession } from "@/server/http/page-session";
import { EventRequestForm } from "@/ui/event-customer";
import { earliestRequestDate } from "@/ui/event-model";
import { Icon } from "@/ui/icons";
import { EventBookingCaution } from "@/ui/customer-event-view";
import "./event-request.css";

export default async function NewEventPage() {
  const { accountId, role, csrfToken } = await requirePageSession("CUSTOMER", "/events/new");
  return <main className="event-request-page">
    <nav aria-label="Breadcrumb" className="event-request-breadcrumb"><Link href="/events">Your events</Link><Icon name="chevronRight" size={14} /><span>New request</span></nav>
    <header className="event-request-header">
      <p className="eyebrow"><Icon name="spark" size={16} /> MADE FOR YOUR OCCASION</p>
      <h1>Request a dessert table</h1>
      <p>Request a dessert table for your next gathering. Tell us what you have in mind, and we’ll help bring it to the table.</p>
    </header>
    <EventBookingCaution />
    <EventRequestForm key={accountId} session={{ accountId, role, csrfToken }} minimumDate={earliestRequestDate(new Date())} />
  </main>;
}
