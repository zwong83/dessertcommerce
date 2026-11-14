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
      <header className="page-heading"><div><p className="eyebrow">Operations</p><h1>Work queue</h1><p>Choose a work type to see its status and the next action.</p></div></header>
      <nav className="work-tabs" aria-label="Work type">{kinds.map(([value, title]) => <Link className="chip" href={"/merchant/work?" + new URLSearchParams({ kind: value })}
        key={value} aria-current={kind === value ? "page" : undefined}>{title}</Link>)}</nav>
      <div className="surface">
        <form action="/merchant/work" className="filter-bar">
          <input type="hidden" name="kind" value={kind} />
          <label>Status (optional)<input name="status" defaultValue={status} maxLength={40} pattern="[A-Za-z_]+" aria-describedby="status-help" /></label>
          <label>Service date (MYT)<input name="serviceDate" type="date" defaultValue={date} /></label>
          <button type="submit">Apply filters</button>
          {(status || date) && <Link className="button button-quiet" href={"/merchant/work?" + new URLSearchParams({ kind })}>Clear filters</Link>}
        </form>
        <small id="status-help">Use a status for the selected work type, such as APPLIED for events or DEAD for failed notices.</small>
      </div>
      {!items.length && <div className="empty-state"><h2>No matching work</h2><p>{status || date ? "Clear the filters or choose another work type." : "New items for this work type will appear here."}</p></div>}
      <ul className="item-list work-list">{items.map(item => {
        const href = eventWorkTarget(item) ?? workTarget(item);
        return <li key={item.id}>
          <h2>{href ? <Link href={href} prefetch={false}>{item.number} · {label(item.kind)}</Link> : item.number + " · " + label(item.kind)}</h2>
          <p><span className="status-chip">{label(item.status)}</span> · <Time at={item.updatedAt} /></p>
          {item.noticeOutcome && <p>Delivery outcome {label(item.noticeOutcome)}</p>}
          <p>{item.safeNextAction}</p>
        </li>;
      })}</ul>
      {query.has("cursor") && <p><Link href={"/merchant/work?" + first}>Back to first page</Link></p>}
      {page.nextCursor && <p><Link href={"/merchant/work?" + new URLSearchParams({ ...Object.fromEntries(first), cursor: page.nextCursor })}>Next work page</Link></p>}
    </main>
  );
}
