"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

export const errorRailId = "site-error-messages";
const messageDurationMs = 5_000;

export function ErrorMessage({ children, focus = false }: { children: ReactNode; focus?: boolean }) {
  const [rail, setRail] = useState<HTMLElement | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const message = useRef<HTMLDivElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const container = useRef<HTMLDivElement>(null);

  function dismiss() {
    // Only restore focus when dismissing the message would otherwise strand it.
    if (container.current?.contains(document.activeElement)) {
      const previous = priorFocus.current;
      if (previous?.isConnected && previous !== document.body) previous.focus({ preventScroll: true });
      else document.getElementById("page-content")?.focus({ preventScroll: true });
    }
    setDismissed(true);
  }

  useEffect(() => {
    priorFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRail(document.getElementById(errorRailId));
    const timeout = window.setTimeout(dismiss, messageDurationMs);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (focus && rail) message.current?.focus({ preventScroll: true });
  }, [focus, rail]);

  if (dismissed) return null;
  const notice = <div ref={container} className={`site-error${rail ? "" : " site-error-fallback"}`}>
    <div className="site-error-content" role="alert" tabIndex={-1} ref={message}>{children}</div>
    <button className="site-error-dismiss" type="button" aria-label="Dismiss error" title="Close message" onClick={dismiss}>
      <Icon name="close" size={20} />
    </button>
  </div>;
  return rail ? createPortal(notice, rail) : notice;
}
