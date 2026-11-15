"use client";

import { DateInput } from "@/ui/date-input";
import { Select } from "@/ui/select";
import { ErrorMessage } from "./error-message";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import type { components, operations } from "../contracts/standard-v1";

type Cart = components["schemas"]["Cart"];
type Review = components["schemas"]["CheckoutReview"];
type Order = components["schemas"]["Order"];
type Outcome = components["schemas"]["CheckoutOutcome"];
type ReviewInput = operations["reviewCheckout"]["requestBody"]["content"]["application/json"];
type Mode = ReviewInput["fulfilment"];
const currency = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" });
const myt = new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" });
const activeReviewKey = "sweetcommerce.activeReview";

async function api<T>(path: string, method: string, csrf: string, key?: string, body?: object): Promise<T> {
  const headers = new Headers();
  if (method !== "GET") headers.set("X-CSRF-Token", csrf);
  if (key) headers.set("Idempotency-Key", key);
  if (body) headers.set("Content-Type", "application/json");
  const response = await fetch("/api/v1/" + path, { method, headers, body: body && JSON.stringify(body), cache: "no-store" });
  if (!response.ok) {
    const issue = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(issue?.message ?? "The request could not be completed. Try again.");
  }
  return response.json() as Promise<T>;
}

export function Checkout({ cart, csrfToken }: { cart: Cart; csrfToken: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("PICKUP");
  const [pending, setPending] = useState<{ review: Review; input: ReviewInput; key: string }>();
  const [recoverId, setRecoverId] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = sessionStorage.getItem(activeReviewKey);
    if (id) setRecoverId(id);
  }, []);

  function clearReview() {
    sessionStorage.removeItem(activeReviewKey);
    setRecoverId(undefined);
    setPending(undefined);
  }

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    try {
      const time = new Date(text("handoff") + ":00+08:00");
      if (!Number.isFinite(time.getTime())) throw new Error("Choose a valid handoff time in Malaysia time.");
      const input: ReviewInput = {
        fulfilment: mode, requestedHandoffAt: time.toISOString(), cartVersion: cart.version,
        contactName: text("name"), phone: text("phone"),
        items: cart.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
      };
      if (text("email")) input.notificationEmail = text("email");
      if (mode !== "PICKUP") {
        input.address = { line1: text("address"), city: text("city"), postcode: text("postcode"), region: text("region") };
        if (text("note")) input.address.note = text("note");
      }
      const result = await api<Review>("checkout/review", "POST", csrfToken, crypto.randomUUID(), input);
      setPending({ review: result, input, key: crypto.randomUUID() });
      sessionStorage.setItem(activeReviewKey, result.reviewId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not review the order.");
    } finally {
      setBusy(false);
    }
  }

  async function finish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) return;
    const method = new FormData(event.currentTarget).get("payment");
    if (method !== "CASH" && method !== "DUITNOW") return;
    setBusy(true);
    setError("");
    try {
      const { input, review: current, key } = pending;
      const result = await api<Order>("orders", "POST", csrfToken, key, {
        ...input, termsVersion: current.termsVersion, reviewId: current.reviewId, paymentMethod: method,
      });
      clearReview();
      router.replace("/orders/" + result.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Check the review outcome before trying again.");
    } finally {
      setBusy(false);
    }
  }

  async function resolve() {
    const id = recoverId ?? pending?.review.reviewId;
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      const outcome = await api<Outcome>("checkout/reviews/" + id + "/abandon", "POST", csrfToken, crypto.randomUUID());
      clearReview();
      if (outcome.orderId) router.replace("/orders/" + outcome.orderId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not check the earlier review.");
    } finally {
      setBusy(false);
    }
  }

  const data = pending?.review;
  if (!data && !recoverId && (!cart.lines.length || cart.lines.some((line) => !line.available))) {
    return <p>Return to the cart and select available desserts before checking out.</p>;
  }

  return (
    <>
      <ol className="checkout-steps" aria-label="Checkout progress">
        <li aria-current={!data && !recoverId ? "step" : undefined}>1. Handoff details</li>
        <li aria-current={data || recoverId ? "step" : undefined}>2. Review and submit</li>
      </ol>
      {recoverId && !data && (
        <div>
          <p>An earlier checkout review is still recorded. Check its outcome before starting a new review.</p>
          <button disabled={busy} type="button" onClick={() => void resolve()}>Resolve earlier checkout</button>
        </div>
      )}
      <form className="surface form-stack" onSubmit={review} hidden={Boolean(data || recoverId)}>
        <label htmlFor="handoff">Requested handoff (Malaysia time)</label><DateInput id="handoff" name="handoff" type="datetime-local" required />
        <label htmlFor="fulfilment">Handoff method</label>
        <Select id="fulfilment" value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
          <option value="PICKUP">Self pickup</option>
          <option value="MERCHANT_LALAMOVE">Merchant arranges Lalamove</option>
          <option value="CUSTOMER_LALAMOVE">I arrange and pay Lalamove directly</option>
        </Select>
        <label htmlFor="contact-name">Contact name</label><input id="contact-name" name="name" required maxLength={120} />
        <label htmlFor="contact-phone">Contact phone</label><input id="contact-phone" name="phone" type="tel" required maxLength={24} />
        <label htmlFor="notice-email">Notification email (optional)</label><input id="notice-email" name="email" type="email" maxLength={254} />
        {mode !== "PICKUP" && (
          <>
            <label htmlFor="address">Delivery address</label><input id="address" name="address" required maxLength={200} />
            <label htmlFor="city">City</label><input id="city" name="city" required maxLength={100} />
            <label htmlFor="postcode">Postcode</label><input id="postcode" name="postcode" required maxLength={20} />
            <label htmlFor="region">State or region</label><input id="region" name="region" required maxLength={100} />
            <label htmlFor="note">Delivery note (optional)</label><input id="note" name="note" maxLength={300} />
          </>
        )}
        <button disabled={busy} type="submit">{busy ? "Checking availability…" : "Review checkout"}</button>
      </form>
      {data && (
        <section>
          <h2>Review before submitting</h2>
          <p>{data.contactName} · {data.phone}{data.notificationEmail && " · " + data.notificationEmail}</p>
          <p>{data.pickupDisplay ?? (data.address && [data.address.line1, data.address.city, data.address.postcode, data.address.region].join(", "))}</p>
          <p>{myt.format(new Date(data.requestedHandoffAt))} MYT</p>
          <ul className="item-list">{data.items.map((item) => (
            <li key={item.variantId}>{item.quantity} × {item.product} · {item.variant} · {item.flavour} · {currency.format(item.unitMinor / 100)} each</li>
          ))}</ul>
          <p>Subtotal {currency.format(data.subtotalMinor / 100)} · {data.feeMinor === null ? "Delivery fee awaiting merchant" : "Fee " + currency.format(data.feeMinor / 100)}</p>
          {data.totalMinor !== null && <p><strong>Total {currency.format(data.totalMinor / 100)}</strong></p>}
          <p>{data.instructions}</p>
          <p>{data.termsText}</p>
          {!data.eligible && <ErrorMessage>This selection cannot be committed. Review the items and available handoff times.</ErrorMessage>}
          {data.lineIssues.length > 0 && <ul>{data.lineIssues.map((issue) => <li key={issue.variantId}>{issue.reason}</li>)}</ul>}
          {data.alternatives.length > 0 && <ul>{data.alternatives.map((time) => <li key={time}>{myt.format(new Date(time))} MYT</li>)}</ul>}
          {data.eligible && (
            <form className="form-stack" onSubmit={finish}>
              <label htmlFor="payment">Payment method</label>
              <Select id="payment" name="payment" defaultValue={data.paymentMethods[0]} required>
                {data.paymentMethods.map((method) => <option key={method} value={method}>{method === "CASH" ? "Cash at pickup" : "DuitNow"}</option>)}
              </Select>
              <label><input type="checkbox" required /> I agree to the reviewed terms.</label>
              <button disabled={busy || !data.paymentMethods.length} type="submit">{busy ? "Submitting…" : "Submit order"}</button>
            </form>
          )}
          <button disabled={busy} type="button" onClick={() => void resolve()}>Resolve or replace this review</button>
        </section>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </>
  );
}
