"use client";

import { Select } from "@/ui/select";
import Link from "next/link";
import { useState } from "react";
import { Time } from "./order-details";
import { Confirm } from "./standard-forms";
import { formText, label, money, type Session } from "./standard-model";
import { ExtraInvoiceLines, QuoteDetails } from "./event-details";
import { EventFeedback, EventField, EventForm, EventTextArea, EventTimeField, useEventCommands, useEventDeadline, type EventCommands } from "./event-forms";
import { AlternateSchedule, EventCapacity, QuoteEditor, RescheduleEditor } from "./event-planning";
import {
  balanceCutoff, canReschedule, equipmentCheckPayload, equipmentOutPayload, eventChargeNames, eventChargePath, eventDateTime,
  eventText, extrasPayload, merchantCancellationOptions, merchantCancellationPayload, type EventInput, type MerchantEvent,
} from "./event-model";

type Action = EventInput<"changeEventBooking">;
type Actions = { run: (input: Action, message: string) => void; commands: EventCommands };
const timeActions = [
  ["RECORD_SETUP", "Record actual setup", "Actual setup time"],
  ["RECORD_ACTUAL_END", "Record actual event end", "Actual event end time"],
  ["RECORD_TEARDOWN", "Record actual teardown", "Actual teardown time"],
] as const;

function actualTime(data: FormData, earliest?: string | null, allowSame = true) {
  const at = eventDateTime(formText(data, "at"));
  const time = Date.parse(at);
  if (time > Date.now()) throw new Error("Enter an actual time at or before now.");
  if (earliest && (time < Date.parse(earliest) || (!allowSame && time === Date.parse(earliest)))) {
    throw new Error("Enter a time in the correct sequence with the recorded service milestones.");
  }
  return at;
}

function MerchantCancellation({ event, commands, run }: { event: MerchantEvent } & Actions) {
  const cutoff = balanceCutoff(event);
  const elapsed = useEventDeadline(cutoff, false);
  const options = merchantCancellationOptions(event, elapsed);
  const [selected, setSelected] = useState("");
  const basis = options.find(([value]) => value === selected)?.[0];
  if (!options.length) return null;
  return <details>
    <summary>Cancel the event</summary>
    <EventForm commands={commands} legend="Record the cancellation decision" submit="Confirm event cancellation"
      onSubmit={data => {
        const current = merchantCancellationOptions(event, !!cutoff && Date.parse(cutoff) < Date.now());
        if (!basis || !current.some(([value]) => value === basis)) throw new Error("Choose an eligible cancellation basis.");
        run(merchantCancellationPayload(data, basis), "Event cancellation recorded. Review any remaining settlement work.");
      }}>
      <p><label>Cancellation basis<br />
        <Select name="basis" value={basis ?? ""} required onChange={e => setSelected(e.target.value)}>
          <option value="">Choose the cancellation basis</option>
          {options.map(([value, title]) => <option key={value} value={value}>{title}</option>)}
        </Select>
      </label></p>
      <EventTextArea name="reason" max={500}>Reason for cancellation</EventTextArea>
      {basis === "CUSTOMER_REQUEST" && <p><label><input key={event.version} type="checkbox" name="noTransferSent" required /> The customer confirmed they sent no transfer.</label></p>}
      {basis === "BALANCE_OVERDUE" && <p><label><input key={event.version} type="checkbox" name="noBalanceFundsReceived" required /> I checked the bank receipts and found no funds for the original balance.</label></p>}
      {basis === "MERCHANT_UNABLE" && <p>Verified receipts create refund obligations. Review each charge to process those refunds.</p>}
      {basis === "FORCE_MAJEURE" && <p>Record the agreed disposition in the reason and review financial follow-up on the relevant charges.</p>}
      <Confirm key={event.version + ":" + basis}>Record this cancellation and release unused resources.</Confirm>
    </EventForm>
  </details>;
}

function EquipmentLedger({ event }: { event: MerchantEvent }) {
  const names = new Map(event.quote?.equipment.map(item => [item.id, item.name]));
  if (!event.equipmentLedger.length) return null;
  return <section>
    <h2>Recorded equipment</h2>
    <ul className="item-list">{event.equipmentLedger.map(item => <li key={item.equipmentId}>
      <h3>{names.get(item.equipmentId) ?? "Equipment item"}</h3>
      <p>Taken {item.taken} · Recorded <Time at={item.takenAt} /></p>
      {item.checkedAt ? <>
        <p>Returned {item.returned} · Damaged {item.damaged} · Lost {item.lost}</p>
        <p>Inspected <Time at={item.checkedAt} /></p>
      </> : <p>Inspection pending.</p>}
    </li>)}</ul>
  </section>;
}

