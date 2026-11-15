"use client";

import { FileUpload } from "./file-upload";

import { useEffect, useState } from "react";
import { ChargeDetails, Time } from "./order-details";
import { CommandFeedback, CommandForm, Confirm, useStandardCommands, type StandardCommands } from "./standard-forms";
import { canAcceptFee, cancellationInput, money, proofIssue, proofTypes, type Charge, type Order, type Session, type TransferAnswer } from "./standard-model";

function FeeOffer({ order, commands }: { order: Order; commands: StandardCommands }) {
  const offer = order.feeOffer;
  if (!offer) return null;
  return (
    <section aria-label="Delivery fee offer">
      <h2>Delivery fee offer</h2>
      {offer.safeReason && <p>{offer.safeReason}</p>}
      {offer.serviceable ? (
        <>
          {offer.offeredHandoffAt && <p>Offered handoff <Time at={offer.offeredHandoffAt} /></p>}
          {offer.feeMinor !== null && <p>Delivery fee {money(offer.feeMinor)}</p>}
          {offer.totalMinor !== null && <p><strong>Offered total {money(offer.totalMinor)}</strong></p>}
          <details><summary>Terms for this offer</summary><p>{offer.termsText}</p></details>
          {canAcceptFee(order) && (
            <CommandForm key={offer.revision + ":" + offer.termsVersion} commands={commands} legend="Accept this delivery offer"
              submit="Accept fee and handoff"
              onSubmit={() => commands.json<"confirmDeliveryFee">({
                path: "orders/" + order.id + "/confirm-fee", version: order.version,
                json: { feeVersion: offer.revision, termsVersion: offer.termsVersion },
              }, () => "Delivery offer accepted. Review the payment instructions below.")}>
              <Confirm>I agree to the offered time, fee, total and terms.</Confirm>
            </CommandForm>
          )}
        </>
      ) : <p>The merchant cannot serve this delivery request.</p>}
    </section>
  );
}

