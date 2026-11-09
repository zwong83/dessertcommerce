import Link from "next/link";
import { readBackend } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { eventWorkTarget, type EventRead } from "@/ui/event-model";
import { Time } from "@/ui/order-details";
import { boundedQuery, isCalendarDate, label, workTarget } from "@/ui/standard-model";

const kinds = [["ORDER", "Orders"], ["EVENT", "Dessert table events"], ["PROOF", "Payment proof"], ["PAYMENT_EXCEPTION", "Payment exceptions"], ["NOTICE", "Notice follow-up"]] as const;

export default async function WorkPage({ searchParams }: {
  searchParams: Promise<{ cursor?: string; kind?: string; status?: string; serviceDate?: string }>;
}) {
  await requirePageSession("ADMIN");
  const filters = await searchParams;
  const query = boundedQuery(filters);
  const kind = kinds.find(([value]) => value === filters.kind)?.[0] ?? "ORDER";
  const status = typeof filters.status === "string" && /^[A-Za-z_]{1,40}$/.test(filters.status) ? filters.status.toUpperCase() : "";
  const date = isCalendarDate(filters.serviceDate) ? filters.serviceDate : "";
  query.set("kind", kind);
  if (status) query.set("status", status);
  if (date) query.set("serviceDate", date);
  const page = await readBackend<EventRead<"listMerchantWork">>("admin/work", query.toString());
  const items = page.items;
  const first = new URLSearchParams(query);
  first.delete("cursor");
  return (
    <main>
      <nav aria-label="Merchant"><Link href="/merchant">Workspace</Link> · <Link href="/merchant/capacity">Production calendar</Link> · <Link href="/merchant/work?kind=EVENT">Events</Link> · <Link href="/merchant/work?kind=NOTICE">Notices</Link></nav>
      <h1>Merchant work queue</h1>
      <form action="/merchant/work">
        <fieldset style={{ minWidth: 0, width: "100%" }}>
          <legend>Filter work</legend>
          <p><label>Work type<br /><select name="kind" defaultValue={kind}>{kinds.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label></p>
          <p><label>Status (optional)<br /><input name="status" defaultValue={status} maxLength={40} pattern="[A-Za-z_]+" aria-describedby="status-help" /></label><br /><small id="status-help">Use a status from the selected work type, such as APPLIED for events or DEAD for failed notice work.</small></p>
          <p><label>Service date (MYT, optional)<br /><input name="serviceDate" type="date" defaultValue={date} /></label></p>
          <button type="submit">Apply filters</button>
        </fieldset>
      </form>
      {!items.length && <p>There is no matching work on this page.</p>}
      <ul className="item-list">{items.map(item => {
        const href = eventWorkTarget(item) ?? workTarget(item);
        return <li key={item.id}>
          <h2>{href ? <Link href={href} prefetch={false}>{item.number} · {label(item.kind)}</Link> : item.number + " · " + label(item.kind)}</h2>
          <p>{label(item.status)} · <Time at={item.updatedAt} /></p>
          {item.noticeOutcome && <p>Delivery outcome {label(item.noticeOutcome)}</p>}
          <p>{item.safeNextAction}</p>
        </li>;
      })}</ul>
      {query.has("cursor") && <p><Link href={"/merchant/work?" + first}>Back to first page</Link></p>}
      {page.nextCursor && <p><Link href={"/merchant/work?" + new URLSearchParams({ ...Object.fromEntries(first), cursor: page.nextCursor })}>Next work page</Link></p>}
    </main>
  );
}
