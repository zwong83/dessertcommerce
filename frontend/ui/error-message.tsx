"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const errorRailId = "site-error-messages";

export function ErrorMessage({ children, focus = false }: { children: ReactNode; focus?: boolean }) {
  const [rail, setRail] = useState<HTMLElement | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const message = useRef<HTMLDivElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    priorFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRail(document.getElementById(errorRailId));
  }, []);

  useEffect(() => {
    if (focus && rail) message.current?.focus({ preventScroll: true });
  }, [focus, rail]);

  if (dismissed) return null;
  const notice = <div className={`site-error${rail ? "" : " site-error-fallback"}`}>
    <div className="site-error-content" role="alert" tabIndex={-1} ref={message}>{children}</div>
    <button className="site-error-dismiss" type="button" aria-label="Dismiss error" onClick={() => {
      setDismissed(true);
      const previous = priorFocus.current;
      if (previous?.isConnected && previous !== document.body) previous.focus({ preventScroll: true });
      else document.getElementById("page-content")?.focus({ preventScroll: true });
    }}>×</button>
  </div>;
  return rail ? createPortal(notice, rail) : notice;
}
