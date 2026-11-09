"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type { components } from "../contracts/standard-v1";

type Challenge = components["schemas"]["Challenge"];
type Mode = "customer" | "merchant" | "recovery";

async function submit<T>(path: string, payload: Record<string, string>): Promise<T> {
  const response = await fetch("/api/v1/" + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(error?.message ?? "The service is temporarily unavailable. Try again.");
  }
  return response.json() as Promise<T>;
}

export function SignIn({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const customer = mode === "customer";

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const path = customer ? "auth/otp/challenges" : "admin/auth/challenges";
      const payload: Record<string, string> = customer
        ? { phone: contact }
        : { verifiedContact: contact, purpose: mode === "recovery" ? "RECOVERY" : "SIGN_IN" };
      setChallenge(await submit<Challenge>(path, payload));
      setCode("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not request a code.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    setError("");
    setBusy(true);
    try {
      await submit(customer ? "auth/otp/verify" : "admin/auth/sign-in", {
        challengeId: challenge.challengeId, code,
      });
      router.replace(customer ? "/shop" : "/merchant");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not verify the code.");
      setBusy(false);
    }
  }

  return (
    <>
      {!challenge ? (
        <form onSubmit={requestCode}>
          <label htmlFor="contact">{customer ? "Phone number with country code" : "Enrolled phone or email"}</label>
          <input id="contact" type={customer ? "tel" : "text"} required autoComplete={customer ? "tel" : "username"}
            placeholder={customer ? "+60…" : undefined} value={contact} maxLength={customer ? 16 : 254}
            onChange={(event) => setContact(event.target.value)} />
          <button disabled={busy} type="submit">{busy ? "Requesting…" : "Request a code"}</button>
        </form>
      ) : (
        <>
          <p role="status">If this contact can receive verification, a code has been requested.</p>
          <form onSubmit={verify}>
            <label htmlFor="verification-code">Six-digit verification code</label>
            <input id="verification-code" inputMode="numeric" autoComplete="one-time-code" autoFocus required
              pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
            <button disabled={busy} type="submit">{busy ? "Verifying…" : "Verify and sign in"}</button>
          </form>
          <form onSubmit={requestCode}>
            <button disabled={busy} type="submit">Request a new code</button>
            <button disabled={busy} type="button" onClick={() => { setChallenge(null); setError(""); }}>Change contact</button>
          </form>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
