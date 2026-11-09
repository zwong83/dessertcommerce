"use client";

import { useState } from "react";
import type { components } from "@/contracts/standard-v1";

type Report = components["schemas"]["Report"];
const currency = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" });
const percentage = new Intl.NumberFormat("en-MY", { style: "percent", maximumFractionDigits: 1 });
const categories = {
  STANDARD: "Standard orders and delivery adjustments",
  EVENT_DEPOSIT: "Dessert table deposits",
  EVENT_BALANCE: "Original event balances",
  EVENT_EXTRA: "Post-event invoices",
};

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? percentage.format(numerator / denominator) : "No percentage for this period";
}

export function CommercialReport({ report, filtered }: { report: Report; filtered: boolean }) {
  const [offPlatform, setOffPlatform] = useState("");
  const count = /^[0-9]{1,9}$/.test(offPlatform) ? Number(offPlatform) : null;
  const website = report.acceptedStandard + report.confirmedEvents;
  return (
    <>
      <h2>Verified money movements</h2>
      <p>{report.from} to {report.to} MYT. Based on the actual receipt or refund date.</p>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th scope="col">Category</th><th scope="col">Received</th><th scope="col">Refunded</th><th scope="col">Net</th></tr></thead>
          <tbody>{report.totals.map(row => (
            <tr key={row.category}><th scope="row">{categories[row.category]}</th>
              <td>{currency.format(row.receivedMinor / 100)}</td><td>{currency.format(row.refundedMinor / 100)}</td>
              <td>{currency.format(row.netMinor / 100)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <h2>Orders, bookings and preparation</h2>
      <dl>
        <dt>Standard orders by acceptance date</dt><dd>{report.acceptedStandard}</dd>
        <dt>Events by first confirmed booking date</dt><dd>{report.confirmedEvents}</dd>
        <dt>Committed or used prep units by service date</dt><dd>{report.duePrepUnits}</dd>
      </dl>
      {report.orderCountsByStatus.length > 0 && <ul>{report.orderCountsByStatus.map(row => (
        <li key={row.status}>{row.status.toLowerCase().replaceAll("_", " ")} · {row.count}</li>
      ))}</ul>}
      {report.prepByDay.length > 0 && <ul>{report.prepByDay.map(row => (
        <li key={row.date}><time dateTime={row.date}>{row.date}</time> · {row.units} units</li>
      ))}</ul>}
      <h2>Monthly KPI inputs</h2>
      <p>On-time prep · {report.readyOnTime} of {report.dueWithPromise} with a promise · {ratio(report.readyOnTime, report.dueWithPromise)}</p>
      <p>Quote conversion · {report.quotedWithConfirmedDeposit} of {report.quotedApplications} applications quoted in the period · {ratio(report.quotedWithConfirmedDeposit, report.quotedApplications)}</p>
      <p>Website-origin share · {website} website orders and bookings{count === null ? "" : ` and ${count} off-platform`}</p>
      {filtered
        ? <p>Use all standard order statuses to calculate website-origin share.</p>
        : <><label>Off-platform accepted orders and bookings <input type="text" inputMode="numeric" pattern="[0-9]*"
          maxLength={9} value={offPlatform} onChange={event => setOffPlatform(event.target.value)} /></label>
          <p aria-live="polite">{count === null ? "Enter the same period’s off-platform count." : ratio(website, website + count)}</p></>}
    </>
  );
}
