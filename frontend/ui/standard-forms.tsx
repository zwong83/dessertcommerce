"use client";

import { ErrorMessage } from "./error-message";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import type { operations } from "../contracts/standard-v1";
import { prepareMutation, readStandard, sendStandard, StandardProblem, type JsonCommand, type CommandResult, type PreparedMutation } from "./standard-api";
import type { Proof, Session } from "./standard-model";

type Task = {
  finish: (csrfToken: string) => Promise<string>;
  refresh: boolean;
};

export function useStandardCommands(session: Session) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [sending, setSending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [retry, setRetry] = useState<Task>();
  const [notice, setNotice] = useState<{ message: string; problem?: StandardProblem; error?: boolean }>();
  const login = session.role === "ADMIN" ? "/merchant/login" : "/login";

  async function execute(task: Task, replay: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setNotice(undefined);
    let sent = false;
    try {
      let token = session.csrfToken;
      if (replay) {
        const active = await readStandard<"getSession">("session");
        if (active.accountId !== session.accountId || active.role !== session.role) {
          setRetry(undefined);
          throw new StandardProblem(403, null);
        }
        token = active.csrfToken;
      }
      sent = true;
      const message = await task.finish(token);
      setRetry(undefined);
      setNotice({ message });
      if (task.refresh) startRefresh(() => router.refresh());
    } catch (error) {
      if (error instanceof StandardProblem) {
        if (sent) setRetry(error.uncertain || (replay && (error.status === 429 || error.denied)) ? task : undefined);
        setNotice({
          problem: error,
          error: true,
          message: error.denied ? "Your current session cannot complete this action."
            : error.uncertain && (sent || replay) ? "The result is uncertain. Retry the same request to recover its outcome."
              : error.message,
        });
        if (error.stale || error.denied && !replay) startRefresh(() => router.refresh());
      } else {
        setRetry(undefined);
        showError(error);
      }
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  function run<T>(mutation: PreparedMutation, onSuccess: (result: T) => string, refresh: boolean) {
    if (inFlight.current || retry || refreshing) return;
    const finish = async (token: string) => onSuccess(await sendStandard<T>(mutation, token));
    void execute({ finish, refresh }, false);
  }

  function json<K extends keyof operations>(input: JsonCommand<K>, onSuccess: (result: CommandResult<K>) => string, refresh = true) {
    run(prepareMutation(input), onSuccess, refresh);
  }

  function upload(path: string, file: File, onSuccess: (result: Proof) => string) {
    run(prepareMutation({ path, file }), onSuccess, true);
  }

  function showError(error: unknown) {
    setNotice({ message: error instanceof Error ? error.message : "Check the form and try again.", error: true });
  }

  return {
    busy: sending || refreshing,
    locked: sending || refreshing || retry !== undefined,
    notice, login,
    retry: retry ? () => void execute(retry, true) : undefined,
    json, upload, showError,
    refresh: () => startRefresh(() => router.refresh()),
  };
}

export type StandardCommands = ReturnType<typeof useStandardCommands>;

export function CommandFeedback({ commands }: { commands: StandardCommands }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (commands.notice && !commands.notice.error) ref.current?.focus();
  }, [commands.notice]);

  const Feedback = commands.notice?.error ? ErrorMessage : "div";
  const feedbackProps = commands.notice?.error ? { focus: true } : { ref, tabIndex: -1, role: "status" };
  return (
    <>
      {commands.busy && <p role="status">Working…</p>}
      {commands.notice && (
        <Feedback key={commands.notice.message} {...feedbackProps}>
          <p>{commands.notice.message}</p>
          {commands.notice.problem?.problem?.requestId && <p>Reference {commands.notice.problem.problem.requestId}</p>}
          {commands.notice.problem?.stale && <p>Review the refreshed details before confirming again.</p>}
          {commands.notice.problem?.denied && <p><Link href={commands.login} target="_blank" rel="noopener">Open sign-in in a new tab</Link></p>}
        </Feedback>
      )}
      {commands.retry && <p><button disabled={commands.busy} type="button" onClick={commands.retry}>Retry the same request</button></p>}
    </>
  );
}

export function CommandForm({ commands, legend, submit, children, onSubmit }: {
  commands: StandardCommands;
  legend: string;
  submit: string;
  children: ReactNode;
  onSubmit: (data: FormData, form: HTMLFormElement) => void;
}) {
  function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (commands.locked) return;
    const form = event.currentTarget;
    try {
      onSubmit(new FormData(form), form);
    } catch (error) {
      commands.showError(error);
    }
  }
  return (
    <form onSubmit={handle}>
      <fieldset disabled={commands.locked} style={{ minWidth: 0, width: "100%" }}>
        <legend>{legend}</legend>
        {children}
        <p><button type="submit">{submit}</button></p>
      </fieldset>
    </form>
  );
}

export function Field({ children, name, ...props }: React.ComponentProps<"input"> & { children: ReactNode; name: string }) {
  return <p><label>{children}<br /><input {...props} name={name} /></label></p>;
}

export function SelectField({ children, options, name, defaultValue, onChange, required = true }: {
  children: ReactNode;
  options: readonly (readonly [string, string])[];
  name: string;
  defaultValue?: string;
  required?: boolean;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
}) {
  return (
    <p><label>{children}<br />
      <select style={{ maxWidth: "100%" }} name={name} defaultValue={defaultValue} required={required} onChange={onChange}>
        {options.map(([value, title]) => <option key={value} value={value}>{title}</option>)}
      </select>
    </label></p>
  );
}

export function Confirm({ children }: { children: ReactNode }) {
  return <p><label><input type="checkbox" required /> {children}</label></p>;
}

export function LocalTimeField({ name, children, required = true }: { name: string; children: ReactNode; required?: boolean }) {
  return <Field name={name} type="datetime-local" required={required}>{children} (MYT)</Field>;
}

export function RouteFailure({ retry, back }: { retry: () => void; back: { href: string; label: string } }) {
  return (
    <main>
      <h1>Could not load this page</h1>
      <ErrorMessage>Could not load this page. Try again to get the latest information.</ErrorMessage>
      <button type="button" onClick={retry}>Try again</button>
      <p><Link href={back.href}>{back.label}</Link></p>
    </main>
  );
}
