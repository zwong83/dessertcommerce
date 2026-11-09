import Link from "next/link";
import { readBackend } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { MerchantCapacity } from "@/ui/merchant-capacity";
import { isCalendarDate, mytDate, type ReadResult } from "@/ui/standard-model";

export default async function CapacityPage({ searchParams }: {
  searchParams: Promise<{ from?: string; to?: string; date?: string }>;
}) {
  const { accountId, role, csrfToken } = await requirePageSession("ADMIN");
  const params = await searchParams;
  const now = new Date();
  const today = mytDate(now);
  const from = isCalendarDate(params.from) ? params.from : today;
  const defaultEnd = new Date(Date.parse(from) + 6 * 86_400_000).toISOString().slice(0, 10);
  const to = isCalendarDate(params.to) ? params.to : defaultEnd;
  const validRange = to >= from && Date.parse(to) - Date.parse(from) <= 30 * 86_400_000;
  const selected = isCalendarDate(params.date) && params.date >= from && params.date <= to ? params.date : from;
  const [calendar, policy, products] = await Promise.all([
    validRange ? readBackend<ReadResult<"getCapacityCalendar">>("admin/capacity-calendar", new URLSearchParams({ from, to }).toString()) : null,
    readBackend<ReadResult<"getOperatingPolicy">>("admin/operating-policy"),
    readBackend<ReadResult<"listMerchantProducts">>("admin/products", "limit=100"),
  ]);

  return (
    <main>
      <nav aria-label="Merchant"><Link href="/merchant">Workspace</Link> · <Link href="/merchant/work">Work queue</Link></nav>
      <h1>Production calendar</h1>
      <form action="/merchant/capacity">
        <fieldset style={{ minWidth: 0, width: "100%" }}>
          <legend>View up to 31 days (MYT)</legend>
          <p><label>From<br /><input name="from" type="date" required defaultValue={from} /></label></p>
          <p><label>Through<br /><input name="to" type="date" required defaultValue={to} /></label></p>
          <p><label>Edit date in this range (optional)<br /><input name="date" type="date" defaultValue={isCalendarDate(params.date) ? selected : undefined} /></label></p>
          <button type="submit">View calendar</button>
        </fieldset>
      </form>
      {!calendar ? <p role="alert">Choose a calendar range of at most 31 days with the start on or before the end.</p> : (
        <>
          <h2>Configured dates</h2>
          {!calendar.days.length && <p>No daily limits are configured in this date range.</p>}
          <ul className="item-list">{calendar.days.map(day => <li key={day.date}>
            <Link href={"/merchant/capacity?" + new URLSearchParams({ from, to, date: day.date })}>{day.date}</Link>
            {" · "}{day.closed ? "Closed" : "Open"}{" · "}{day.allocatedUnits} occupied of {day.maxUnits} units
          </li>)}</ul>
          <MerchantCapacity key={accountId} date={selected} day={calendar.days.find(day => day.date === selected)}
            policy={policy} products={products} session={{ accountId, role, csrfToken }} />
        </>
      )}
    </main>
  );
}
