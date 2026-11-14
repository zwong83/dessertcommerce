"use client";

import type { CountryCode } from "libphonenumber-js";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { components } from "../contracts/customer-auth-v1";
import { Icon } from "./icons";
import { authPost } from "./auth-api";
import { AccountPhone, internationalPhone } from "./account-phone";
import { meetsPasswordRules, PasswordChecklist, usernamePattern } from "./customer-password-policy";
import { ErrorMessage } from "./error-message";
import { PasswordField } from "./password-field";

type Intent = "login" | "signup";
type Method = "phone" | "password";
type Destination = "/shop" | "/events" | "/events/new" | "/profile";
type Challenge = components["schemas"]["Challenge"] & { phone: string };
type Registration = components["schemas"]["Registration"];
const signupPasswordError = "Meet all five password requirements before continuing.";

export function CustomerAccess({ destination, customerPhoneVerification }: {
  destination: Destination;
  customerPhoneVerification: boolean;
}) {
  const router = useRouter();
  const [intent, setIntent] = useState<Intent>("login");
  const [method, setMethod] = useState<Method>("password");
  const [country, setCountry] = useState<CountryCode>("MY");
  const [phone, setPhone] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const [now, setNow] = useState(0);
  const loginField = useRef<HTMLInputElement>(null);
  const focusAfterSwitch = useRef(false);
  const signingUp = intent === "signup";
  const usesPassword = !signingUp && (!customerPhoneVerification || method === "password");
  const canConfirmPassword = meetsPasswordRules(signupPassword);

  useEffect(() => {
    if (!challenge) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [challenge]);

  useEffect(() => {
    if (!focusAfterSwitch.current) return;
    focusAfterSwitch.current = false;
    loginField.current?.focus();
  }, [method]);

  function resetCode() {
    setChallenge(null);
    setCode("");
    setError("");
    setPasswordMismatch(false);
  }

  function chooseIntent(next: Intent) {
    if (next === intent) return;
    setIntent(next);
    setMethod("password");
    setRegistration(null);
    setSignupPassword("");
    resetCode();
  }

  function switchLoginMethod() {
    focusAfterSwitch.current = true;
    setMethod(usesPassword ? "phone" : "password");
    resetCode();
  }

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setPasswordMismatch(false);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function requestCode(phoneNumber: string) {
    const result = await authPost<components["schemas"]["Challenge"]>("auth/customer/otp/challenges", { phone: phoneNumber, intent });
    setChallenge({ ...result, phone: phoneNumber });
    setCode("");
    setNow(Date.now());
  }

  function onDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (usesPassword) {
      void perform(async () => {
        await authPost("auth/customer/password", { username: String(data.get("username")).trim(), password: String(data.get("password")) });
        finish();
      });
      return;
    }
    const phoneNumber = internationalPhone(String(data.get("phone") ?? ""), country);
    if (!phoneNumber) {
      setError("Check the country code and phone number.");
      const phoneInput = event.currentTarget.elements.namedItem("phone");
      if (phoneInput instanceof HTMLInputElement) phoneInput.focus();
      return;
    }
    if (signingUp) {
      const password = String(data.get("password"));
      if (!meetsPasswordRules(password)) {
        setError(signupPasswordError);
        const passwordInput = event.currentTarget.elements.namedItem("password");
        if (passwordInput instanceof HTMLInputElement) passwordInput.focus();
        return;
      }
      if (password !== data.get("confirmPassword")) {
        setPasswordMismatch(true);
        setError("Passwords do not match. Enter the same password in Confirm Password.");
        const confirmation = event.currentTarget.elements.namedItem("confirmPassword");
        if (confirmation instanceof HTMLInputElement) confirmation.focus();
        return;
      }
      const email = String(data.get("email")).trim();
      const details: Registration = {
        name: String(data.get("name")).trim(), ...(email ? { email } : {}),
        username: String(data.get("username")).trim(), password,
      };
      if (!customerPhoneVerification) {
        void perform(async () => {
          await authPost("auth/customer/registration", { registration: details, phone: phoneNumber });
          finish();
        });
        return;
      }
      setRegistration(details);
    }
    void perform(() => requestCode(phoneNumber));
  }

  function finish() {
    setRegistration(null);
    setSignupPassword("");
    router.replace(destination);
    router.refresh();
  }

  function clearPasswordMismatch() {
    if (!passwordMismatch) return;
    setPasswordMismatch(false);
    setError("");
  }

  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge || (signingUp && !registration)) return;
    void perform(async () => {
      await authPost("auth/customer/otp/verify", {
        intent, challengeId: challenge.challengeId, code, ...(registration ? { registration } : {}),
      });
      finish();
    });
  }

  const resendIn = challenge ? Math.max(0, Math.ceil((Date.parse(challenge.resendAt) - now) / 1000)) : 0;
  const expired = challenge !== null && Date.parse(challenge.expiresAt) <= now;
  const loginMethodButton = customerPhoneVerification && !signingUp && (
    <button className="auth-method-link" type="button" disabled={busy} onClick={switchLoginMethod}>
      {usesPassword ? "Log in with phone instead" : "Log in with username instead"}
    </button>
  );

  return <div className="customer-access">
    <div className="auth-options" role="group" aria-label="Account access">
      <button type="button" aria-pressed={!signingUp} disabled={busy} onClick={() => chooseIntent("login")}>Log in</button>
      <button type="button" aria-pressed={signingUp} disabled={busy} onClick={() => chooseIntent("signup")}>Sign up</button>
    </div>
    <h1>{signingUp ? "Create your account" : "Log in to your account"}</h1>
    {(!signingUp || customerPhoneVerification) && <p className="auth-hint">
      {signingUp ? "Add your details, then verify your phone number."
        : usesPassword ? "Enter your username and password." : "We’ll send a verification code to your phone."}
    </p>}
    {!challenge ? <form className="form-stack" key={`${intent}:${method}`} onSubmit={onDetails}>
      {signingUp && <>
        <label htmlFor="account-name">Display name</label>
        <input id="account-name" name="name" autoComplete="nickname" maxLength={120} required defaultValue={registration?.name} />
      </>}
      {(signingUp || usesPassword) && <>
        <label htmlFor="account-username">Username</label>
        <input id="account-username" ref={usesPassword ? loginField : undefined} name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
          minLength={3} maxLength={32} pattern={usernamePattern} required defaultValue={registration?.username} />
      </>}
      {!usesPassword && <AccountPhone id="account-phone" country={country} onCountryChange={setCountry}
        value={phone} onChange={setPhone} inputRef={signingUp ? undefined : loginField} />}
      {loginMethodButton}
      {signingUp && <>
        <label htmlFor="account-email">Email <small>(optional)</small></label>
        <input id="account-email" type="email" name="email" autoComplete="email" maxLength={254} defaultValue={registration?.email} />
      </>}
      {(signingUp || usesPassword) && <>
        <PasswordField id="account-password" name="password" label="Password" autoComplete={signingUp ? "new-password" : "current-password"}
          maxLength={128} required aria-describedby={signingUp ? "password-help" : undefined}
          value={signingUp ? signupPassword : undefined} onChange={signingUp ? event => {
            setSignupPassword(event.target.value);
            clearPasswordMismatch();
            if (error === signupPasswordError) setError("");
          } : undefined} />
        {signingUp && <>
          <PasswordChecklist id="password-help" password={signupPassword} />
          <PasswordField id="account-confirm-password" name="confirmPassword" label="Confirm Password" autoComplete="new-password" maxLength={128}
            required disabled={!canConfirmPassword} aria-invalid={passwordMismatch || undefined} onChange={clearPasswordMismatch} />
        </>}
      </>}
      <button type="submit" className={signingUp ? "account-signup-submit" : undefined} disabled={busy}>
        {usesPassword ? (busy ? "Logging in…" : "Log in")
          : signingUp && !customerPhoneVerification ? (busy ? "Signing up…" : "Sign up")
            : (busy ? "Requesting…" : "Send verification code")}
        <Icon name="arrow" size={16} />
      </button>
    </form> : <>
      {expired ? <ErrorMessage>This code has expired. Request a new one.</ErrorMessage>
        : <p className="auth-hint" role="status">Enter the six-digit code for the phone ending in {challenge.phone.slice(-4)}.</p>}
      <form className="form-stack" onSubmit={verify}>
        <label htmlFor="account-code">Verification code</label>
        <input id="account-code" autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
          required value={code} onChange={event => setCode(event.target.value)} />
        <button type="submit" disabled={busy || expired}>{busy ? "Please wait…" : signingUp ? "Verify and create account" : "Verify and log in"}</button>
      </form>
      <div className="actions">
        <button className="button-quiet" type="button" disabled={busy || resendIn > 0} onClick={() => void perform(() => requestCode(challenge.phone))}>
          {resendIn ? `Resend in ${resendIn}s` : "Resend code"}
        </button>
        <button className="button-quiet" type="button" disabled={busy} onClick={resetCode}>{signingUp ? "Edit details" : "Change phone"}</button>
        {loginMethodButton}
      </div>
    </>}
    {error && <ErrorMessage>{error}</ErrorMessage>}
  </div>;
}
