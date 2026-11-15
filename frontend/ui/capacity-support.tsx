"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { Icon } from "./icons";
import { Time } from "./order-details";
import {
  CommandForm,
  Confirm,
  Field,
  type StandardCommands,
} from "./standard-forms";
import { formText, type ReadResult } from "./standard-model";

type Policy = ReadResult<"getOperatingPolicy">;
type CalendarDay = ReadResult<"getCapacityCalendar">["days"][number];
const weekdays: Record<Policy["openWeekdays"][number], string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
  SUN: "Sunday",
};
const windowStatuses = {
  HELD: "Held",
  BOOKED: "Booked",
  USED: "Used",
} as const;

export function OperatingPolicy({
  policy,
  commands,
}: {
  policy: Policy;
  commands: StandardCommands;
}) {
  const [editing, setEditing] = useState(false);
  const editorId = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  function closeEditor() {
    setEditing(false);
    editButton.current?.focus();
  }

  return (
    <section
      className="surface capacity-support-card policy-card"
      aria-label="Weekly handoff policy"
    >
      <header className="capacity-support-heading">
        <div>
          <p className="eyebrow">
            <Icon name="calendar" size={16} /> Recurring schedule · MYT
          </p>
          <h2>Weekly handoff policy</h2>
          <p>Your regular handoff days and opening hours.</p>
        </div>
        <button
          ref={editButton}
          className="button-secondary support-edit-button"
          type="button"
          aria-label="Edit weekly handoff policy"
          aria-expanded={editing}
          aria-controls={editorId}
          disabled={commands.locked}
          onClick={() => setEditing((value) => !value)}
        >
          <Icon name="edit" size={16} /> Edit
        </button>
      </header>
      <div className="policy-hours">
        <span>Handoff hours</span>
        <strong>
          {policy.opensAt} <span aria-hidden="true">—</span>
          <span className="visually-hidden">to</span> {policy.closesAt}
        </strong>
        <small>Malaysia time</small>
      </div>
      <ul className="policy-days" aria-label="Current handoff days">
        {Object.entries(weekdays).map(([value, name]) => {
          const open = policy.openWeekdays.includes(
            value as keyof typeof weekdays,
          );
          return (
            <li
              key={value}
              data-open={open || undefined}
              aria-label={`${name}: ${open ? "Open" : "Closed"}`}
            >
              <strong>{name.slice(0, 3)}</strong>
              <span>{open ? "Open" : "Closed"}</span>
            </li>
          );
        })}
      </ul>
      <dl className="policy-cutoffs">
        <div>
          <dt>Same-day order cutoff</dt>
          <dd>
            {policy.sameDaySubmitCutoff}
            <span> MYT</span>
          </dd>
        </div>
        <div>
          <dt>Latest same-day handoff</dt>
          <dd>
            {policy.latestSameDayHandoff}
            <span> MYT</span>
          </dd>
        </div>
      </dl>
      <div id={editorId} hidden={!editing}>
        {editing && (
          <CommandForm
            key={policy.version}
            className="capacity-edit-form policy-edit-form"
            commands={commands}
            legend="Default handoff days and hours (MYT)"
            submit="Save weekly policy"
            onCancel={closeEditor}
            onSubmit={(data) => {
              const openWeekdays = data.getAll(
                "weekday",
              ) as Policy["openWeekdays"];
              const opensAt = formText(data, "opens"),
                closesAt = formText(data, "closes");
              if (!openWeekdays.length || closesAt <= opensAt)
                throw new Error(
                  "Choose at least one weekday and set a closing time after opening.",
                );
              commands.json<"updateOperatingPolicy">(
                {
                  path: "admin/operating-policy",
                  method: "PUT",
                  version: policy.version,
                  json: { openWeekdays, opensAt, closesAt },
                },
                () => {
                  setEditing(false);
                  return "Weekly policy saved for new commitments.";
                },
              );
            }}
          >
            <h3>Edit weekly schedule</h3>
            <fieldset className="policy-day-picker">
              <legend>Handoff days</legend>
              <div>
                {Object.entries(weekdays).map(([value, name]) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      name="weekday"
                      value={value}
                      aria-label={name}
                      defaultChecked={policy.openWeekdays.includes(
                        value as keyof typeof weekdays,
                      )}
                    />
                    <span>{name.slice(0, 3)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="policy-time-fields">
              <Field
                name="opens"
                type="time"
                defaultValue={policy.opensAt}
                required
              >
                Opening time (MYT)
              </Field>
              <Field
                name="closes"
                type="time"
                defaultValue={policy.closesAt}
                required
              >
                Closing time (MYT)
              </Field>
            </div>
            <div className="policy-confirm">
              <Confirm>
                Apply these hours to new commitments. Keep existing promised
                handoffs.
              </Confirm>
            </div>
          </CommandForm>
        )}
      </div>
    </section>
  );
}

export function DessertTableWindows({
  date,
  day,
}: {
  date: string;
  day?: CalendarDay;
}) {
  const windows = [...(day?.eventWindows ?? [])].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );
  const selectedDate = new Intl.DateTimeFormat("en-MY", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
  return (
    <section
      className="surface capacity-support-card event-windows-card"
      aria-label="Dessert table resource windows"
    >
      <header className="capacity-support-heading">
        <div>
          <p className="eyebrow">
            <Icon name="cake" size={16} /> Event schedule · MYT
          </p>
          <h2>Dessert table windows</h2>
          <p>
            <time dateTime={date}>{selectedDate}</time>
          </p>
        </div>
        <span className="capacity-status">
          {windows.length} {windows.length === 1 ? "window" : "windows"}
        </span>
      </header>
      <dl className="window-status-summary">
        {Object.entries(windowStatuses).map(([status, title]) => (
          <div key={status}>
            <dt>{title}</dt>
            <dd>
              {windows.filter((window) => window.status === status).length}
            </dd>
          </div>
        ))}
      </dl>
      {!windows.length ? (
        <div className="capacity-empty windows-empty">
          <span className="windows-empty-icon">
            <Icon name="calendar" size={26} />
          </span>
          <strong>No event windows scheduled</strong>
          <p>
            No held, booked or used windows for this date. Choose another day in
            the calendar to view its schedule.
          </p>
        </div>
      ) : (
        <ol className="event-window-list">
          {windows.map((window, index) => (
            <li key={window.eventId + ":" + window.startsAt}>
              <div className="event-window-heading">
                <h3>Window {index + 1}</h3>
                <span className="window-status" data-status={window.status}>
                  {windowStatuses[window.status]}
                </span>
              </div>
              <dl className="event-window-times">
                <div>
                  <dt>Starts</dt>
                  <dd>
                    <Time at={window.startsAt} />
                  </dd>
                </div>
                <div>
                  <dt>Ends</dt>
                  <dd>
                    <Time at={window.endsAt} />
                  </dd>
                </div>
              </dl>
              <Link
                className="event-window-link"
                href={"/merchant/events/" + encodeURIComponent(window.eventId)}
                aria-label={`Open event for window ${index + 1}`}
                prefetch={false}
              >
                Open event <Icon name="arrow" size={16} />
              </Link>
            </li>
          ))}
        </ol>
      )}
      <p className="support-footnote">
        Windows show when event resources are held, booked or used.
      </p>
    </section>
  );
}
