"use client";

import { FileUpload } from "./file-upload";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CountryCode } from "libphonenumber-js";
import { internationalPhone } from "./account-phone";
import { EventRequestFields, EventRequestGuide } from "./event-request-fields";
import { prepareMutation, readStandard, StandardProblem } from "./standard-api";
import { Confirm } from "./standard-forms";
import { label, money, proofIssue, proofTypes, uuid, type Proof, type Session, type TransferAnswer } from "./standard-model";
import { Time } from "./order-details";
import { QuoteDetails } from "./event-details";
import { EventFeedback, EventForm, useEventCommands, useEventDeadline, type EventCommands } from "./event-forms";
import { acceptancePayload, balanceCutoff, eventCancellation, eventChargeNames, requestPayload, type EventBooking, type EventCharge } from "./event-model";

async function requestOutcome(key: string) {
  try {
    const result = await readStandard<"getOwnCommandOutcome">("commands/" + key + "?operation=submitEventRequest");
    if (result.resourceType === "EVENT" && uuid.test(result.resourceId)) return result.resourceId;
    throw new Error("The recorded outcome could not be opened.");
  } catch (error) {
    if (error instanceof StandardProblem && error.status === 404) return undefined;
    throw error;
  }
}

export function EventRequestForm({ session, minimumDate }: { session: Session; minimumDate: string }) {
  const router = useRouter();
  const commands = useEventCommands(session);
  const storageKey = "sweetcommerce.event-request." + session.accountId;
  const [restored, setRestored] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [noOutcome, setNoOutcome] = useState(false);
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(false);
  const pendingCheck = useRef(false);
  const [country, setCountry] = useState<CountryCode>("MY");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    try {
      const key = sessionStorage.getItem(storageKey);
      if (key && uuid.test(key)) setRestored(key);
    } catch {
      // The form still works when browser storage is unavailable.
    } finally {
      setReady(true);
    }
  }, [storageKey]);

  function clearSavedKey() {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // The current page can still retry the same in-memory command.
    }
  }

  function open(id: string) {
    setOpening(true);
    router.replace("/events/" + encodeURIComponent(id));
    clearSavedKey();
    return "Event request received.";
  }

  async function recover(key: string) {
    if (pendingCheck.current) return;
    pendingCheck.current = true;
    setChecking(true);
    setNoOutcome(false);
    let found = false;
    try {
      const active = await readStandard<"getSession">("session");
      if (active.accountId !== session.accountId || active.role !== session.role) throw new Error("Sign in to the account that sent the request.");
      const id = await requestOutcome(key);
      if (id) {
        open(id);
        found = true;
      } else {
        setNoOutcome(true);
      }
    } catch (error) {
      commands.showError(error);
    } finally {
      pendingCheck.current = false;
      if (!found) setChecking(false);
    }
  }

  return <>
    <EventFeedback commands={commands} />
    {!ready && <p role="status">Checking for an earlier request…</p>}
    {opening ? <p role="status">Opening your event request…</p> : restored ? <section>
      <h2>Check your previous submission</h2>
      <p>Look up the result before starting another request.</p>
      <button type="button" disabled={checking} onClick={() => void recover(restored)}>Check request outcome</button>
      {checking && <p role="status">Checking request outcome…</p>}
      {noOutcome && <div role="status">
        <p>There is no recorded outcome for this submission yet. <Link href="/events">Check your event requests</Link> before starting another.</p>
        <button type="button" onClick={() => {
          clearSavedKey();
          setRestored(undefined);
          setNoOutcome(false);
        }}>Start a new request</button>
      </div>}
    </section> : ready && <div className="event-request-layout"><EventForm commands={commands} legend="Dessert table request" submit="Send event request" className="event-request-form"
      submitHint="We’ll review your details before sending a quote. You can follow your request in Your events."
      onSubmit={data => {
        const normalizedPhone = internationalPhone(phone, country);
        if (!normalizedPhone) throw new Error("Enter a valid contact phone number for the selected country code.");
        data.set("phone", normalizedPhone);
        const json = requestPayload(data, new Date());
        const mutation = prepareMutation({ path: "events", json });
        try {
          sessionStorage.setItem(storageKey, mutation.key);
        } catch {
          // If storage is unavailable, retry remains available on this page.
        }
        commands.send<EventBooking>(mutation, result => open(result.id), {
          refresh: false,
          rejected: clearSavedKey,
          recover: async () => {
            const id = await requestOutcome(mutation.key);
            return id ? open(id) : undefined;
          },
        });
      }}>
      <p className="event-request-required">All fields are required unless marked optional.</p>
      <EventRequestFields minimumDate={minimumDate} country={country} onCountryChange={setCountry} phone={phone} onPhoneChange={setPhone} />
    </EventForm><EventRequestGuide /></div>}
  </>;
}

