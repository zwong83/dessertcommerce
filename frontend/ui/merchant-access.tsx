"use client";

import type { CountryCode } from "libphonenumber-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { AccountPhone, internationalPhone } from "./account-phone";
import { authPost } from "./auth-api";
import { meetsPasswordRules, PasswordChecklist, usernamePattern } from "./customer-password-policy";
import { ErrorMessage } from "./error-message";
import { Icon } from "./icons";
import { PasswordField } from "./password-field";
import { SignIn } from "./sign-in";

type View = "login" | "code";

export function MerchantAccess({ codeAuthenticationEnabled }: { codeAuthenticationEnabled: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<View>("login");
  const [country, setCountry] = useState<CountryCode>("MY");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signingUp = Boolean(setupToken);
  const meetsRules = meetsPasswordRules(password);

  useEffect(() => {
    function openSetupLink() {
      const token = new URLSearchParams(window.location.hash.slice(1)).get("setup");
      if (!token) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setSetupToken(token);
      setView("login");
      setPassword("");
      setError("");
    }

    openSetupLink();
    window.addEventListener("hashchange", openSetupLink);
    return () => window.removeEventListener("hashchange", openSetupLink);
  }, []);

  function choose(next: View) {
    setView(next);
    setError("");
    setSetupToken("");
    setPhone("");
    setPassword("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");
    setBusy(true);
    try {
      if (signingUp) {
        if (!meetsRules || password !== data.get("confirmPassword")) {
          throw new Error(meetsRules ? "Passwords do not match." : "Meet all five password requirements before continuing.");
        }
        const number = internationalPhone(phone, country);
        if (!number) throw new Error("Check the country code and phone number.");
        const email = String(data.get("email")).trim();
        const registration = { name: String(data.get("name")).trim(), username: String(data.get("username")).trim(),
          password, ...(email ? { email } : {}) };
        await authPost("admin/auth/registration/link", { setupToken, registration, phone: number });
      } else {
        await authPost("admin/auth/password", { username: String(data.get("username")).trim(), password: data.get("password") });
      }
      router.replace("/merchant");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="customer-access">
    <h1>{signingUp ? "Set up your merchant account" : "Merchant sign-in"}</h1>
    {view === "code" ? <>
      <p className="auth-hint">Use the phone number or email enrolled for your merchant account.</p>
      <SignIn mode="merchant" />
      <button type="button" className="auth-method-link" onClick={() => choose("login")}>Log in with username instead</button>
    </> : <>
      {signingUp && <p className="auth-hint">Use your enrolled merchant phone number to set up your login.</p>}
      <form className="form-stack" key={signingUp ? "setup" : "login"} onSubmit={submit}>
        {signingUp && <>
          <label htmlFor="merchant-name">Display name</label>
          <input id="merchant-name" name="name" autoComplete="nickname" maxLength={120} required />
        </>}
        <label htmlFor="merchant-username">Username</label>
        <input id="merchant-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
          minLength={3} maxLength={32} pattern={usernamePattern} required />
        {signingUp ? <>
          <AccountPhone id="merchant-phone" country={country} onCountryChange={setCountry} value={phone} onChange={setPhone} />
          <label htmlFor="merchant-email">Email <small>(optional)</small></label>
          <input id="merchant-email" name="email" type="email" autoComplete="email" maxLength={254} />
        </> : codeAuthenticationEnabled && <button type="button" className="auth-method-link" disabled={busy} onClick={() => choose("code")}>
          Log in with a code instead
        </button>}
        <PasswordField id="merchant-password" name="password" label="Password" required maxLength={128}
          autoComplete={signingUp ? "new-password" : "current-password"}
          aria-describedby={signingUp ? "merchant-password-help" : undefined}
          value={signingUp ? password : undefined} onChange={signingUp ? event => setPassword(event.target.value) : undefined} />
        {signingUp && <>
          <PasswordChecklist id="merchant-password-help" password={password} />
          <PasswordField id="merchant-confirm-password" name="confirmPassword" label="Confirm Password"
            autoComplete="new-password" maxLength={128} required disabled={!meetsRules} />
        </>}
        <button type="submit" className={signingUp ? "account-signup-submit" : undefined} disabled={busy}>
          {busy ? "Please wait…" : signingUp ? "Sign up" : "Log in"}
          <Icon name="arrow" size={16} />
        </button>
      </form>
      {signingUp && <button type="button" className="auth-method-link" disabled={busy} onClick={() => choose("login")}>
        Back to log in
      </button>}
    </>}
    {!signingUp && codeAuthenticationEnabled && <p><Link href="/merchant/recover">Recover merchant access</Link></p>}
    {error && <ErrorMessage>{error}</ErrorMessage>}
  </div>;
}
