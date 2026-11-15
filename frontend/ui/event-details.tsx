import { Time } from "./order-details";
import { eventStatuses, type EventBooking, type EventSchedule } from "./event-model";
import { label, money } from "./standard-model";

export function EventScheduleDetails({ schedule }: { schedule: EventSchedule }) {
  return <ul className="item-list">
    <li>Setup ready <Time at={schedule.setupReadyAt} /></li>
    <li>Start <Time at={schedule.eventStartAt} /></li>
    <li>Expected end <Time at={schedule.eventEndAt} /></li>
    <li>Teardown <Time at={schedule.teardownAt} /></li>
  </ul>;
}

export function EventDetails({ event }: { event: EventBooking }) {
  const { request } = event;
  return <>
    <p role="status">{eventStatuses[event.status]}</p>
    {event.safeOutcome && <p>{event.safeOutcome}</p>}
    <section>
      <h2>Original request</h2>
      <p>{request.occasion} · {request.guestCount} guests · Budget {money(request.budgetMinor)}</p>
      <p>Theme {request.theme}</p>
      <p>Special requirements {request.specialRequirements}</p>
      <p>Venue {[request.venue.line1, request.venue.line2, request.venue.city, request.venue.postcode, request.venue.region].filter(Boolean).join(", ")}</p>
      {request.venue.note && <p>Venue access {request.venue.note}</p>}
      <p>Contact {request.contactName} · {request.phone}{request.notificationEmail && <> · {request.notificationEmail}</>}</p>
      <ul className="item-list">
        <li>Requested setup ready <Time at={request.setupReadyAt} /></li>
        <li>Requested start <Time at={request.startAt} /></li>
        <li>Requested end <Time at={request.expectedEndAt} /></li>
      </ul>
    </section>
    {event.alternativeSchedule && <section>
      <h2>Suggested alternate schedule</h2>
      <p>The merchant suggested these times for discussion. Check the quote or confirmed schedule for commitments.</p>
      <EventScheduleDetails schedule={event.alternativeSchedule} />
    </section>}
    {event.effectiveSchedule && <section>
      <h2>{event.status === "CANCELLED" ? "Previously confirmed schedule" : "Confirmed schedule"}</h2>
      <EventScheduleDetails schedule={event.effectiveSchedule} />
    </section>}
    {(event.actualSetupAt || event.actualEndAt || event.actualTeardownAt) && <section>
      <h2>Service milestones</h2>
      <ul className="item-list">
        {event.actualSetupAt && <li>Actual setup <Time at={event.actualSetupAt} /></li>}
        {event.actualEndAt && <li>Actual end <Time at={event.actualEndAt} /></li>}
        {event.actualTeardownAt && <li>Actual teardown <Time at={event.actualTeardownAt} /></li>}
      </ul>
    </section>}
  </>;
}

export function QuoteDetails({ quote }: { quote: NonNullable<EventBooking["quote"]> }) {
  return <section>
    <h2>Event quote {quote.version}</h2>
    {quote.invoiceLines && <ul className="item-list" aria-label="Quoted invoice lines">
      {quote.invoiceLines.map((line, index) => <li key={index}>
        {line.description} · {line.quantity} × {money(line.unitPriceMinor)} · {money(line.amountMinor)}
      </li>)}
    </ul>}
    <p>{label(quote.status)} · Issued <Time at={quote.issuedAt} /></p>
    <h3>Offered schedule</h3>
    <EventScheduleDetails schedule={quote.schedule} />
    <h3>Package and service</h3>
    <p>{quote.packageSummary}</p>
    <p>{quote.serviceSummary}</p>
    {quote.equipment.length > 0 && <><h3>Equipment included</h3>
      <ul className="item-list">{quote.equipment.map(item => <li key={item.id}>{item.quantity} × {item.name}</li>)}</ul></>}
    <h3>Price and quoted deadlines</h3>
    <p><strong>Total {money(quote.totalMinor)}</strong></p>
    <ul className="item-list">
      <li>Deposit {money(quote.depositMinor)} · Accept and submit deposit proof before <Time at={quote.depositDueAt} /></li>
      <li>Original balance {money(quote.balanceMinor)} · Quoted due <Time at={quote.balanceDueAt} /></li>
      <li>Quoted balance grace ends <Time at={quote.balanceGraceEndsAt} /></li>
    </ul>
    <h3>Extra-charge terms</h3>
    <p style={{ whiteSpace: "pre-wrap" }}>{quote.extraChargeTerms}</p>
    <h3>Published terms {quote.termsVersion}</h3>
    <p style={{ whiteSpace: "pre-wrap" }}>{quote.termsText}</p>
  </section>;
}

export function ExtraInvoiceLines({ invoice }: { invoice: EventBooking["extraInvoices"][number] }) {
  return <ul className="item-list">{invoice.lines.map((line, index) =>
    <li key={index}>{line.item} · {money(line.amountMinor)}<p>{line.reason}</p></li>,
  )}</ul>;
}
