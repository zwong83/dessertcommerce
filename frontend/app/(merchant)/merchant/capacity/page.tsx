import Link from "next/link";
import { ErrorMessage } from "@/ui/error-message";
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
      <header className="page-heading"><div><p className="eyebrow">Planning</p><h1>Production calendar</h1><p>See reserved capacity and choose a day to manage its limits. View up to 31 days in Malaysia time.</p></div></header>
      <form action="/merchant/capacity" className="surface filter-bar">
        <label>From<input name="from" type="date" required defaultValue={from} /></label>
        <label>Through<input name="to" type="date" required defaultValue={to} /></label>
        <label>Edit date (optional)<input name="date" type="date" defaultValue={isCalendarDate(params.date) ? selected : undefined} /></label>
        <button type="submit">View calendar</button>
      </form>
      {!calendar ? <ErrorMessage>Choose a calendar range of at most 31 days with the start on or before the end.</ErrorMessage> : (
        <>
          <section className="surface" aria-labelledby="calendar-dates"><h2 id="calendar-dates">Configured dates</h2>
          {!calendar.days.length && <p>No daily limits are configured in this date range.</p>}
          <ul className="item-list work-list">{calendar.days.map(day => <li className="date-card" key={day.date}>
            <Link aria-current={selected === day.date ? "date" : undefined} href={"/merchant/capacity?" + new URLSearchParams({ from, to, date: day.date })}>{day.date}</Link>
            <div className="actions"><span className="status-chip">{day.closed ? "Closed" : "Open"}</span>{selected === day.date && <small>Selected</small>}</div>
            <p>{day.allocatedUnits} of {day.maxUnits} units reserved</p>
            {day.maxUnits > 0 && <meter className="capacity-meter" aria-label="Reserved capacity" min={0} max={day.maxUnits} value={day.allocatedUnits} />}
          </li>)}</ul>
          </section>
          <MerchantCapacity key={accountId} date={selected} day={calendar.days.find(day => day.date === selected)}
            policy={policy} products={products} session={{ accountId, role, csrfToken }} />
        </>
      )}
    </main>
  );
}
