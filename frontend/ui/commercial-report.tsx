"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { components } from "@/contracts/standard-v1";
import { ErrorMessage } from "./error-message";
import { Icon } from "./icons";
import { label } from "./standard-model";

type Report = components["schemas"]["Report"];
const currency = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});
const percentage = new Intl.NumberFormat("en-MY", {
  style: "percent",
  maximumFractionDigits: 1,
});
const categories = {
  STANDARD: "Standard orders",
  EVENT_DEPOSIT: "Event deposits",
  EVENT_BALANCE: "Event balances",
  EVENT_EXTRA: "Event extras",
};
const colors = [
  "var(--ink)",
  "var(--accent)",
  "var(--chart-gold)",
  "var(--chart-rose)",
  "var(--chart-muted)",
];
const tooltipStyle = {
  border: "1px solid var(--line)",
  borderRadius: "12px",
  background: "var(--paper)",
  color: "var(--ink)",
};

function Rate({
  title,
  numerator,
  denominator,
  description,
}: {
  title: string;
  numerator: number;
  denominator: number;
  description: string;
}) {
  return (
    <article className="kpi-card">
      <h3>{title}</h3>
      <strong className="kpi-value">
        {denominator > 0 ? percentage.format(numerator / denominator) : "—"}
      </strong>
      {denominator > 0 && (
        <meter min={0} max={denominator} value={numerator} aria-label={title} />
      )}
      <p>
        {denominator > 0
          ? `${numerator} of ${denominator} ${description}`
          : "No eligible records in this period."}
      </p>
    </article>
  );
}

function EmptyChart({ children }: { children: string }) {
  return (
    <div className="chart-empty">
      <Icon name="chart" size={28} />
      <p>{children}</p>
    </div>
  );
}

