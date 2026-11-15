"use client";

import { Select } from "@/ui/select";
import { useState } from "react";
import { priceInSen } from "./merchant-catalog-model";
import { CommandFeedback, CommandForm, Confirm, Field, LocalTimeField, SelectField, useStandardCommands, type StandardCommands } from "./standard-forms";
import { formText, localTime, money, mytInput, requiredText, type AdminOrder, type JsonInput, type Session } from "./standard-model";

type OrderAction = JsonInput<"changeStandardOrder">["action"];
const actionLabels: Record<OrderAction, string> = {
  ACCEPT_CASH: "Accept Cash pickup",
  REJECT: "Decline order",
  START_PREPARATION: "Start preparation",
  MARK_READY: "Mark ready for handoff",
  HANDOFF: "Record actual handoff",
  COMPLETE: "Complete order",
  MARK_NO_SHOW: "Record missed Cash pickup",
  RECORD_INCIDENT: "Record handoff incident",
  CANCEL: "Cancel order",
  RECORD_DRIVER_ARRIVAL: "Record driver arrival",
};

function Lifecycle({ order, commands }: { order: AdminOrder; commands: StandardCommands }) {
  const options = (Object.entries(actionLabels) as [OrderAction, string][]).filter(([key]) => order.allowedActions.includes(key));
  const [selected, setSelected] = useState<OrderAction>();
  const action = options.some(([value]) => value === selected) ? selected : undefined;
  if (!options.length) return null;

  const needsReason = action === "CANCEL" || action === "REJECT" || action === "MARK_NO_SHOW" || action === "RECORD_INCIDENT";
  const cash = order.paymentMethod === "CASH";
  const recordsCashPickup = action === "HANDOFF" && cash;

  return (
    <CommandForm commands={commands} legend="Order lifecycle" submit="Save order action"
      onSubmit={(data, form) => {
        if (!action) throw new Error("Choose an available order action.");
        const input: JsonInput<"changeStandardOrder"> = { action };
        if (needsReason) input.reason = requiredText(data, "reason", "a reason");
        if (action === "CANCEL") input.cancellationBasis = formText(data, "basis") as NonNullable<typeof input.cancellationBasis>;
        if (action === "RECORD_DRIVER_ARRIVAL") input.driverArrivedAt = mytInput(formText(data, "actual"));
        if (action === "HANDOFF" && formText(data, "actual")) input.handoffAt = mytInput(formText(data, "actual"));
        commands.json<"changeStandardOrder">({ path: "admin/orders/" + order.id + "/actions", version: order.version, json: input }, () => {
          form.reset();
          setSelected(undefined);
          return actionLabels[action] + " recorded.";
        });
      }}>
      <p><label>Available action<br />
        <Select name="action" required value={action ?? ""} onChange={event => setSelected(event.target.value as OrderAction)}>
          <option value="">Choose an action</option>
          {options.map(([value, title]) => <option key={value} value={value}>{title}</option>)}
        </Select>
      </label></p>
      <div key={action}>
        {needsReason && <Field name="reason" maxLength={500} required>Reason for this action</Field>}
        {action === "CANCEL" && <>
          <SelectField name="basis" options={[
            ["", "Choose a cancellation basis"], ["MERCHANT_UNABLE", "Merchant cannot fulfil"], ["CUSTOMER_POLICY", "Customer policy"], ["EXCEPTION", "Exception"],
          ]}>Cancellation basis</SelectField>
          <p>If the merchant cannot fulfil, the order will show any full refund owed on verified receipts.</p>
          <Confirm>I checked the order and any bank transfer before confirming this cancellation.</Confirm>
        </>}
        {action === "RECORD_DRIVER_ARRIVAL" && <LocalTimeField name="actual">Driver arrival time</LocalTimeField>}
        {action === "HANDOFF" && <LocalTimeField name="actual" required={false}>Actual handoff time (leave blank to use the current time)</LocalTimeField>}
        {recordsCashPickup && <Confirm>I collected {order.totalMinor !== null ? money(order.totalMinor) : "the agreed amount"} in cash and handed over the order.</Confirm>}
        {action === "MARK_NO_SHOW" && <Confirm>I verified that the order was uncollected and no cash was received.</Confirm>}
        {action === "REJECT" && <Confirm>I have reviewed the order and want to decline it.</Confirm>}
      </div>
    </CommandForm>
  );
}

