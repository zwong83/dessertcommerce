"use client";

import { ErrorMessage } from "./error-message";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { Time } from "./order-details";
import { readStandard } from "./standard-api";
import { Confirm } from "./standard-forms";
import { formText, isCalendarDate, label, money, mytDate } from "./standard-model";
import { EventField, EventForm, EventTextArea, EventTimeField, ScheduleFields, WindowFields, type EventCommands } from "./event-forms";
import { eventText, moneyMinor, quotePayload, reschedulePayload, schedulePayload, type EventRead, type MerchantEvent } from "./event-model";

function requestedSchedule(event: MerchantEvent) {
  return {
    setupReadyAt: event.request.setupReadyAt,
    eventStartAt: event.request.startAt,
    eventEndAt: event.request.expectedEndAt,
  };
}

export function EventCapacity({ event }: { event: MerchantEvent }) {
  const [result, setResult] = useState<{ from: string; to: string; calendar: EventRead<"getCapacityCalendar"> }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const date = event.request.eventDate;
  const consideredStart = event.effectiveSchedule?.eventStartAt ?? event.alternativeSchedule?.eventStartAt ?? event.quote?.schedule.eventStartAt;
  const defaultDate = consideredStart ? mytDate(new Date(consideredStart)) : date;

  async function check(submission: FormEvent<HTMLFormElement>) {
    submission.preventDefault();
    if (inFlight.current) return;
    const data = new FormData(submission.currentTarget);
    const from = formText(data, "from"), to = formText(data, "to");
    setResult(undefined);
    if (!isCalendarDate(from) || !isCalendarDate(to) || from > to || Date.parse(to) - Date.parse(from) > 30 * 86_400_000) {
      setError("Choose a date range of up to 31 MYT days.");
      return;
    }
    inFlight.current = true;
    setError("");
    setBusy(true);
    try {
      const calendar: EventRead<"getCapacityCalendar"> = await readStandard<"getCapacityCalendar">(
        "admin/capacity-calendar?" + new URLSearchParams({ from, to }),
      );
      setResult({ from, to, calendar });
    } catch {
      setError("The production calendar could not be loaded. Try again before assessing the window.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <section>
    <h2>Capacity assessment</h2>
    <p>Check daily dessert production and active event windows across the dates you are considering.</p>
    <form onSubmit={check}>
      <fieldset disabled={busy} style={{ minWidth: 0, width: "100%" }}>
        <legend>Production and event windows (MYT)</legend>
        <EventField name="from" type="date" initial={defaultDate} required>From</EventField>
        <EventField name="to" type="date" initial={defaultDate} required>Through</EventField>
        <button type="submit">Check capacity</button>
      </fieldset>
    </form>
    {busy && <p role="status">Loading production and event windows…</p>}
    {error && <ErrorMessage>{error}</ErrorMessage>}
    {result && <div>
      <h3>Calendar {result.from} to {result.to}</h3>
      {!result.calendar.days.length && <p>No production limits or event windows are listed for these dates.</p>}
      <ul className="item-list">{result.calendar.days.map(day => <li key={day.date}>
        <p>{day.date} · {day.closed ? "Closed" : "Open"} · {day.allocatedUnits} of {day.maxUnits} production units allocated</p>
        {day.eventWindows.length ? <ul>{day.eventWindows.map(window =>
          <li key={window.eventId + ":" + window.startsAt}>
            {window.eventId === event.id ? "This event" : <Link href={"/merchant/events/" + window.eventId} prefetch={false}>Other event</Link>}
            {" · "}{label(window.status)} · <Time at={window.startsAt} /> to <Time at={window.endsAt} />
          </li>,
        )}</ul> : <p>No active event windows listed.</p>}
      </li>)}</ul>
    </div>}
    <p><Link href={"/merchant/capacity?" + new URLSearchParams({ from: date, date })}>Open production calendar</Link></p>
  </section>;
}

export function QuoteEditor({ event, termsVersion, commands }: { event: MerchantEvent; termsVersion?: string; commands: EventCommands }) {
  const quote = event.quote;
  const plan = event.merchantPlan;
  const initial = event.alternativeSchedule ?? quote?.schedule ?? requestedSchedule(event);
  const [rows, setRows] = useState(() => quote?.equipment.map(item => ({ key: item.id, name: item.name, quantity: String(item.quantity) })) ?? []);
  const [billingRows, setBillingRows] = useState(() => quote?.invoiceLines?.map((item, index) => ({
    key: "saved-" + index, description: item.description, quantity: String(item.quantity),
    unitPrice: (item.unitPriceMinor / 100).toFixed(2),
  })) ?? []);
  const [preview, setPreview] = useState(quote?.totalMinor);
  const labelAction = quote?.status === "OFFERED" ? "Replace quote" : "Issue quote";

  return <EventForm commands={commands} legend="Prepare and confirm quote" submit={labelAction}
    onSubmit={data => {
      const body = quotePayload(data, rows.map(row => row.key), Date.now(), billingRows.map(row => row.key));
      commands.json<"issueEventQuote">("admin/events/" + event.id + "/quotes", event.version, body,
        result => result.quote ? "Quote " + result.quote.version + " issued for customer review." : "Quote issued for customer review.");
    }}>
    <h3>Offered schedule</h3>
    <ScheduleFields initial={initial} />
    <h3>Private resource assessment</h3>
    <WindowFields initial={plan?.resourceWindow} />
    <EventField name="staffCount" type="number" initial={plan ? String(plan.staffCount) : ""} min={1} max={999} required>Planned staff count</EventField>
    <EventTextArea name="assessmentNotes" initial={plan?.assessmentNotes} max={1200}>Assessment notes (production, staffing, venue, travel and equipment)</EventTextArea>
    <h3>Customer offer</h3>
    <EventTextArea name="packageSummary" initial={quote?.packageSummary} max={1500}>Package summary</EventTextArea>
    <EventTextArea name="serviceSummary" initial={quote?.serviceSummary} max={1500}>Service arrangements</EventTextArea>
    <EventTextArea name="extraChargeTerms" initial={quote?.extraChargeTerms} max={1500}>Extra-charge terms</EventTextArea>
    <EventField name="total" initial={quote ? (quote.totalMinor / 100).toFixed(2) : ""} inputMode="decimal" maxLength={10} required
      onInput={e => {
        try { setPreview(moneyMinor(e.currentTarget.value, "the quote total", 2)); }
        catch { setPreview(undefined); }
      }}>Quote total (MYR)</EventField>
    {preview !== undefined && <p>Deposit {money(Math.ceil(preview / 2))} · Balance {money(Math.floor(preview / 2))}</p>}
    <details open={billingRows.length > 0 || undefined}>
      <summary>Invoice billing details</summary>
      <p>Add the agreed price breakdown. Without line items, the invoice shows the package total.</p>
      <EventField name="billingName" initial={quote?.billingName} maxLength={120}>Billing name (defaults to the event contact)</EventField>
      <p><label>Billing address (optional)<br />
        <textarea name="billingAddress" defaultValue={quote?.billingAddress} maxLength={500} rows={3} />
      </label></p>
      {billingRows.map((row, index) => <fieldset key={row.key}>
        <legend>Invoice line {index + 1}</legend>
        <EventField name={"description-" + row.key} initial={row.description} maxLength={200} required>Description</EventField>
        <div className="field-grid">
          <EventField name={"billing-quantity-" + row.key} initial={row.quantity} type="number" min={1} max={9999} required>Quantity</EventField>
          <EventField name={"unit-price-" + row.key} initial={row.unitPrice} inputMode="decimal" maxLength={10} required>Unit price (MYR)</EventField>
        </div>
        <button type="button" onClick={() => setBillingRows(billingRows.filter(item => item.key !== row.key))}>Remove line {index + 1}</button>
      </fieldset>)}
      <button type="button" disabled={billingRows.length >= 30} onClick={() => setBillingRows([
        ...billingRows, { key: crypto.randomUUID(), description: "", quantity: "1", unitPrice: "" },
      ])}>Add invoice line</button>
    </details>
    <EventTimeField name="depositDueAt" initial={quote?.depositDueAt}>Latest deposit deadline</EventTimeField>
    <p>The offer and deposit proof cut off by the earlier of this deadline and 72 hours after issue. Set the deadline at least four days before event start.</p>
    <EventTimeField name="balanceDueAt" initial={quote?.balanceDueAt}>Original balance deadline</EventTimeField>
    <p>Use the MYT date three calendar days before the offered event. The quoted grace period is 24 hours.</p>
    <EventField name="termsVersion" initial={termsVersion ?? quote?.termsVersion} maxLength={40} required>Published terms version</EventField>
    <h3>Included equipment</h3>
    {!rows.length && <p>No equipment items added.</p>}
    {rows.map((row, index) => <fieldset key={row.key}>
      <legend>Equipment {index + 1}</legend>
      <EventField name={"name-" + row.key} initial={row.name} maxLength={120} required>Item name</EventField>
      <EventField name={"quantity-" + row.key} initial={row.quantity} type="number" min={1} max={999} required>Quantity</EventField>
      <button type="button" onClick={() => setRows(rows.filter(item => item.key !== row.key))}>Remove equipment {index + 1}</button>
    </fieldset>)}
    <p><button type="button" disabled={rows.length >= 100}
      onClick={() => setRows([...rows, { key: crypto.randomUUID(), name: "", quantity: "1" }])}>Add equipment</button></p>
    {quote?.status === "OFFERED" && <p>Issuing this revision replaces the current unaccepted offer.</p>}
    <Confirm key={event.version}>I checked capacity, the offered schedule, prices and current published terms.</Confirm>
  </EventForm>;
}

export function AlternateSchedule({ event, commands }: { event: MerchantEvent; commands: EventCommands }) {
  return <EventForm commands={commands} legend="Propose an alternate schedule" submit="Send proposed schedule"
    onSubmit={data => {
      const alternativeSchedule = schedulePayload(data);
      if (Date.parse(alternativeSchedule.setupReadyAt) <= Date.now()) throw new Error("Choose a future proposed schedule.");
      commands.json<"changeEventBooking">("admin/events/" + event.id + "/actions", event.version, {
        action: "PROPOSE_ALTERNATE_DATE", alternativeSchedule, reason: eventText(data, "reason", "the proposal reason", 500),
      }, () => "Alternate schedule proposed for discussion.");
    }}>
    <p>This proposal is for discussion. It releases any unaccepted quote hold and creates no booking.</p>
    <ScheduleFields initial={event.alternativeSchedule ?? requestedSchedule(event)} />
    <EventTextArea name="reason" max={500}>Reason for the proposal</EventTextArea>
    <Confirm key={event.version}>Send the proposed times to the customer.</Confirm>
  </EventForm>;
}

export function RescheduleEditor({ event, commands }: { event: MerchantEvent; commands: EventCommands }) {
  const [channel, setChannel] = useState("");
  const settled = event.charges.some(charge => charge.category === "EVENT_BALANCE" && charge.state === "PAID");

  return <EventForm commands={commands} legend="Confirm a consented reschedule" submit="Confirm replacement schedule"
    onSubmit={data => commands.json<"rescheduleEventBooking">("admin/events/" + event.id + "/reschedule", event.version,
      reschedulePayload(data, event, Date.now()), () => "Replacement schedule confirmed. Review the current arrangements and balance.")}>
    <p>Use this action after the customer agrees to the new schedule and the approved terms. Review capacity for the replacement window.</p>
    <ScheduleFields />
    <WindowFields />
    <h3>Recorded customer consent</h3>
    <EventTimeField name="agreedAt">Consent recorded at</EventTimeField>
    <p><label>Consent channel<br />
      <select name="channel" value={channel} required onChange={e => setChannel(e.target.value)}>
        <option value="">Choose the channel</option><option value="PHONE">Phone</option>
        <option value="WHATSAPP">WhatsApp</option><option value="IN_PERSON">In person</option>
      </select>
    </label></p>
    <EventField name="reference" maxLength={200} required>Consent reference</EventField>
    <EventTextArea name="reason" max={500}>Reason for the change</EventTextArea>
    <h3>Original balance plan</h3>
    {settled ? <p>The original balance is paid and stays settled.</p> : <>
      <p>Record the agreed future balance deadline on the new MYT event date minus three days. The proof grace ends 24 hours later.</p>
      <EventTimeField name="replacementDueAt">Agreed balance deadline</EventTimeField>
    </>}
    <Confirm key={event.version}>The customer agreed to the replacement schedule and balance plan under the approved terms.</Confirm>
  </EventForm>;
}
