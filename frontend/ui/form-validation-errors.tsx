"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ErrorMessage } from "./error-message";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Issue = { field: Field; message: string; sequence: number };

function isField(value: EventTarget | null): value is Field {
  return value instanceof HTMLInputElement || value instanceof HTMLSelectElement || value instanceof HTMLTextAreaElement;
}

export function FormValidationErrors() {
  const path = usePathname();
  const sequence = useRef(0);
  const [issue, setIssue] = useState<Issue | null>(null);

  useEffect(() => {
    setIssue(null);
    let reset: number | undefined;
    let focus: number | undefined;
    function invalid(event: Event) {
      const field = event.target;
      if (!isField(field) || !field.form || !field.validationMessage) return;
      event.preventDefault();
      // A single submit can dispatch invalid on several fields. Start with the first one.
      if (reset !== undefined) return;
      reset = window.setTimeout(() => { reset = undefined; }, 0);
      const label = field.labels?.[0]?.textContent?.trim().replace(/\s+/g, " ");
      setIssue({ field, message: label ? `${label}: ${field.validationMessage}` : field.validationMessage, sequence: ++sequence.current });
      focus = window.requestAnimationFrame(() => field.focus());
    }
    function corrected(event: Event) {
      const field = event.target;
      if (isField(field) && field.validity.valid) setIssue(current => current?.field === field ? null : current);
    }
    document.addEventListener("invalid", invalid, true);
    document.addEventListener("input", corrected);
    document.addEventListener("change", corrected);
    return () => {
      document.removeEventListener("invalid", invalid, true);
      document.removeEventListener("input", corrected);
      document.removeEventListener("change", corrected);
      window.clearTimeout(reset);
      if (focus !== undefined) window.cancelAnimationFrame(focus);
    };
  }, [path]);

  useEffect(() => {
    if (!issue) return;
    const observer = new MutationObserver(() => {
      if (!issue.field.isConnected) setIssue(current => current === issue ? null : current);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [issue]);

  return issue ? <ErrorMessage key={issue.sequence}>{issue.message}</ErrorMessage> : null;
}