function DeliveryFee({ order, commands }: { order: AdminOrder; commands: StandardCommands }) {
  const [decision, setDecision] = useState("");
  const canQuote = order.allowedActions.includes("QUOTE_DELIVERY_FEE");
  if (!canQuote && !order.feeOffer) return null;

  return (
    <section aria-label="Delivery serviceability">
      <h2>Delivery serviceability</h2>
      {order.feeOffer && <p>{order.feeOffer.serviceable ? "Current offer" : "Delivery declined"}{order.feeOffer.feeMinor !== null && " · " + money(order.feeOffer.feeMinor)}
        {order.feeOffer.offeredHandoffAt && " · " + localTime(order.feeOffer.offeredHandoffAt)}</p>}
      {canQuote && <CommandForm commands={commands} legend="Review the requested address and handoff" submit="Save delivery decision"
        onSubmit={(data, form) => {
          const input: JsonInput<"quoteDeliveryFee"> = { serviceable: decision === "offer", reason: requiredText(data, "reason", "a reason") };
          if (input.serviceable) {
            const amount = priceInSen(formText(data, "fee"));
            if (amount === null) throw new Error("Enter a valid delivery fee in MYR with up to two decimal places.");
            input.feeMinor = amount;
            input.handoffAt = mytInput(formText(data, "handoff"));
          }
          commands.json<"quoteDeliveryFee">({ path: "admin/orders/" + order.id + "/fee", version: order.version, json: input }, () => {
            form.reset();
            setDecision("");
            return input.serviceable ? "Delivery offer saved for customer acceptance." : "Delivery request marked unserviceable.";
          });
        }}>
        <SelectField name="serviceable" options={[["", "Choose a decision"], ["offer", "Offer a delivery time and fee"], ["decline", "Address or request is unserviceable"]]}
          onChange={event => setDecision(event.target.value)}>Serviceability decision</SelectField>
        {decision === "offer" && <>
          <Field name="fee" inputMode="decimal" required>Delivery fee (MYR)</Field>
          <LocalTimeField name="handoff">Offered handoff</LocalTimeField>
        </>}
        <Field name="reason" maxLength={500} required>Customer-facing reason</Field>
        <div key={decision}><Confirm>I reviewed the address and confirm this delivery decision.</Confirm></div>
      </CommandForm>}
    </section>
  );
}

function ConsentFields() {
  return <>
    <SelectField name="channel" options={[["PHONE", "Phone"], ["WHATSAPP", "WhatsApp"], ["IN_PERSON", "In person"]]}>How the customer agreed</SelectField>
    <LocalTimeField name="agreed">When the customer agreed</LocalTimeField>
    <Field name="reference" maxLength={200} required>Agreement reference</Field>
    <Confirm>The customer agreed to the exact change above.</Confirm>
  </>;
}

function readConsent(data: FormData): JsonInput<"rescheduleStandardOrder">["consent"] {
  return {
    channel: formText(data, "channel") as JsonInput<"rescheduleStandardOrder">["consent"]["channel"],
    agreedAt: mytInput(formText(data, "agreed")),
    reference: requiredText(data, "reference", "an agreement reference"),
  };
}

function DeliveryRecovery({ order, commands }: { order: AdminOrder; commands: StandardCommands }) {
  const reschedule = order.allowedActions.includes("RESCHEDULE");
  const redelivery = reschedule && order.fulfilment !== "PICKUP";
  const adjust = order.allowedActions.includes("CREATE_DELIVERY_ADJUSTMENT");
  if (!reschedule && !redelivery && !adjust) return null;
  const options = [
    ...(reschedule ? [["RESCHEDULE", "Reschedule"] as const] : []),
    ...(redelivery ? [["REDELIVERY", "Redeliver"] as const] : []),
  ];
  return (
    <section aria-label="Agreed delivery recovery">
      <h2>Agreed delivery recovery</h2>
      {options.length > 0 && <CommandForm commands={commands} legend="Change the promised handoff" submit="Save agreed handoff"
        onSubmit={(data, form) => {
          const json: JsonInput<"rescheduleStandardOrder"> = {
            proposedHandoffAt: mytInput(formText(data, "proposed")),
            requiresNewProduction: data.has("production"),
            reason: requiredText(data, "reason", "a reason"),
            consent: readConsent(data),
            recoveryKind: formText(data, "kind") as JsonInput<"rescheduleStandardOrder">["recoveryKind"],
          };
          commands.json<"rescheduleStandardOrder">({ path: "admin/orders/" + order.id + "/reschedule", version: order.version, json }, () => {
            form.reset();
            return "Agreed handoff saved.";
          });
        }}>
        <SelectField name="kind" options={options}>Recovery type</SelectField>
        <LocalTimeField name="proposed">Revised handoff</LocalTimeField>
        <p><label><input type="checkbox" name="production" /> Requires new production</label></p>
        <Field name="reason" maxLength={500} required>Reason for the change</Field>
        <ConsentFields />
      </CommandForm>}
      {adjust && <CommandForm commands={commands} legend="Record an agreed separate delivery charge" submit="Save separate charge"
        onSubmit={(data, form) => {
          const amount = priceInSen(formText(data, "amount"));
          if (amount === null || amount === 0) throw new Error("Enter a positive delivery charge in MYR.");
          const json = { amountMinor: amount, reason: requiredText(data, "reason", "a reason"), consent: readConsent(data) };
          commands.json<"createDeliveryAdjustment">({
            path: "admin/orders/" + order.id + "/delivery-adjustments", version: order.version, json,
          }, () => {
            form.reset();
            return "Separate delivery charge saved. The original total remains as agreed.";
          });
        }}>
        <Field name="amount" inputMode="decimal" required>Separate charge amount (MYR)</Field>
        <Field name="reason" maxLength={500} required>Reason for this charge</Field>
        <ConsentFields />
      </CommandForm>}
    </section>
  );
}

export function MerchantOrderActions({ order, session }: { order: AdminOrder; session: Session }) {
  const commands = useStandardCommands(session);
  return (
    <section aria-label="Merchant order actions">
      <h2>Order actions</h2>
      <CommandFeedback commands={commands} />
      <p><button type="button" disabled={commands.busy} onClick={commands.refresh}>Refresh order status</button></p>
      <DeliveryFee order={order} commands={commands} />
      <Lifecycle order={order} commands={commands} />
      <DeliveryRecovery order={order} commands={commands} />
      {!order.allowedActions.length && <p>There are no order actions available at this stage.</p>}
    </section>
  );
}
