import Link from "next/link";
import { Icon } from "./icons";
import { Time } from "./order-details";
import { money } from "./standard-model";
import { customerEventStep, eventStatuses, type EventBooking } from "./event-model";
import { EventScheduleDetails } from "./event-details";

export function EventBookingCaution() {
  return <aside className="event-booking-caution" aria-label="Important booking notice">
    <Icon name="warning" size={24} />
    <div><strong>Important: please allow at least 7 days</strong>
      <p>After <strong>10 pm MYT</strong>, the earliest eligible event date moves forward by one day. Check the earliest event date before making your plans.</p>
    </div>
  </aside>;
}

export function CustomerEventStatus({ event }: { event: EventBooking }) {
  return <span className="event-status-badge" data-status={event.status}>{eventStatuses[event.status]}</span>;
}

export function CustomerEventCard({ event }: { event: EventBooking }) {
  const start = event.effectiveSchedule?.eventStartAt ?? event.request.startAt;
  const day = new Intl.DateTimeFormat("en-MY", { day: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(start));
  const month = new Intl.DateTimeFormat("en-MY", { month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(start));
  return <article className="customer-event-card">
    <div className="customer-event-date" aria-hidden="true"><strong>{day}</strong><span>{month}</span></div>
    <div className="customer-event-card-body">
      <div className="customer-event-card-title"><div><p className="event-reference">{event.number}</p><h2><Link href={"/events/" + event.id} prefetch={false}>{event.request.occasion}</Link></h2></div><CustomerEventStatus event={event} /></div>
      <div className="customer-event-facts">
        <p><Icon name="calendar" size={17} /><span>{event.effectiveSchedule ? event.status === "CANCELLED" ? "Previously confirmed start" : "Confirmed start" : "Requested start"}<strong><Time at={start} /></strong></span></p>
        <p><Icon name="user" size={17} /><span>Guests<strong>{event.request.guestCount.toLocaleString("en-MY")}</strong></span></p>
        <p><Icon name="cake" size={17} /><span>Venue<strong>{event.request.venue.city}</strong></span></p>
      </div>
      <div className="customer-event-card-footer"><p>{customerEventStep(event)}</p><Link href={"/events/" + event.id} prefetch={false} className="button button-secondary" aria-label={`View event ${event.number}`}>View event<Icon name="arrow" size={16} /></Link></div>
    </div>
  </article>;
}

export function CustomerEventOverview({ event }: { event: EventBooking }) {
  const { request } = event;
  return <div className="event-overview">
    {event.effectiveSchedule && <section className="event-panel event-confirmed-panel">
      <div className="event-panel-heading"><Icon name="calendar" /><h2>{event.status === "CANCELLED" ? "Previously confirmed schedule" : "Confirmed schedule"}</h2></div>
      <EventScheduleDetails schedule={event.effectiveSchedule} />
    </section>}
    {event.alternativeSchedule && <section className="event-panel">
      <div className="event-panel-heading"><Icon name="calendar" /><h2>Suggested alternate schedule</h2></div>
      <p className="event-muted">These times are for discussion. Check the quote or confirmed schedule for commitments.</p>
      <EventScheduleDetails schedule={event.alternativeSchedule} />
    </section>}
    <div className="event-overview-grid">
      <section className="event-panel">
        <div className="event-panel-heading"><span className="event-section-number" aria-hidden="true">01</span><h2>Original request</h2></div>
        <dl className="event-info-grid">
          <div><dt>Occasion</dt><dd>{request.occasion}</dd></div>
          <div><dt>Guests</dt><dd>{request.guestCount.toLocaleString("en-MY")}</dd></div>
          <div><dt>Estimated budget</dt><dd>{money(request.budgetMinor)}</dd></div>
          <div><dt>Theme</dt><dd>{request.theme === "None" ? "No preference" : request.theme}</dd></div>
        </dl>
        <h3 className="event-subheading">Requested schedule</h3>
        <ul className="item-list event-schedule-list">
          <li><span>Requested setup ready</span><Time at={request.setupReadyAt} /></li>
          <li><span>Requested start</span><Time at={request.startAt} /></li>
          <li><span>Requested end</span><Time at={request.expectedEndAt} /></li>
        </ul>
        <h3 className="event-subheading">Special requirements</h3>
        <p className="event-preserve-text">{request.specialRequirements === "None" ? "None specified" : request.specialRequirements}</p>
      </section>
      <section className="event-panel">
        <div className="event-panel-heading"><span className="event-section-number" aria-hidden="true">02</span><h2>Venue & contact</h2></div>
        <dl className="event-info-stack">
          <div><dt>Venue address</dt><dd>{[request.venue.line1, request.venue.line2, request.venue.city, request.venue.postcode, request.venue.region].filter(Boolean).join(", ")}</dd></div>
          {request.venue.note && <div><dt>Venue access</dt><dd>{request.venue.note}</dd></div>}
          <div><dt>Contact name</dt><dd>{request.contactName}</dd></div>
          <div><dt>Phone number</dt><dd>{request.phone}</dd></div>
          {request.notificationEmail && <div><dt>Email for updates</dt><dd>{request.notificationEmail}</dd></div>}
        </dl>
      </section>
    </div>
    {(event.actualSetupAt || event.actualEndAt || event.actualTeardownAt) && <section className="event-panel">
      <div className="event-panel-heading"><Icon name="check" /><h2>Service milestones</h2></div>
      <ul className="item-list event-schedule-list">
        {event.actualSetupAt && <li><span>Actual setup</span><Time at={event.actualSetupAt} /></li>}
        {event.actualEndAt && <li><span>Actual end</span><Time at={event.actualEndAt} /></li>}
        {event.actualTeardownAt && <li><span>Actual teardown</span><Time at={event.actualTeardownAt} /></li>}
      </ul>
    </section>}
  </div>;
}