export function CommercialReport({
  report,
  filtered,
}: {
  report: Report;
  filtered: boolean;
}) {
  const [offPlatform, setOffPlatform] = useState("");
  const count = /^[0-9]{1,9}$/.test(offPlatform) ? Number(offPlatform) : null;
  const website = report.acceptedStandard + report.confirmedEvents;
  const total = report.totals.reduce(
    (sum, row) => ({
      received: sum.received + row.receivedMinor,
      refunded: sum.refunded + row.refundedMinor,
      net: sum.net + row.netMinor,
    }),
    { received: 0, refunded: 0, net: 0 },
  );
  const amounts = report.totals.map((row) => ({
    name: categories[row.category],
    received: row.receivedMinor / 100,
    refunded: row.refundedMinor / 100,
  }));
  const statuses = report.orderCountsByStatus
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
  const orderCount = statuses.reduce((sum, row) => sum + row.count, 0);
  const slices = statuses
    .slice(0, 4)
    .map((row) => ({ name: label(row.status), count: row.count }));
  if (statuses.length > 4)
    slices.push({
      name: "Other statuses",
      count: statuses.slice(4).reduce((sum, row) => sum + row.count, 0),
    });
  const prep = [];
  for (
    let date = Date.parse(report.from);
    date <= Date.parse(report.to);
    date += 86_400_000
  ) {
    const day = new Date(date).toISOString().slice(0, 10);
    prep.push({
      date: day,
      units: report.prepByDay.find((row) => row.date === day)?.units ?? 0,
    });
  }

  return (
    <div className="report-dashboard">
      <section className="report-summary" aria-label="Payment summary">
        {[
          {
            title: "Verified receipts",
            value: currency.format(total.received / 100),
            note: "Payments received in this period",
          },
          {
            title: "Refunds paid",
            value: currency.format(total.refunded / 100),
            note: "Refunds made in this period",
          },
          {
            title: "Net receipts",
            value: currency.format(total.net / 100),
            note: "Receipts less refunds",
          },
          {
            title: "Accepted orders & bookings",
            value: String(website),
            note: `${report.acceptedStandard} orders · ${report.confirmedEvents} events`,
          },
        ].map((item) => (
          <article className="report-stat" key={item.title}>
            <p>{item.title}</p>
            <strong>{item.value}</strong>
            <small>{item.note}</small>
          </article>
        ))}
      </section>

      <div className="report-chart-grid">
        <section
          className="surface report-panel"
          aria-labelledby="report-movements"
        >
          <div className="section-heading-row">
            <div>
              <h2 id="report-movements">Payments by category</h2>
              <p>Verified receipts and refunds · MYR</p>
            </div>
            <Icon name="chart" />
          </div>
          <div className="chart-legend">
            <span>
              <i style={{ background: "var(--ink)" }} />
              Received
            </span>
            <span>
              <i style={{ background: "var(--accent)" }} />
              Refunded
            </span>
          </div>
          {total.received || total.refunded ? (
            <div
              className="report-chart"
              role="img"
              aria-label="Received and refunded amounts by category. Exact amounts are in the payment details table below."
            >
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart
                  data={amounts}
                  layout="vertical"
                  margin={{ top: 12, right: 12, left: 0, bottom: 12 }}
                  accessibilityLayer
                >
                  <CartesianGrid stroke="var(--line)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 12, fill: "var(--muted)" }}
                    tickFormatter={(value) =>
                      new Intl.NumberFormat("en-MY", {
                        notation: "compact",
                      }).format(Number(value))
                    }
                    axisLine={false}
                    tickLine={false}
                    minTickGap={20}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 12, fill: "var(--muted)" }}
                    axisLine={false}
                    tickLine={false}
                    width={105}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value) => currency.format(Number(value))}
                    cursor={{ fill: "var(--blush)" }}
                  />
                  <Bar
                    dataKey="received"
                    name="Received"
                    fill="var(--ink)"
                    radius={[0, 5, 5, 0]}
                    maxBarSize={24}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="refunded"
                    name="Refunded"
                    fill="var(--accent)"
                    radius={[0, 5, 5, 0]}
                    maxBarSize={24}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyChart>
              No verified payments or refunds in this period.
            </EmptyChart>
          )}
        </section>
        <section
          className="surface report-panel"
          aria-labelledby="report-status"
        >
          <div className="section-heading-row">
            <div>
              <h2 id="report-status">Order status</h2>
              <p>{orderCount} standard orders in this report</p>
            </div>
          </div>
          {orderCount ? (
            <>
              <div
                className="report-donut"
                role="img"
                aria-label="Share of orders by status. Counts and percentages follow the chart."
              >
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <PieChart accessibilityLayer>
                    <Pie
                      data={slices}
                      dataKey="count"
                      nameKey="name"
                      innerRadius="62%"
                      outerRadius="86%"
                      paddingAngle={3}
                      stroke="var(--paper)"
                      isAnimationActive={false}
                    >
                      {slices.map((slice, index) => (
                        <Cell key={slice.name} fill={colors[index]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value) =>
                        `${value} orders (${percentage.format(Number(value) / orderCount)})`
                      }
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-total" aria-hidden="true">
                  <strong>{orderCount}</strong>
                  <span>orders</span>
                </div>
              </div>
              <ul className="chart-key">
                {slices.map((slice, index) => (
                  <li key={slice.name}>
                    <span>
                      <i style={{ background: colors[index] }} />
                      {slice.name}
                    </span>
                    <strong>
                      {slice.count}{" "}
                      <small>
                        {percentage.format(slice.count / orderCount)}
                      </small>
                    </strong>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyChart>No standard orders in this period.</EmptyChart>
          )}
        </section>
      </div>

      <section
        className="surface report-panel"
        aria-labelledby="report-preparation"
      >
        <div className="section-heading-row">
          <div>
            <h2 id="report-preparation">Preparation workload</h2>
            <p>Committed or used units by service date · Malaysia time</p>
          </div>
          <span className="report-total">{report.duePrepUnits} units</span>
        </div>
        {report.prepByDay.some((row) => row.units > 0) ? (
          <div
            className="report-chart"
            role="img"
            aria-label="Preparation units for each service date. Exact values are available in the daily data table."
          >
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart
                data={prep}
                margin={{ top: 20, right: 14, left: 0, bottom: 0 }}
                accessibilityLayer
              >
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => String(value).slice(5)}
                  minTickGap={32}
                  tick={{ fontSize: 12, fill: "var(--muted)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: "var(--muted)" }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip contentStyle={tooltipStyle} />
                <Area
                  dataKey="units"
                  name="Prep units"
                  type="linear"
                  stroke="var(--ink)"
                  fill="var(--accent)"
                  fillOpacity={0.3}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyChart>
            No preparation units scheduled for these dates.
          </EmptyChart>
        )}
        <details className="report-data">
          <summary>View daily preparation data</summary>
          <div
            className="table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Daily preparation data"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Service date</th>
                  <th scope="col">Units</th>
                </tr>
              </thead>
              <tbody>
                {prep.map((row) => (
                  <tr key={row.date}>
                    <th scope="row">{row.date}</th>
                    <td>{row.units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="surface report-panel" aria-labelledby="report-kpis">
        <div className="section-heading-row">
          <div>
            <h2 id="report-kpis">Monthly KPI inputs</h2>
            <p>
              Calculated for {report.from} to {report.to}. Change the report
              dates to review a full month.
            </p>
          </div>
        </div>
        <div className="kpi-grid">
          <Rate
            title="On-time preparation"
            numerator={report.readyOnTime}
            denominator={report.dueWithPromise}
            description="orders with a promised handoff were ready on time."
          />
          <Rate
            title="Quote conversion"
            numerator={report.quotedWithConfirmedDeposit}
            denominator={report.quotedApplications}
            description="quoted applications have a confirmed deposit."
          />
          <article className="kpi-card kpi-input">
            <h3>Website-origin share</h3>
            <strong className="kpi-value" aria-live="polite">
              {!filtered && count !== null && website + count > 0
                ? percentage.format(website / (website + count))
                : "—"}
            </strong>
            {filtered ? (
              <p>Choose all order statuses to calculate this KPI.</p>
            ) : (
              <>
                <label htmlFor="off-platform-count">
                  Off-platform orders & bookings
                </label>
                <input
                  id="off-platform-count"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={9}
                  placeholder="Enter count, including 0"
                  value={offPlatform}
                  aria-describedby="off-platform-help"
                  aria-invalid={offPlatform !== "" && count === null}
                  onChange={(event) => setOffPlatform(event.target.value)}
                />
                <p id="off-platform-help">
                  Enter accepted orders and confirmed bookings from other
                  channels for the same dates. Used for this calculation only.
                </p>
                <p className="kpi-calculation">
                  {website} website{" "}
                  {count !== null
                    ? `+ ${count} off-platform = ${website + count} total`
                    : "orders and bookings"}
                </p>
                {count === 0 && website === 0 && (
                  <p>No orders or bookings to calculate a share.</p>
                )}
                {offPlatform !== "" && count === null && (
                  <ErrorMessage>
                    Enter a whole off-platform count of 0 or more.
                  </ErrorMessage>
                )}
              </>
            )}
          </article>
        </div>
      </section>

      <section
        className="surface report-panel"
        aria-labelledby="payment-details"
      >
        <h2 id="payment-details">Payment details</h2>
        <p>Based on the actual receipt or refund date.</p>
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Verified amounts by category"
        >
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Received</th>
                <th scope="col">Refunded</th>
                <th scope="col">Net receipts</th>
              </tr>
            </thead>
            <tbody>
              {report.totals.map((row) => (
                <tr key={row.category}>
                  <th scope="row">{categories[row.category]}</th>
                  <td>{currency.format(row.receivedMinor / 100)}</td>
                  <td>{currency.format(row.refundedMinor / 100)}</td>
                  <td>{currency.format(row.netMinor / 100)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td>{currency.format(total.received / 100)}</td>
                <td>{currency.format(total.refunded / 100)}</td>
                <td>{currency.format(total.net / 100)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <details className="report-data">
          <summary>View all order statuses</summary>
          <div
            className="table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Order counts by status"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Orders</th>
                  <th scope="col">Share</th>
                </tr>
              </thead>
              <tbody>
                {statuses.map((row) => (
                  <tr key={row.status}>
                    <th scope="row">{label(row.status)}</th>
                    <td>{row.count}</td>
                    <td>{percentage.format(row.count / orderCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!statuses.length && <p>No standard orders in this period.</p>}
          </div>
        </details>
      </section>
    </div>
  );
}