function useDeadline(deadline: string | null) {
  const [elapsed, setElapsed] = useState<string>();
  useEffect(() => {
    if (!deadline) return;
    const delay = Math.max(0, Date.parse(deadline) - Date.now());
    const timer = setTimeout(() => setElapsed(deadline), Math.min(delay, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [deadline]);
  return deadline !== null && elapsed === deadline;
}

function safeQr(url: string | null) {
  if (!url || /[\s\\]/.test(url)) return null;
  if (/^\/(?!\/)/.test(url)) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : null;
  } catch {
    return null;
  }
}

function CustomerCharge({ charge, adjustment, commands }: {
  charge: Charge; adjustment?: boolean; commands: StandardCommands;
}) {
  const deadline = charge.topUp?.dueAt ?? charge.dueAt;
  const elapsed = useDeadline(deadline);
  const closed = charge.state === "EXPIRED" || charge.state === "CANCELLED";
  const reviewing = charge.reviewStatus === "UNDER_REVIEW" || charge.topUp?.status === "UNDER_REVIEW";
  const reconciliationOnly = closed || elapsed && !reviewing && (charge.state === "OPEN" || charge.state === "DISPUTED");
  const qr = !reconciliationOnly && !reviewing ? safeQr(charge.qrUrl) : null;

  return (
    <section aria-label={adjustment ? "Separate delivery charge" : "DuitNow payment"}>
      <h2>{adjustment ? "Separate delivery charge" : "DuitNow payment"}</h2>
      <ChargeDetails charge={charge} />
      {qr && <>
        <p>Transfer {money(charge.topUp?.outstandingMinor ?? charge.outstandingMinor)} using the merchant’s DuitNow QR, then upload your proof{deadline ? " before the deadline" : ""}.</p>
        <p><a href={qr} target="_blank" rel="noopener noreferrer">Open DuitNow QR in a new tab</a></p>
      </>}
      {(reconciliationOnly || charge.allowedActions.some(action => action === "UPLOAD_PROOF" || action === "SUBMIT_PROOF")) && (
        <>
          {reconciliationOnly && <p role="status">If you already transferred money, you can submit evidence for reconciliation. The order stays closed and the production hold stays released.</p>}
          <CommandForm commands={commands} legend={reconciliationOnly ? "Submit evidence for reconciliation" : "Submit payment proof"} submit="Upload proof"
            onSubmit={(data, form) => {
              const file = data.get("proof");
              if (!(file instanceof File)) throw new Error("Choose a proof file.");
              const issue = proofIssue(file);
              if (issue) throw new Error(issue);
              commands.upload("charges/" + charge.id + "/proof", file, proof => {
                form.reset();
                return proof.reviewDisposition === "RECONCILIATION_ONLY"
                  ? "Evidence was received for reconciliation. The order status and production hold are handled separately."
                  : "Proof was received for review. The merchant still needs to verify the funds.";
              });
            }}>
            <FileUpload name="proof" label="Transfer evidence" required accept={proofTypes} maxBytes={5 * 1024 * 1024}
              help="JPEG, PNG or PDF · Up to 5 MiB" hint="Ready to submit. Choose Upload proof to send it for review."
              disabled={commands.locked} busy={commands.busy} />
          </CommandForm>
        </>
      )}
    </section>
  );
}

function Cancellation({ order, commands, whatsApp }: { order: Order; commands: StandardCommands; whatsApp: string | null }) {
  const [answer, setAnswer] = useState<TransferAnswer | null>(null);
  const canCancel = order.allowedActions.includes("CANCEL");
  const input = cancellationInput(answer);
  const paymentFollowUp = answer === "sent" || answer === "unsure";
  if (!canCancel && order.paymentMethod !== "DUITNOW") return null;

  return (
    <section aria-label="Cancellation and transfer help">
      <h2>{canCancel ? "Cancel this order" : "Transfer help"}</h2>
      {canCancel && (
        <>
          <fieldset disabled={commands.locked}>
            <legend>Have you sent a transfer for this order?</legend>
            {([["none", "No, I have not sent a transfer"], ["sent", "Yes, I sent a transfer"], ["unsure", "I’m unsure whether it went through"]] as const).map(([value, title]) => (
              <p key={value}><label><input type="radio" name="transfer-status" checked={answer === value}
                onChange={() => setAnswer(value)} style={{ minHeight: "auto" }} /> {title}</label></p>
            ))}
          </fieldset>
          {input && <CommandForm commands={commands} legend="Confirm cancellation" submit="Cancel order"
            onSubmit={() => commands.json<"cancelOwnOrder">({
              path: "orders/" + order.id + "/cancel", version: order.version, json: input,
            }, () => {
              setAnswer(null);
              return "Your order was cancelled.";
            })}>
            <p>Confirming will cancel the order and release any unused production hold.</p>
          </CommandForm>}
        </>
      )}
      {(paymentFollowUp || !canCancel || order.paymentMethod === "DUITNOW") && (
        <div role={paymentFollowUp ? "status" : undefined}>
          <p>If you sent a transfer or are unsure, contact the merchant to review the payment.</p>
          {whatsApp
            ? <a href={whatsApp} target="_blank" rel="noopener noreferrer">Contact the merchant on WhatsApp (opens in a new tab)</a>
            : <p>The merchant’s WhatsApp contact is currently unavailable.</p>}
        </div>
      )}
    </section>
  );
}

export function CustomerOrder({ order, session, whatsApp }: { order: Order; session: Session; whatsApp: string | null }) {
  const commands = useStandardCommands(session);
  return (
    <>
      <CommandFeedback commands={commands} />
      <p><button type="button" disabled={commands.busy} onClick={commands.refresh}>Refresh order status</button></p>
      <FeeOffer order={order} commands={commands} />
      {order.paymentMethod === "CASH" && (
        <section aria-label="Cash payment">
          <h2>Cash at pickup</h2>
          {order.status === "AWAITING_CASH" ? <p>Wait for the merchant to confirm your pickup. Pay in cash when you collect.</p>
            : order.charge ? <ChargeDetails charge={order.charge} /> : <p>Pay the agreed total in cash when you collect.</p>}
        </section>
      )}
      {order.paymentMethod === "DUITNOW" && order.charge && <CustomerCharge key={order.charge.id} charge={order.charge} commands={commands} />}
      {order.adjustments.map(charge => <CustomerCharge key={charge.id} charge={charge} adjustment commands={commands} />)}
      <Cancellation order={order} commands={commands} whatsApp={whatsApp} />
    </>
  );
}
