import { DateInput } from "@/ui/date-input";
import { Select } from "@/ui/select";
import { readBackend } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { ApiProblem } from "@/server/http/problem";
import { CommercialReport } from "@/ui/commercial-report";
import { ErrorMessage } from "@/ui/error-message";
import type { components } from "@/contracts/standard-v1";

const statuses = [
  "AWAITING_FEE", "AWAITING_CASH", "PENDING_PROOF", "PAYMENT_REVIEW", "EXCEPTION", "ACCEPTED",
  "PREPARING", "READY", "HANDED_OFF", "COMPLETED", "EXPIRED", "CANCELLED", "REJECTED", "NO_SHOW",
];

export default async function MerchantReports({ searchParams }: {
  searchParams: Promise<{ from?: string; to?: string; orderStatus?: string }>;
}) {
  await requirePageSession("ADMIN");
  const query = await searchParams;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const from = typeof query.from === "string" ? query.from : today.slice(0, 7) + "-01";
  const to = typeof query.to === "string" ? query.to : today;
  const status = typeof query.orderStatus === "string" ? query.orderStatus : "";
  const filters = new URLSearchParams({ from, to });
  if (status) filters.set("orderStatus", status);

  let report: components["schemas"]["Report"] | undefined;
  let error: string | undefined;
  try {
    report = await readBackend<components["schemas"]["Report"]>("admin/reports", filters.toString());
  } catch (problem) {
    if (!(problem instanceof ApiProblem) || problem.status !== 422) throw problem;
    error = problem.message;
  }

  return (
    <main className="wide-page reports-page">
      <header className="page-heading"><div><p className="eyebrow">Performance</p><h1>Sales and operations report</h1><p>Review verified payments and order activity. Choose up to 92 days in Malaysia time.</p></div></header>
      <form key={"filters:" + filters.toString()} action="/merchant/reports" className="surface filter-bar">
        <label>From (MYT)<DateInput type="date" name="from" required defaultValue={from} /></label>
        <label>To (MYT)<DateInput type="date" name="to" required defaultValue={to} /></label>
        <label>Standard order status<Select name="orderStatus" defaultValue={status}>
          <option value="">All statuses</option>
          {statuses.map(state => <option key={state} value={state}>{state.toLowerCase().replaceAll("_", " ")}</option>)}
        </Select></label>
        <button type="submit">Run report</button>
      </form>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {report && <CommercialReport key={filters.toString()} report={report} filtered={Boolean(status)} />}
    </main>
  );
}
