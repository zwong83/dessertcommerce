"use client";

import type { ReactNode } from "react";
import type { CountryCode } from "libphonenumber-js";
import { AccountPhone } from "./account-phone";
import { EventField } from "./event-forms";
import { Icon } from "./icons";
import { SelectField } from "./standard-forms";

const regions = ["Johor", "Kedah", "Kelantan", "Kuala Lumpur", "Labuan", "Melaka", "Negeri Sembilan", "Pahang", "Penang", "Perak", "Perlis", "Putrajaya", "Sabah", "Sarawak", "Selangor", "Terengganu"];

function RequestSection({ number, title, description, children }: {
  number: string; title: string; description: string; children: ReactNode;
}) {
  return <section className="event-request-card" aria-labelledby={`request-section-${number}`}>
    <header className="event-request-card-heading">
      <span className="event-request-number" aria-hidden="true">{number}</span>
      <div><h2 id={`request-section-${number}`}>{title}</h2><p>{description}</p></div>
    </header>
    {children}
  </section>;
}

export function EventRequestFields({ minimumDate, country, onCountryChange, phone, onPhoneChange }: {
  minimumDate: string;
  country: CountryCode;
  onCountryChange: (country: CountryCode) => void;
  phone: string;
  onPhoneChange: (phone: string) => void;
}) {
  const earliest = new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(minimumDate + "T12:00:00+08:00"));
  return <>
    <RequestSection number="01" title="Your occasion" description="Start with the date, the guests, and a little inspiration.">
      <div className="event-request-date-note"><Icon name="calendar" size={18} /><span>Earliest event date: <strong>{earliest}</strong></span></div>
      <div className="event-request-grid">
        <EventField name="eventDate" type="date" min={minimumDate} required aria-describedby="event-timing-help">Event date</EventField>
        <EventField name="occasion" maxLength={120} placeholder="e.g. Birthday, wedding, office party" required>Occasion</EventField>
      </div>
      <div className="event-request-grid event-request-times">
        <EventField name="setupReadyAt" type="time" required aria-describedby="event-timing-help">Setup ready by</EventField>
        <EventField name="startAt" type="time" required aria-describedby="event-timing-help">Event starts</EventField>
        <EventField name="expectedEndAt" type="time" required aria-describedby="event-timing-help">Expected end</EventField>
      </div>
      <p className="event-request-help" id="event-timing-help">All times are in Malaysia time (MYT), on your event date. Setup must be ready by the start, and the end must be after the start.</p>
      <div className="event-request-grid">
        <EventField name="guestCount" type="number" min={1} max={100000} step={1} placeholder="e.g. 30" required>Number of guests</EventField>
        <EventField name="budget" inputMode="decimal" maxLength={10} placeholder="e.g. 350.00" required>Estimated budget (RM)</EventField>
      </div>
      <EventField name="theme" maxLength={120} placeholder="e.g. Pastel pink, floral, or a favourite character">Theme <span className="event-request-optional">(optional)</span></EventField>
      <p><label htmlFor="event-requirements">Special requirements <span className="event-request-optional">(optional)</span></label>
        <textarea id="event-requirements" name="specialRequirements" rows={3} maxLength={1000} placeholder="Tell us about dietary needs, allergies, or anything else we should consider." /></p>
      <p className="event-request-help">No theme in mind or extra requirements? You can leave these blank.</p>
    </RequestSection>
    <RequestSection number="02" title="The venue" description="Let us know where the gathering will take place.">
      <EventField name="line1" maxLength={200} autoComplete="address-line1" placeholder="Building or venue name and street address" required>Venue address</EventField>
      <EventField name="line2" maxLength={200} autoComplete="address-line2" placeholder="Floor, suite, or unit number">Address line 2 <span className="event-request-optional">(optional)</span></EventField>
      <div className="event-request-grid">
        <EventField name="city" maxLength={100} autoComplete="address-level2" required>City</EventField>
        <EventField name="postcode" maxLength={20} autoComplete="postal-code" required>Postcode</EventField>
        <SelectField name="region" options={[["", "Choose a state or territory"], ...regions.map(region => [region, region] as const)]}>State or territory</SelectField>
        <EventField name="note" maxLength={300} placeholder="e.g. Lift access, parking, loading bay">Access notes <span className="event-request-optional">(optional)</span></EventField>
      </div>
    </RequestSection>
    <RequestSection number="03" title="Stay in touch" description="Who should we contact about the event and quote?">
      <EventField name="contactName" maxLength={120} autoComplete="name" required>Contact name</EventField>
      <AccountPhone id="event-contact-phone" country={country} onCountryChange={onCountryChange} value={phone} onChange={onPhoneChange} />
      <EventField name="notificationEmail" type="email" maxLength={254} autoComplete="email" placeholder="you@example.com">Email for updates <span className="event-request-optional">(optional)</span></EventField>
    </RequestSection>
  </>;
}

export function EventRequestGuide() {
  return <aside className="event-request-guide" aria-labelledby="event-next-heading">
    <div className="event-request-guide-art" aria-hidden="true"><Icon name="cake" size={42} /><span>A table worth<br />gathering around.</span></div>
    <div className="event-request-guide-body">
      <p className="eyebrow">FROM IDEA TO CELEBRATION</p>
      <h2 id="event-next-heading">What happens next?</h2>
      <ol>
        <li><strong>Share your plans</strong><p>Send your event details and preferences.</p></li>
        <li><strong>We review your request</strong><p>We’ll check availability and send a quote if we can serve your event.</p></li>
        <li><strong>Review your quote</strong><p>Check the details and payment terms before deciding to book.</p></li>
      </ol>
      <p className="event-request-help">Submitting a request does not confirm a booking. No payment is needed at this step.</p>
    </div>
  </aside>;
}
