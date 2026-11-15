import Link from "next/link";
import { requirePageSession } from "@/server/http/page-session";
import { EventRequestForm } from "@/ui/event-customer";
import { earliestRequestDate } from "@/ui/event-model";

export default async function NewEventPage() {
  const { accountId, role, csrfToken } = await requirePageSession("CUSTOMER", "/events/new");
  return <main>
    <nav aria-label="Events"><Link href="/events">Your events</Link> · <Link href="/shop">Shop</Link></nav>
    <h1>Request a dessert table</h1>
    <EventRequestForm key={accountId} session={{ accountId, role, csrfToken }} minimumDate={earliestRequestDate(new Date())} />
  </main>;
}
