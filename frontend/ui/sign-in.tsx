"use client";

import { ErrorMessage } from "./error-message";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type { components } from "../contracts/standard-v1";
import { authPost } from "./auth-api";

type Challenge = components["schemas"]["Challenge"];
type Mode = "merchant" | "recovery";

export function SignIn({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      setChallenge(await authPost<Challenge>("admin/auth/challenges", {
        verifiedContact: contact, purpose: mode === "recovery" ? "RECOVERY" : "SIGN_IN",
      }));
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
      await authPost("admin/auth/sign-in", {
        challengeId: challenge.challengeId, code,
      });
      router.replace("/merchant");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not verify the code.");
      setBusy(false);
    }
  }

  return (
    <>
      {!challenge ? (
        <form className="form-stack" onSubmit={requestCode}>
          <label htmlFor="contact">Enrolled phone or email</label>
          <input id="contact" type="text" required autoComplete="username" value={contact} maxLength={254}
            onChange={(event) => setContact(event.target.value)} />
          <button disabled={busy} type="submit">{busy ? "Requesting…" : "Request a code"}</button>
        </form>
      ) : (
        <>
          <p role="status">If this contact can receive verification, a code has been requested.</p>
          <form className="form-stack" onSubmit={verify}>
            <label htmlFor="verification-code">Six-digit verification code</label>
            <input id="verification-code" inputMode="numeric" autoComplete="one-time-code" autoFocus required
              pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
            <button disabled={busy} type="submit">{busy ? "Verifying…" : "Verify and sign in"}</button>
          </form>
          <form onSubmit={requestCode}>
            <button className="button-quiet" disabled={busy} type="submit">Request a new code</button>
            <button className="button-quiet" disabled={busy} type="button" onClick={() => { setChallenge(null); setError(""); }}>Change contact</button>
          </form>
        </>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </>
  );
}