function EquipmentActions({ event, commands, run }: { event: MerchantEvent } & Actions) {
  const { quote } = event;
  const can = (action: Action["action"]) => event.allowedActions.includes(action);
  const names = new Map(quote?.equipment.map(item => [item.id, item.name]));
  return <>
    {can("RECORD_EQUIPMENT_OUT") && quote && <EventForm commands={commands} legend="Record equipment taken" submit="Save equipment taken"
      onSubmit={data => run({ action: "RECORD_EQUIPMENT_OUT", at: actualTime(data), equipmentOut: equipmentOutPayload(data, quote.equipment) }, "Equipment taken recorded.")}>
      <EventTimeField name="at">Equipment taken at</EventTimeField>
      {quote.equipment.map(item => <EventField key={item.id} name={"taken-" + item.id} type="number" min={0} max={item.quantity} required>
        {item.name} taken (up to {item.quantity})
      </EventField>)}
      <Confirm key={event.version}>The quantities reflect the equipment actually taken.</Confirm>
    </EventForm>}
    {can("RECORD_EQUIPMENT_CHECK") && <EventForm commands={commands} legend="Inspect equipment after teardown" submit="Save equipment inspection"
      onSubmit={data => run({
        action: "RECORD_EQUIPMENT_CHECK", at: actualTime(data, event.actualTeardownAt), equipmentCheck: equipmentCheckPayload(data, event),
      }, "Equipment inspection recorded.")}>
      <EventTimeField name="at">Inspection completed at</EventTimeField>
      <p>Returned plus lost must equal the number taken. Include damaged items in the returned count.</p>
      {event.equipmentLedger.map(item => <fieldset key={item.equipmentId}>
        <legend>{names.get(item.equipmentId) ?? "Equipment"} · {item.taken} taken</legend>
        {(["returned", "damaged", "lost"] as const).map(kind => <EventField key={kind} name={kind + "-" + item.equipmentId} type="number"
          min={0} max={item.taken} required>{label(kind)}</EventField>)}
      </fieldset>)}
      <Confirm key={event.version}>I checked the returned, damaged and lost quantities for each item.</Confirm>
    </EventForm>}
  </>;
}

function ExtrasEditor({ event, commands, run }: { event: MerchantEvent } & Actions) {
  const [rows, setRows] = useState(["first"]);
  return <EventForm commands={commands} legend="Issue the separate extra invoice" submit="Issue extra invoice"
    onSubmit={data => run({ action: "ISSUE_EXTRAS", extras: extrasPayload(data, rows) }, "Extra invoice issued. Review its separate charge for payment.")}>
    <p>List the agreed charges individually. The invoice is due 48 hours after the recorded actual event end.</p>
    {rows.map((row, index) => <fieldset key={row}>
      <legend>Extra {index + 1}</legend>
      <EventField name={"item-" + row} maxLength={120} required>Item or service</EventField>
      <EventTextArea name={"reason-" + row} max={500}>Reason for this charge</EventTextArea>
      <EventField name={"amount-" + row} inputMode="decimal" maxLength={10} required>Amount (MYR)</EventField>
      {rows.length > 1 && <button type="button" onClick={() => setRows(rows.filter(item => item !== row))}>Remove extra {index + 1}</button>}
    </fieldset>)}
    <p><button type="button" disabled={rows.length >= 40} onClick={() => setRows([...rows, crypto.randomUUID()])}>Add another extra</button></p>
    <Confirm key={event.version}>I reviewed each line and am ready to issue the separate invoice.</Confirm>
  </EventForm>;
}

function MerchantEventCharges({ event }: { event: MerchantEvent }) {
  return <section>
    <h2>Payments and settlement</h2>
    {!event.charges.length && <p>No charges have been created for this event.</p>}
    {event.effectiveBalanceDueAt && <p>Current balance due <Time at={event.effectiveBalanceDueAt} /> · Deadline revision {event.balanceDeadlineRevision}</p>}
    {event.effectiveBalanceGraceEndsAt && <p>Balance grace ends <Time at={event.effectiveBalanceGraceEndsAt} /></p>}
    <ul className="item-list">{event.charges.map(charge => {
      const name = eventChargeNames[charge.category] ?? "Charge";
      const invoice = event.extraInvoices.find(item => item.chargeId === charge.id);
      return <li key={charge.id}>
        <h3><Link href={eventChargePath(charge.id, event.id)} prefetch={false}>Review {name.toLowerCase()}</Link></h3>
        <p>{label(charge.state)} · Expected {money(charge.expectedMinor)} · Verified {money(charge.paidMinor)} · Refunded {money(charge.refundedMinor)}</p>
        {charge.reviewStatus && <p>Proof {label(charge.reviewStatus).toLowerCase()}</p>}
        {charge.requiredRefundMinor > 0 && <p>Required refund remaining {money(charge.requiredRefundMinor)}</p>}
        {charge.dueAt && charge.category !== "EVENT_BALANCE" && <p>Proof deadline <Time at={charge.dueAt} /></p>}
        {invoice && <ExtraInvoiceLines invoice={invoice} />}
      </li>;
    })}</ul>
  </section>;
}

