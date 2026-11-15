import { DateInput } from "@/ui/date-input";
import Link from "next/link";
import { readBackend } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { type EventRead } from "@/ui/event-model";
import { Select } from "@/ui/select";
import { Icon } from "@/ui/icons";
import { WorkQueueList } from "@/ui/work-queue-list";
import {
  workCategories,
  workStatuses,
  workStatusLabel,
} from "@/ui/work-queue-model";
import { boundedQuery, isCalendarDate } from "@/ui/standard-model";

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{
    cursor?: string;
    kind?: string;
    status?: string;
    serviceDate?: string;
  }>;
}) {
  await requirePageSession("ADMIN");
  const filters = await searchParams;
  const query = boundedQuery(filters);
  const category =
    workCategories.find((item) => item.kind === filters.kind) ??
    workCategories[0];
  const kind = category.kind;
  const status =
    typeof filters.status === "string" &&
    /^[A-Za-z_]{1,40}$/.test(filters.status)
      ? filters.status.toUpperCase()
      : "";
  const date = isCalendarDate(filters.serviceDate) ? filters.serviceDate : "";
  query.set("kind", kind);
  if (status) query.set("status", status);
  if (date) query.set("serviceDate", date);
  const page = await readBackend<EventRead<"listMerchantWork">>(
    "admin/work",
    query.toString(),
  );
  const items = page.items;
  const first = new URLSearchParams(query);
  first.delete("cursor");
  const clearHref = "/merchant/work?" + new URLSearchParams({ kind });
  return (
    <main className="wide-page work-queue-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Work queue</h1>
          <p>
            Keep track of orders, payments and events. Open an item to review
            its next action.
          </p>
        </div>
      </header>
      <nav className="work-category-nav" aria-label="Work type">
        {workCategories.map((item) => (
          <Link
            key={item.kind}
            href={
              "/merchant/work?" +
              new URLSearchParams({
                kind: item.kind,
                ...(date ? { serviceDate: date } : {}),
              })
            }
            aria-current={kind === item.kind ? "page" : undefined}
            prefetch={false}
          >
            <Icon name={item.icon} size={20} />
            <span>
              <strong>{item.title}</strong>
              <small>{item.description}</small>
            </span>
          </Link>
        ))}
      </nav>
      <section
        className="surface work-queue-filters"
        aria-labelledby="work-filters-title"
      >
        <div className="work-filter-heading">
          <div>
            <h2 id="work-filters-title">
              Filter {category.title.toLowerCase()}
            </h2>
            <p>Find work by status or service date.</p>
          </div>
          {(status || date) && (
            <Link className="button button-quiet" href={clearHref}>
              Clear filters
            </Link>
          )}
        </div>
        <form
          key={"filters:" + first.toString()}
          action="/merchant/work"
          className="filter-bar"
        >
          <input type="hidden" name="kind" value={kind} />
          <label>
            Status
            <Select name="status" defaultValue={status}>
              <option value="">All statuses</option>
              {status && !workStatuses[kind][status] && (
                <option value={status}>{workStatusLabel(kind, status)}</option>
              )}
              {Object.entries(workStatuses[kind]).map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Service date (MYT)
            <DateInput name="serviceDate" type="date" defaultValue={date} />
          </label>
          <button type="submit">
            Apply filters <Icon name="arrow" size={16} />
          </button>
        </form>
        <p className="work-filter-hint">
          Leave the date empty to include all service dates. Times are shown in
          Malaysia time.
        </p>
      </section>
      <section className="work-results" aria-labelledby="work-results-title">
        <header className="work-results-heading">
          <div>
            <h2 id="work-results-title">{category.title}</h2>
            <p>
              {items.length} {items.length === 1 ? "item" : "items"} on this
              page · Most recently updated first
            </p>
          </div>
          {(status || date) && (
            <div className="work-active-filters" aria-label="Applied filters">
              {status && <span>{workStatusLabel(kind, status)}</span>}
              {date && (
                <span>
                  <Icon name="calendar" size={14} />
                  <time dateTime={date}>{date}</time>
                </span>
              )}
            </div>
          )}
        </header>
        {!items.length ? (
          <div className="surface work-queue-empty">
            <span className="work-empty-icon">
              <Icon name={category.icon} size={30} />
            </span>
            <h3>
              {status || date
                ? "No work matches these filters"
                : "No " + category.title.toLowerCase() + " yet"}
            </h3>
            <p>
              {status || date
                ? "Try another status or service date to find the work you need."
                : "Items will appear here as customers place orders and your team updates their progress."}
            </p>
            {(status || date) && (
              <Link className="button button-secondary" href={clearHref}>
                Clear filters
              </Link>
            )}
          </div>
        ) : (
          <WorkQueueList items={items} />
        )}
      </section>
      {(query.has("cursor") || page.nextCursor) && (
        <nav className="work-pagination" aria-label="Work queue pagination">
          {query.has("cursor") && (
            <Link
              className="button button-secondary"
              href={"/merchant/work?" + first}
            >
              Back to first page
            </Link>
          )}
          {page.nextCursor && (
            <Link
              className="button"
              href={
                "/merchant/work?" +
                new URLSearchParams({
                  ...Object.fromEntries(first),
                  cursor: page.nextCursor,
                })
              }
            >
              Next page <Icon name="arrow" size={16} />
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
