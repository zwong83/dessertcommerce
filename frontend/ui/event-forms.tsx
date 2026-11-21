"use client";

import { ErrorMessage } from "./error-message";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ComponentProps, type FormEvent, type ReactNode } from "react";
import type { operations } from "../contracts/commercial-v1";
import { prepareMutation, readStandard, sendStandard, StandardProblem, type PreparedMutation } from "./standard-api";
import { Field } from "./standard-forms";
import type { Session } from "./standard-model";
import { mytFormValue, type EventInput, type EventSchedule } from "./event-model";

type ResponseBody<T> = T extends { content: { "application/json": infer V } } ? V : never;
type EventResult<K extends keyof operations> = ResponseBody<
  operations[K]["responses"][Extract<keyof operations[K]["responses"], 200 | 201>]
>;
type Task = {
  send: (token: string) => Promise<string>;
  refresh: boolean;
  recover?: () => Promise<string | undefined>;
  rejected?: () => void;
};

export function useEventCommands(session: Session) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [sending, setSending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [pending, setPending] = useState<Task>();
  const [notice, setNotice] = useState<{ message: string; problem?: StandardProblem; error?: boolean }>();

  function showError(error: unknown) {
    setNotice({ error: true, message: error instanceof Error ? error.message : "Check the form and try again." });
  }

  async function execute(task: Task, retry: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setNotice(undefined);
    let dispatched = false;
    try {
      let token = session.csrfToken;
      if (retry) {
        const active = await readStandard<"getSession">("session");
        if (active.accountId !== session.accountId || active.role !== session.role) throw new StandardProblem(403, null);
        token = active.csrfToken;
      }
      const recovered = retry ? await task.recover?.() : undefined;
      dispatched = true;
      const message = recovered ?? await task.send(token);
      setPending(undefined);
      setNotice({ message });
      if (task.refresh) refresh();
    } catch (error) {
      if (error instanceof StandardProblem) {
        const retryable = error.uncertain || (retry && (!dispatched || error.denied || error.status === 429));
        if (retryable) setPending(task);
        else {
          setPending(undefined);
          task.rejected?.();
        }
        setNotice({
          error: true, problem: error,
          message: error.denied ? "Your current session cannot complete this action."
            : retryable ? "The result is uncertain. Retry the same request to recover its outcome." : error.message,
        });
        if (error.stale) refresh();
      } else {
        setPending(undefined);
        showError(error);
      }
    } finally {
      setSending(false);
      inFlight.current = false;
    }
  }

  function send<T>(mutation: PreparedMutation, success: (value: T) => string, options?: Pick<Task, "recover" | "rejected"> & { refresh?: boolean }) {
    if (inFlight.current || pending || refreshing) return;
    void execute({
      ...options, refresh: options?.refresh ?? true,
      send: async token => success(await sendStandard<T>(mutation, token)),
    }, false);
  }

  function json<K extends keyof operations>(
    path: string, version: number | undefined, body: EventInput<K>, success: (value: EventResult<K>) => string,
  ) {
    send(prepareMutation({ path, version, json: body }), success);
  }

  function refresh() {
    startRefresh(() => router.refresh());
  }

  return {
    busy: sending || refreshing, locked: sending || refreshing || !!pending, notice,
    login: session.role === "ADMIN" ? "/merchant/login" : "/login",
    json, send, showError, refresh, retry: pending ? () => void execute(pending, true) : undefined,
  };
}

export type EventCommands = ReturnType<typeof useEventCommands>;