export function MerchantEventControls({ event, session, termsVersion }: { event: MerchantEvent; session: Session; termsVersion?: string }) {
  const commands = useEventCommands(session);
  const can = (action: string) => event.allowedActions.includes(action);
  const canReplace = canReschedule(event);
  const lastTaken = event.equipmentLedger.reduce<string | null>((last, item) =>
    !last || Date.parse(last) < Date.parse(item.takenAt) ? item.takenAt : last, null);

  function run(input: Action, message: string) {
    commands.json<"changeEventBooking">("admin/events/" + event.id + "/actions", event.version, input, () => message);
  }

  return <>
    <EventFeedback commands={commands} />
    <p><button type="button" disabled={commands.busy} onClick={commands.refresh}>Refresh event status</button></p>
    {event.quote && <QuoteDetails quote={event.quote} />}
    {event.merchantPlan && <section>
      <h2>Saved resource assessment</h2>
      <p>Window <Time at={event.merchantPlan.resourceWindow.startAt} /> to <Time at={event.merchantPlan.resourceWindow.endAt} /></p>
      <p>Planned staff {event.merchantPlan.staffCount}</p>
      <p style={{ whiteSpace: "pre-wrap" }}>{event.merchantPlan.assessmentNotes}</p>
    </section>}
    <MerchantEventCharges event={event} />
    {(can("ISSUE_QUOTE") || can("PROPOSE_ALTERNATE_DATE") || canReplace) && <EventCapacity event={event} />}
    {can("ISSUE_QUOTE") && <details>
      <summary>{event.quote?.status === "OFFERED" ? "Prepare a replacement quote" : "Prepare a quote"}</summary>
      <QuoteEditor event={event} commands={commands} termsVersion={termsVersion} />
    </details>}
    {can("PROPOSE_ALTERNATE_DATE") && <details>
      <summary>Suggest different times</summary>
      <AlternateSchedule event={event} commands={commands} />
    </details>}
    {can("DECLINE") && <details>
      <summary>Decline the request</summary>
      <EventForm commands={commands} legend="Decline the event request" submit="Confirm decline"
        onSubmit={data => run({ action: "DECLINE", reason: eventText(data, "reason", "the decline reason", 500) }, "Event request declined.")}>
        <EventTextArea name="reason" max={500}>Reason for decline</EventTextArea>
        <Confirm key={event.version}>Decline this request and release any unaccepted quote hold.</Confirm>
      </EventForm>
    </details>}
    {canReplace && <details>
      <summary>Reschedule the booking</summary>
      <RescheduleEditor event={event} commands={commands} />
    </details>}
    {can("RESCHEDULE") && !canReplace && <p>Review the deposit and current balance settlement before rescheduling.</p>}
    <MerchantCancellation event={event} commands={commands} run={run} />
    <EquipmentLedger event={event} />
    <EquipmentActions event={event} commands={commands} run={run} />
    {timeActions.filter(([action]) => can(action)).map(([action, title, field]) => <EventForm key={action}
      commands={commands} legend={title} submit={title}
      onSubmit={data => {
        const at = actualTime(data, action === "RECORD_TEARDOWN" ? event.actualEndAt : action === "RECORD_ACTUAL_END" ? event.actualSetupAt : null,
          action !== "RECORD_ACTUAL_END");
        if (action === "RECORD_ACTUAL_END" && lastTaken && Date.parse(at) < Date.parse(lastTaken)) {
          throw new Error("Record event end at or after the equipment taken time.");
        }
        run({ action, at }, title.replace("Record", "Recorded") + ".");
      }}>
      <EventTimeField name="at">{field}</EventTimeField>
      <Confirm key={event.version}>This is the recorded service time.</Confirm>
    </EventForm>)}
    {can("ISSUE_EXTRAS") && <details><summary>Itemize extra charges</summary><ExtrasEditor event={event} commands={commands} run={run} /></details>}
    {can("COMPLETE") && <EventForm commands={commands} legend="Close completed service" submit="Complete event"
      onSubmit={() => run({ action: "COMPLETE" }, "Event service marked complete.")}>
      <Confirm key={event.version}>{can("ISSUE_EXTRAS") ? "Inspection is complete and there are no extras to invoice." : "Service and settlement are complete."}</Confirm>
    </EventForm>}
    {!event.allowedActions.length && <p>There are no event actions available in this state.</p>}
    <section>
      <h2>Recent activity</h2>
      {event.recentHistory.length ? <ul className="item-list">{event.recentHistory.map((entry, index) => <li key={index}>
        {label(entry.action)} · <Time at={entry.at} />{entry.safeReason && <> · {label(entry.safeReason)}</>}
      </li>)}</ul> : <p>There is no recorded activity yet.</p>}
    </section>
  </>;
}
