"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function Logout({ csrfToken, login }: { csrfToken: string; login: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "sending" | "failed">("idle");

  async function logout() {
    setStatus("sending");
    try {
      const response = await fetch("/api/v1/session/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken } });
      if (!response.ok && response.status !== 401) throw new Error("Logout failed.");
      sessionStorage.removeItem("sweetcommerce.activeReview");
      router.replace(login);
      router.refresh();
    } catch {
      setStatus("failed");
    }
  }

  return (
    <>
      <button type="button" disabled={status === "sending"} onClick={logout}>Sign out</button>
      {status === "failed" && <p role="alert">Could not sign out. Try again.</p>}
    </>
  );
}
