"use client";

import { useEffect, useRef, useState } from "react";
import { priceInSen } from "./merchant-catalog-model";
import { ChargeDetails, Time } from "./order-details";
import { downloadProof, StandardProblem } from "./standard-api";
import { CommandFeedback, CommandForm, Confirm, Field, LocalTimeField, SelectField, useStandardCommands, type StandardCommands } from "./standard-forms";
import { formText, label, localTime, money, mytInput, requiredText, type JsonInput, type Proof, type ReadResult, type Session } from "./standard-model";

type Review = ReadResult<"getChargeForReview">;
type Case = Review["cases"][number];
type Refund = Review["refundIntents"][number];

function requireAmount(data: FormData, name: string) {
  const amount = priceInSen(formText(data, name));
  if (amount === null || amount < 1) throw new Error("Enter a positive MYR amount with up to two decimal places.");
  return amount;
}

function ProofDownload({ proof }: { proof: Proof }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (failure) feedback.current?.focus(); }, [failure]);

  async function download() {
    setBusy(true);
    setFailure("");
    try {
      await downloadProof(proof.id);
    } catch (error) {
      setFailure(error instanceof StandardProblem && error.denied
        ? "Your merchant session cannot access this proof. Sign in again to continue."
        : "Could not download this proof. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button type="button" disabled={busy} onClick={() => void download()} aria-label={"Download protected proof received " + localTime(proof.receivedAt)}>
      {busy ? "Downloading…" : "Download protected proof"}
    </button>
    {failure && <p role="alert" ref={feedback} tabIndex={-1}>{failure}</p>}
  </>;
}

function proofOption(proof: Proof): [string, string] {
  return [proof.id, localTime(proof.receivedAt) + " · " + label(proof.state) + " · " + label(proof.reviewDisposition)];
}

function ProofDecision({ review, proofs, commands }: { review: Review; proofs: Proof[]; commands: StandardCommands }) {
  const { charge, cases } = review;
  const [choice, setChoice] = useState("");
  const pending = proofs.filter(proof => proof.state === "REVIEW");
  const active = charge.state === "OPEN" || charge.state === "PROOF_REVIEW" || charge.state === "DISPUTED";
  const shortfalls = cases.filter(item => item.reason === "AMOUNT_MISMATCH" && item.state === "OPEN");
  const eventInstallment = charge.category === "EVENT_DEPOSIT" || charge.category === "EVENT_BALANCE";
  const canRequestTopUp = (charge.category === "STANDARD" || eventInstallment) && charge.state === "DISPUTED" &&
    !charge.topUp && charge.paidMinor > charge.refundedMinor && charge.outstandingMinor > 0 && shortfalls.length > 0;
  const topUpProofs = proofs.filter(proof => proof.state === "ACCEPTED" && shortfalls.some(item => item.proofId === proof.id));
  const supplementSources = [...pending, ...topUpProofs];
  const options = [
    ...(pending.length ? [["REJECT_PROOF", "Reject evidence only"]] as const : []),
    ...(canRequestTopUp && supplementSources.length ? [["REQUEST_SUPPLEMENT", eventInstallment ? "Request the event shortfall" : "Issue a 30-minute top-up request"]] as const : []),
    ...(active && charge.category === "STANDARD" && pending.some(proof => proof.reviewDisposition === "TIMELY")
      ? [["REJECT_STANDARD_ORDER", "Reject the standard order"]] as const : []),
    ...(active && charge.category === "EVENT_DEPOSIT" && pending.some(proof => proof.reviewDisposition === "TIMELY")
      ? [["REJECT_EVENT_DEPOSIT", "Reject the deposit and release the event window"]] as const : []),
  ];
  const selectedProofs = choice === "REQUEST_SUPPLEMENT" ? supplementSources : (choice === "REJECT_STANDARD_ORDER" || choice === "REJECT_EVENT_DEPOSIT")
    ? pending.filter(proof => proof.reviewDisposition === "TIMELY") : pending;
  if (!options.length) return null;
  return (
    <CommandForm commands={commands} legend="Decide on payment evidence" submit="Save evidence decision" onSubmit={(data, form) => {
      const decision = formText(data, "decision") as JsonInput<"rejectProof">["decision"];
      const proof = requiredText(data, "proof", "the proof to review");
      commands.json<"rejectProof">({
        path: "admin/proofs/" + encodeURIComponent(proof) + "/reject",
        json: { decision, reason: requiredText(data, "reason", "an internal reason"), customerSafeReason: requiredText(data, "safe", "a customer-facing reason") },
      }, () => {
        form.reset();
        setChoice("");
        if (decision === "REQUEST_SUPPLEMENT") return eventInstallment
          ? "Supplement requested. The existing cutoff still applies."
          : "Top-up request issued. Check the new deadline in the payment summary.";
        if (decision === "REJECT_EVENT_DEPOSIT") return "Deposit rejected. Reconcile any verified funds separately.";
        return decision === "REJECT_STANDARD_ORDER" ? "Standard order rejected. Review any verified funds separately." : "Evidence rejected. Any verified funds still need separate review.";
      });
    }}>
      <SelectField name="decision" options={[["", "Choose an evidence decision"], ...options]} onChange={event => setChoice(event.target.value)}>Evidence decision</SelectField>
      <div key={choice}>
        <SelectField name="proof" options={[["", "Choose proof"], ...selectedProofs.map(proofOption)]}>Proof</SelectField>
        {choice === "REQUEST_SUPPLEMENT" && <p>Request the remaining {money(charge.outstandingMinor)}. {eventInstallment
          ? "The original effective cutoff stays in place." : "The server starts the deadline when it issues the request."}</p>}
        {choice === "REJECT_STANDARD_ORDER" && <p>This rejects the order and releases unused production capacity. Handle verified funds in settlement.</p>}
        {choice === "REJECT_EVENT_DEPOSIT" && <p>This releases the held event window. Handle verified funds in settlement.</p>}
        <Field name="reason" maxLength={500} required>Internal reason</Field>
        <Field name="safe" maxLength={350} required>Customer-facing reason</Field>
        <Confirm>I verified the evidence and confirm this decision.</Confirm>
      </div>
    </CommandForm>
  );
}

function VerifiedReceipt({ review, proofs, commands }: { review: Review; proofs: Proof[]; commands: StandardCommands }) {
  const { charge, cases } = review;
  type Mode = NonNullable<JsonInput<"confirmReceipt">["postingMode"]>;
  const [mode, setMode] = useState<Mode | "">("");
  const [lateDeposit, setLateDeposit] = useState<"" | "FEASIBLE_24H" | "RESCHEDULE_OR_REFUND">("");
  const open = cases.filter(item => item.state === "OPEN");
  const active = charge.allowedActions.includes("CONFIRM_RECEIPT");
  const options: [Mode, string][] = [["RECONCILIATION", "Reconciliation only · keep the existing business status"]];
  const eventCharge = charge.category.startsWith("EVENT_");
  const eventShortfall = (charge.category === "EVENT_DEPOSIT" || charge.category === "EVENT_BALANCE") &&
    charge.paidMinor > charge.refundedMinor && charge.outstandingMinor > 0 && open.some(item => item.reason === "AMOUNT_MISMATCH");
  if (active && !charge.topUp && !eventShortfall) options.unshift(["NORMAL", "Verify payment for an active charge"]);
  if (active && (charge.topUp || eventShortfall) && open.some(item => item.reason === "AMOUNT_MISMATCH")) {
    options.unshift(["SUPPLEMENT", "Verify a supplement against the open shortfall"]);
  }
  const availableCases = mode === "SUPPLEMENT" ? open.filter(item => item.reason === "AMOUNT_MISMATCH") : open;
  const applicableProofs = proofs.filter(proof => proof.state === "REVIEW" && (mode === "RECONCILIATION" || proof.reviewDisposition === "TIMELY"));

  return (
    <CommandForm commands={commands} legend="Record independently verified funds" submit="Post verified receipt" onSubmit={(data, form) => {
      if (!mode) throw new Error("Choose how to post the receipt.");
      const json: JsonInput<"confirmReceipt"> = {
        postingMode: mode, expectedVersion: charge.version,
        externalReference: requiredText(data, "reference", "the bank movement reference"),
        receivedAt: mytInput(formText(data, "received")), amountMinor: requireAmount(data, "amount"),
      };
      const proof = formText(data, "proof"), caseId = formText(data, "case");
      if (proof) json.proofId = proof;
      if (caseId) json.settlementCaseId = caseId;
      if (charge.category === "EVENT_DEPOSIT" && mode !== "RECONCILIATION" && lateDeposit) {
        json.lateDepositDecision = { disposition: lateDeposit, reason: requiredText(data, "lateReason", "the late deposit decision reason") };
      }
      if (mode === "RECONCILIATION") json.reason = requiredText(data, "reason", "the reconciliation reason");
      commands.json<"confirmReceipt">({ path: "admin/charges/" + charge.id + "/receipts", json }, result => {
        form.reset();
        setMode("");
        setLateDeposit("");
        return "Verified receipt recorded. Payment status is " + label(result.state).toLowerCase() + ".";
      });
    }}>
      <SelectField name="mode" options={[["", "Choose a posting mode"], ...options]}
        onChange={event => { setMode(event.target.value as Mode | ""); setLateDeposit(""); }}>Posting mode</SelectField>
      <div key={mode}>
        {mode && <>
          {mode === "RECONCILIATION" && <Field name="reason" maxLength={500} required>Why this transfer needs reconciliation</Field>}
          <SelectField name="case" options={[[ "", mode === "SUPPLEMENT" ? "Choose the shortfall case" : "No linked case"], ...availableCases.map(item =>
            [item.id, label(item.reason) + " · " + localTime(item.openedAt)] as const)]}
            required={mode === "SUPPLEMENT"}>Settlement case</SelectField>
          <SelectField name="proof" options={[["", "Choose proof if applicable"], ...applicableProofs.map(proofOption)]}
            required={eventCharge && mode !== "RECONCILIATION"}>Proof connected to this movement</SelectField>
          {charge.category === "EVENT_DEPOSIT" && mode !== "RECONCILIATION" && <>
            <SelectField name="lateDeposit" options={[["", "Original balance deadline still applies"],
              ["FEASIBLE_24H", "Fulfilment is feasible with a 24-hour balance window"],
              ["RESCHEDULE_OR_REFUND", "Arrange a reschedule or refund"]]} required={false}
              onChange={event => setLateDeposit(event.target.value as typeof lateDeposit)}>Late deposit disposition, if required</SelectField>
            {lateDeposit && <Field name="lateReason" maxLength={500} required>Reason for late deposit disposition</Field>}
          </>}
          <Field name="reference" maxLength={140} required>Actual bank movement reference</Field>
          <Field name="amount" inputMode="decimal" required>Actual amount received (MYR)</Field>
          <LocalTimeField name="received">When the bank transfer arrived</LocalTimeField>
          <Confirm>I checked the bank record independently and verified this exact movement.</Confirm>
        </>}
      </div>
    </CommandForm>
  );
}

const caseReasons = [
  ["LATE_PROOF", "Late proof"],
  ["AMOUNT_MISMATCH", "Amount mismatch"],
  ["TRANSFER_UNMATCHED", "Unmatched transfer"],
  ["STANDARD_FULFILMENT_INFEASIBLE", "Order cannot be fulfilled"],
  ["EVENT_FULFILMENT_INFEASIBLE", "Event needs rescheduling or refund"],
] as const;

function CasePanel({ review, commands, proofs }: { review: Review; commands: StandardCommands; proofs: Proof[] }) {
  const { charge, cases } = review;
  const open = cases.filter(item => item.state === "OPEN" && !(charge.topUp && item.reason === "AMOUNT_MISMATCH"));
  const caseOption = (item: Case) => [item.id, label(item.reason) + " · " + localTime(item.openedAt)] as const;
  return (
    <section aria-label="Reconciliation cases">
      <h2>Reconciliation cases</h2>
      {!cases.length && <p>No recent cases.</p>}
      <ul className="item-list">{cases.map(item => <li key={item.id}>
        <strong>{label(item.reason)}</strong> · {label(item.state)} · Opened <Time at={item.openedAt} />
        {item.proofId && <p>Linked to submitted proof.</p>}
      </li>)}</ul>
      {charge.allowedActions.includes("OPEN_SETTLEMENT_CASE") && <CommandForm commands={commands} legend="Open a reconciliation case" submit="Open case"
        onSubmit={(data, form) => {
          const json: JsonInput<"openSettlementCase"> = {
            reason: formText(data, "reason") as JsonInput<"openSettlementCase">["reason"], notes: requiredText(data, "notes", "the reconciliation notes"),
          };
          const proofId = formText(data, "proof");
          if (proofId) json.proofId = proofId;
          commands.json<"openSettlementCase">({ path: "admin/charges/" + charge.id + "/settlement-cases", json }, () => {
            form.reset();
            return "Reconciliation case recorded.";
          });
        }}>
        <SelectField name="reason" options={[["", "Choose a reason"], ...caseReasons.filter(([reason]) => reason === "EVENT_FULFILMENT_INFEASIBLE"
          ? charge.category.startsWith("EVENT_") : reason !== "STANDARD_FULFILMENT_INFEASIBLE" || !charge.category.startsWith("EVENT_"))]}>Reason</SelectField>
        <SelectField name="proof" options={[["", "No linked proof"], ...proofs.map(proofOption)]} required={false}>Related proof</SelectField>
        <Field name="notes" maxLength={1000} required>Internal reconciliation notes</Field>
      </CommandForm>}
      {open.length > 0 && <CommandForm commands={commands} legend="Resolve a reconciliation case" submit="Resolve case"
        onSubmit={(data, form) => {
          const id = requiredText(data, "case", "the case");
          commands.json<"resolveSettlementCase">({
            path: "admin/settlement-cases/" + encodeURIComponent(id) + "/resolve", json: { reason: requiredText(data, "reason", "the resolution reason") },
          }, () => { form.reset(); return "Case resolved."; });
        }}>
        <SelectField name="case" options={[["", "Choose an open case"], ...open.map(caseOption)]}>Open case</SelectField>
        <Field name="reason" maxLength={500} required>Resolution reason</Field>
        <Confirm>I finished reconciling the selected case.</Confirm>
      </CommandForm>}
    </section>
  );
}

function RefundDisposition({ intent, review, commands }: { intent: Refund; review: Review; commands: StandardCommands }) {
  const [outcome, setOutcome] = useState("");
  const { charge } = review;
  return (
    <CommandForm commands={commands} legend={"Resolve " + label(intent.state).toLowerCase() + " refund of " + money(intent.amountMinor)}
      submit="Save refund outcome" onSubmit={(data, form) => {
        const reason = requiredText(data, "reason", "the refund reason");
        const done = (message: string) => { form.reset(); setOutcome(""); return message; };
        if (outcome === "paid") {
          commands.json<"recordRefund">({
            path: "admin/charges/" + charge.id + "/refunds",
            json: { refundIntentId: intent.id, expectedVersion: charge.version, amountMinor: intent.amountMinor, reason,
              externalReference: requiredText(data, "reference", "the verified payout reference"), refundedAt: mytInput(formText(data, "time")) },
          }, () => done("Verified refund payout recorded."));
        } else if (outcome === "PAYOUT_UNCERTAIN" || outcome === "CONFIRMED_NOT_PAID") {
          commands.json<"reconcileRefundIntent">({
            path: "admin/refund-intents/" + intent.id + "/reconcile", json: { outcome, reason, expectedChargeVersion: charge.version },
          }, () => done(outcome === "PAYOUT_UNCERTAIN" ? "Payout is uncertain. The funds remain reserved." : "Non-payment confirmed. The reservation is released."));
        } else throw new Error("Choose a verified refund outcome.");
      }}>
      <SelectField name="outcome" options={[["", "Choose an outcome"], ["paid", "Verified payout"],
        ...(intent.state === "RESERVED" ? [["PAYOUT_UNCERTAIN", "Payout uncertain"]] as const : []),
        ["CONFIRMED_NOT_PAID", "Verified no payout"]]} onChange={event => setOutcome(event.target.value)}>Outcome</SelectField>
      <div key={outcome}>
        {outcome === "paid" && <>
          <Field name="reference" maxLength={140} required>Bank reference for the actual payout</Field>
          <LocalTimeField name="time">Actual payout time</LocalTimeField>
        </>}
        <Field name="reason" maxLength={500} required>Reason for this outcome</Field>
        <Confirm>I checked the bank record and confirm the selected outcome.</Confirm>
      </div>
    </CommandForm>
  );
}

function RefundPanel({ review, commands }: { review: Review; commands: StandardCommands }) {
  const { charge, recentReceipts, refundIntents } = review;
  return (
    <section aria-label="Refund review">
      <h2>Refunds</h2>
      <p>Available to reserve {money(charge.refundableMinor)}. Reserve against a receipt before paying out manually.</p>
      {!refundIntents.length && <p>No recent refund intents.</p>}
      <ul className="item-list">{refundIntents.map(intent => <li key={intent.id}>
        <p><strong>{money(intent.amountMinor)} · {label(intent.state)}</strong> · <Time at={intent.updatedAt} /></p>
        {intent.state === "UNCERTAIN" && <p>Funds stay reserved. Verify the payout outcome before taking further action.</p>}
        {(intent.state === "RESERVED" || intent.state === "UNCERTAIN") && <RefundDisposition intent={intent} review={review} commands={commands} />}
      </li>)}</ul>
      {charge.allowedActions.includes("RESERVE_REFUND") && recentReceipts.length > 0 && <CommandForm commands={commands}
        legend="Reserve funds for a refund" submit="Reserve refund" onSubmit={(data, form) => {
          const receiptId = requiredText(data, "receipt", "the receipt");
          commands.json<"reserveRefund">({
            path: "admin/charges/" + charge.id + "/refund-intents",
            json: { receiptId, amountMinor: requireAmount(data, "amount"), expectedVersion: charge.version, reason: requiredText(data, "reason", "the refund reason") },
          }, () => { form.reset(); return "Refund reserved. Use this same reservation to record the verified payout outcome."; });
        }}>
        <SelectField name="receipt" options={[["", "Choose a verified receipt"], ...recentReceipts.map(item =>
          [item.id, money(item.amountMinor) + " · " + localTime(item.occurredAt)] as const)]}>Receipt to refund</SelectField>
        <Field name="amount" inputMode="decimal" required>Refund amount (MYR)</Field>
        <Field name="reason" maxLength={500} required>Refund reason</Field>
        <Confirm>I confirm the receipt and amount to reserve.</Confirm>
      </CommandForm>}
    </section>
  );
}

export function MerchantSettlement({ review, proofs, session, cashPickup }: { review: Review; proofs: Proof[]; session: Session; cashPickup: boolean }) {
  const commands = useStandardCommands(session);
  const linkedProofs = [...new Map([...proofs, ...review.proofs].map(proof => [proof.id, proof])).values()];
  const { charge, recentReceipts } = review;
  return (
    <>
      <CommandFeedback commands={commands} />
      <p><button type="button" disabled={commands.busy} onClick={commands.refresh}>Refresh payment</button></p>
      <section aria-label="Payment summary"><h2>Payment summary</h2><ChargeDetails charge={charge} /></section>
      <section aria-label="Protected payment proofs">
        <h2>Payment proofs</h2>
        {!proofs.length && <p>No proofs on this page.</p>}
        <ul className="item-list">{proofs.map(proof => <li key={proof.id}>
          <p><strong>{label(proof.state)}</strong> · {label(proof.reviewDisposition)} · <Time at={proof.receivedAt} /></p>
          <ProofDownload proof={proof} />
        </li>)}</ul>
        <ProofDecision review={review} proofs={linkedProofs} commands={commands} />
      </section>
      <section aria-label="Verified receipts">
        <h2>Verified receipts</h2>
        {!recentReceipts.length && <p>No verified receipts.</p>}
        <ul className="item-list">{recentReceipts.map(item => <li key={item.id}>{money(item.amountMinor)} · <Time at={item.occurredAt} /></li>)}</ul>
        {cashPickup ? <p>Record Cash collection with actual pickup on the order.</p> : <VerifiedReceipt review={review} proofs={linkedProofs} commands={commands} />}
      </section>
      <CasePanel review={review} proofs={linkedProofs} commands={commands} />
      <RefundPanel review={review} commands={commands} />
    </>
  );
}
