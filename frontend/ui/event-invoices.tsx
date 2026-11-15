"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorMessage } from "./error-message";
import { invoiceKinds, type EventInvoices, type InvoiceKind } from "./invoice-model";
import { prepareMutation, sendStandard } from "./standard-api";

export function EventInvoiceDownloads({ eventId, invoices, csrfToken }: {
  eventId: string; invoices: EventInvoices; csrfToken?: string;
}) {
  const router = useRouter();
  const [issuing, setIssuing] = useState<InvoiceKind>();
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<EventInvoices["items"]>([]);
  const all = [...invoices.items, ...issued.filter(item => !invoices.items.some(invoice => invoice.kind === item.kind))];
  const canIssue = (invoices.canIssue ?? []).filter(kind => !all.some(invoice => invoice.kind === kind));
  if (!all.length && !canIssue.length) return null;

  const path = (csrfToken ? "admin/" : "") + "events/" + encodeURIComponent(eventId) + "/invoices/";

  async function issue(kind: InvoiceKind) {
    if (!csrfToken || issuing) return;
    setIssuing(kind);
    setError("");
    try {
      const invoice = await sendStandard<EventInvoices["items"][number]>(
        prepareMutation({ path: path + kind }), csrfToken,
      );
      setIssued(current => [...current, invoice]);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not issue the invoice.");
    } finally {
      setIssuing(undefined);
    }
  }

  return <section aria-labelledby="event-invoices-title">
    {error && <ErrorMessage key={error}>{error}</ErrorMessage>}
    <h2 id="event-invoices-title">Invoices</h2>
    <ul className="item-list">{all.map(invoice => <li key={invoice.kind}>
      <a className="button button-quiet" href={"/api/v1/" + path + invoice.kind + "/pdf"} download>
        Download {invoiceKinds[invoice.kind].toLowerCase()} (PDF)
      </a> <span>{invoice.number}</span>
    </li>)}</ul>
    {canIssue.map(kind => <p key={kind}><button type="button" disabled={!!issuing} onClick={() => void issue(kind)}>
      {issuing === kind ? "Issuing…" : "Issue " + invoiceKinds[kind].toLowerCase()}
    </button></p>)}
  </section>;
}
