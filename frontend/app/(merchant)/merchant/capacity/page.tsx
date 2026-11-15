import { CapacityCalendar } from "@/ui/capacity-calendar";
import { DateInput } from "@/ui/date-input";
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
  const from = isCalendarDate(params.from) ? params.from : today.slice(0, 7) + "-01";
  const defaultEnd = params.from ? new Date(Date.parse(from) + 6 * 86_400_000).toISOString().slice(0, 10)
    : new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const to = isCalendarDate(params.to) ? params.to : defaultEnd;
  const validRange = to >= from && Date.parse(to) - Date.parse(from) <= 30 * 86_400_000;
  const selected = isCalendarDate(params.date) && params.date >= from && params.date <= to ? params.date : today >= from && today <= to ? today : from;
  const [calendar, policy, products] = await Promise.all([
    validRange ? readBackend<ReadResult<"getCapacityCalendar">>("admin/capacity-calendar", new URLSearchParams({ from, to }).toString()) : null,
    readBackend<ReadResult<"getOperatingPolicy">>("admin/operating-policy"),
    readBackend<ReadResult<"listMerchantProducts">>("admin/products", "limit=100"),
  ]);

  return (
    <main className="wide-page capacity-page">
      <header className="page-heading"><div><p className="eyebrow">Planning</p><h1>Production calendar</h1><p>See reserved capacity and choose a day to manage its limits. View up to 31 days in Malaysia time.</p></div></header>
      <form key={from + to} action="/merchant/capacity" className="surface filter-bar">
        <label>From<DateInput name="from" type="date" required defaultValue={from} /></label>
        <label>Through<DateInput name="to" type="date" required defaultValue={to} /></label>
        <button type="submit">View calendar</button>
      </form>
      {!calendar ? <ErrorMessage>Choose a calendar range of at most 31 days with the start on or before the end.</ErrorMessage> : (
        <>
          <CapacityCalendar calendar={calendar} from={from} to={to} selected={selected} today={today} />
          <MerchantCapacity key={accountId} date={selected} day={calendar.days.find(day => day.date === selected)}
            policy={policy} products={products} session={{ accountId, role, csrfToken }} />
        </>
      )}
    </main>
  );
}