export function EventFeedback({ commands }: { commands: EventCommands }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (commands.notice && !commands.notice.error) ref.current?.focus();
  }, [commands.notice]);
  const Feedback = commands.notice?.error ? ErrorMessage : "div";
  const feedbackProps = commands.notice?.error ? { focus: true } : { ref, tabIndex: -1, role: "status" };
  return <>
    {commands.busy && <p role="status">Working…</p>}
    {commands.notice && <Feedback key={commands.notice.message} {...feedbackProps}>
      <p>{commands.notice.message}</p>
      {commands.notice.problem?.problem?.requestId && <p>Reference {commands.notice.problem.problem.requestId}</p>}
      {commands.notice.problem?.stale && <p>Review the refreshed details before confirming again.</p>}
      {commands.notice.problem?.denied && <p><Link href={commands.login} target="_blank" rel="noopener">Open sign-in in a new tab</Link></p>}
    </Feedback>}
    {commands.retry && <p><button type="button" onClick={commands.retry} disabled={commands.busy}>Retry the same request</button></p>}
  </>;
}

export function EventForm({ commands, legend, submit, children, onSubmit, className, submitHint }: {
  commands: EventCommands;
  legend: string;
  submit: string;
  className?: string;
  submitHint?: string;
  children: ReactNode;
  onSubmit: (data: FormData, form: HTMLFormElement) => void;
}) {
  function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (commands.locked) return;
    try {
      onSubmit(new FormData(event.currentTarget), event.currentTarget);
    } catch (error) {
      commands.showError(error);
    }
  }
  return <form onSubmit={handle} className={className}>
    <fieldset className="surface" disabled={commands.locked} style={{ minWidth: 0, width: "100%" }}>
      <legend>{legend}</legend>
      {children}
      {submitHint ? <div className="event-request-submit">
        <p><button type="submit">{commands.busy ? "Working…" : submit}</button></p>
        <p>{submitHint}</p>
      </div> : <p><button type="submit">{commands.busy ? "Working…" : submit}</button></p>}
    </fieldset>
  </form>;
}

export function EventField({ initial = "", ...props }: Omit<ComponentProps<typeof Field>, "onChange" | "value" | "defaultValue"> & { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <Field {...props} value={value} onChange={event => setValue(event.target.value)} />;
}

export function EventTextArea({ name, children, max, initial = "" }: { name: string; children: ReactNode; max: number; initial?: string }) {
  const [value, setValue] = useState(initial);
  return <p><label>{children}<br />
    <textarea name={name} required rows={3} maxLength={max} value={value} onChange={event => setValue(event.target.value)}
      className="full-width-field" />
  </label></p>;
}

export function EventTimeField({ name, children, initial }: { name: string; children: ReactNode; initial?: string }) {
  return <EventField name={name} initial={initial && mytFormValue(initial)} type="datetime-local" required>{children} (MYT)</EventField>;
}

export function ScheduleFields({ initial }: { initial?: Partial<EventSchedule> }) {
  return <>
    <EventTimeField name="setupReadyAt" initial={initial?.setupReadyAt}>Setup ready</EventTimeField>
    <EventTimeField name="eventStartAt" initial={initial?.eventStartAt}>Event start</EventTimeField>
    <EventTimeField name="eventEndAt" initial={initial?.eventEndAt}>Event end</EventTimeField>
    <EventTimeField name="teardownAt" initial={initial?.teardownAt}>Teardown</EventTimeField>
  </>;
}

export function WindowFields({ initial }: { initial?: { startAt: string; endAt: string } }) {
  return <>
    <p>Include the full window you need for setup through teardown.</p>
    <EventTimeField name="windowStartAt" initial={initial?.startAt}>Resource window start</EventTimeField>
    <EventTimeField name="windowEndAt" initial={initial?.endAt}>Resource window end</EventTimeField>
  </>;
}

export function useEventDeadline(deadline: string | null, inclusive = true) {
  const [elapsed, setElapsed] = useState<string | null>(null);
  useEffect(() => {
    if (!deadline) return;
    let timer: ReturnType<typeof setTimeout>;
    const cutoff = Date.parse(deadline) + (inclusive ? 0 : 1);
    function check() {
      const delay = cutoff - Date.now();
      if (delay <= 0) setElapsed(deadline);
      else timer = setTimeout(check, Math.min(delay, 2_147_483_647));
    }
    check();
    return () => clearTimeout(timer);
  }, [deadline, inclusive]);
  return deadline !== null && deadline === elapsed;
}