function safeQr(value: string | null) {
  if (!value || /[\s\\]/.test(value)) return null;
  if (/^\/(?!\/)/.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function EventPayment({ event, charge, commands }: { event: EventBooking; charge: EventCharge; commands: EventCommands }) {
  const balance = charge.category === "EVENT_BALANCE";
  const deadline = balance ? balanceCutoff(event) ?? charge.dueAt : charge.dueAt;
  const elapsed = useEventDeadline(deadline);
  const closed = charge.state === "CANCELLED" || charge.state === "EXPIRED";
  const reviewing = charge.reviewStatus === "UNDER_REVIEW";
  const reconciliation = closed || elapsed || event.status === "EXCEPTION" || event.status === "CANCELLED";
  const canUpload = charge.allowedActions.includes("UPLOAD_PROOF");
  const qr = canUpload && !reconciliation && !reviewing ? safeQr(charge.qrUrl) : null;

  return <section>
    <h2>{eventChargeNames[charge.category] ?? "Event payment"}</h2>
    <p>{label(charge.state)} · Expected {money(charge.expectedMinor)} · Verified {money(charge.paidMinor)} · Refunded {money(charge.refundedMinor)}</p>
    {canUpload && !reconciliation && charge.paidMinor > 0 && charge.outstandingMinor > 0 &&
      <p><strong>Remaining amount {money(charge.outstandingMinor)}</strong></p>}
    {charge.requiredRefundMinor > 0 && <p>Refund still owed {money(charge.requiredRefundMinor)}</p>}
    {balance && event.effectiveBalanceDueAt && <p>Current balance due <Time at={event.effectiveBalanceDueAt} /></p>}
    {deadline && (!balance || !!balanceCutoff(event)) && <p>{balance && event.effectiveBalanceGraceEndsAt ? "Current grace ends" : "Proof cutoff"} <Time at={deadline} /></p>}
    {reviewing && <p role="status">Your proof is under review. The merchant still needs to verify the transfer.</p>}
    {qr && <>
      <p>Transfer {money(charge.outstandingMinor)} by DuitNow and upload the proof before the cutoff.</p>
      <p><a href={qr} target="_blank" rel="noopener noreferrer">Open DuitNow QR in a new tab</a></p>
    </>}
    {canUpload && <>
      {reconciliation && <p>If you already transferred money, you can upload evidence for reconciliation. The merchant will review it against this charge.</p>}
      <EventForm commands={commands} legend={reconciliation ? "Submit evidence for reconciliation" : "Submit private payment proof"} submit="Upload proof"
        onSubmit={(data, form) => {
          const file = data.get("proof");
          if (!(file instanceof File)) throw new Error("Choose a proof file.");
          const issue = proofIssue(file);
          if (issue) throw new Error(issue);
          commands.send<Proof>(prepareMutation({ path: "charges/" + charge.id + "/proof", file }), proof => {
            form.reset();
            return proof.reviewDisposition === "RECONCILIATION_ONLY"
              ? "Evidence was received for reconciliation."
              : "Proof was received. The merchant will verify the transfer.";
          });
        }}>
        <FileUpload name="proof" label="Transfer evidence" required accept={proofTypes} maxBytes={5 * 1024 * 1024}
              help="JPEG, PNG or PDF · Up to 5 MiB" hint="Ready to submit. Choose Upload proof to send it for review."
              disabled={commands.locked} busy={commands.busy} />
      </EventForm>
    </>}
  </section>;
}

export function CustomerEvent({ event, session, whatsApp }: { event: EventBooking; session: Session; whatsApp: string | null }) {
  const commands = useEventCommands(session);
  const [answer, setAnswer] = useState<TransferAnswer | null>(null);
  const quote = event.quote;
  const elapsed = useEventDeadline(quote?.depositDueAt ?? null);
  const canAccept = !elapsed && acceptancePayload(event);
  const canCancel = event.allowedActions.includes("CANCEL");
  const noTransfer = eventCancellation(answer);

  return <>
    <EventFeedback commands={commands} />
    <p><button type="button" disabled={commands.busy} onClick={commands.refresh}>Refresh event status</button></p>
    {quote && <QuoteDetails quote={quote} />}
    {canAccept && <EventForm key={event.version + ":" + canAccept.quoteId + ":" + canAccept.termsVersion} commands={commands}
      legend="Accept the current quote" submit="Accept quote"
      onSubmit={() => {
        const body = acceptancePayload(event, Date.now());
        if (!body) {
          commands.refresh();
          throw new Error("This quote has reached its cutoff. Review the latest event status.");
        }
        commands.json<"acceptEventQuote">("events/" + event.id + "/accept-quote", event.version, body,
          () => "Quote accepted. Review the deposit instructions. The merchant confirms the booking after verifying the deposit.");
      }}>
      <Confirm>I agree to the offered schedule, amounts, deadlines and published terms.</Confirm>
    </EventForm>}
    {event.status === "QUOTED" && elapsed && <p role="status">The quote cutoff has passed. Refresh the event for the latest outcome.</p>}
    {event.charges.map(charge => <EventPayment key={charge.id} event={event} charge={charge} commands={commands} />)}
    {(canCancel || event.charges.length > 0) && <section>
      <h2>{canCancel ? "Cancellation and transfer help" : "Transfer help"}</h2>
      {canCancel && <fieldset disabled={commands.locked}>
        <legend>Have you sent a transfer for this event?</legend>
        {([["none", "No, I have not sent a transfer"], ["sent", "Yes, I sent a transfer"], ["unsure", "I’m unsure whether it went through"]] as const)
          .map(([value, title]) => <p key={value}><label><input type="radio" name="transfer-status" checked={answer === value}
            onChange={() => setAnswer(value)} style={{ minHeight: "auto" }} /> {title}</label></p>)}
      </fieldset>}
      {canCancel && noTransfer && <EventForm commands={commands} legend="Confirm pre-transfer cancellation" submit="Cancel event request"
        onSubmit={() => commands.json<"cancelEventRequest">("events/" + event.id + "/cancel", event.version, noTransfer, () => {
          setAnswer(null);
          return "Your event request was cancelled.";
        })}>
        <Confirm>I have sent no transfer and want to cancel this event request.</Confirm>
      </EventForm>}
      {(!canCancel || answer === "sent" || answer === "unsure") && <div role="status">
        <p>If you sent a transfer or are unsure, ask the merchant to review the payment.</p>
        {whatsApp && <a href={whatsApp} target="_blank" rel="noopener noreferrer">Contact the merchant on WhatsApp (opens in a new tab)</a>}
      </div>}
    </section>}
  </>;
}
