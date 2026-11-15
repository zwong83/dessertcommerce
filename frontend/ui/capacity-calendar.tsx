"use client";

import { DayButton, DayPicker, type DayButtonProps } from "@daypicker/react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useTransition } from "react";
import { calendarDate, dateValue } from "./date-input";
import type { ReadResult } from "./standard-model";

type Calendar = ReadResult<"getCapacityCalendar">;
const Days = createContext<Calendar["days"]>([]);

function CapacityDay(props: DayButtonProps) {
  const day = useContext(Days).find(
    (item) => item.date === dateValue(props.day.date),
  );
  return (
    <DayButton
      {...props}
      aria-label={`${props["aria-label"]}. ${day ? (day.closed ? "Closed" : `${day.allocatedUnits} of ${day.maxUnits} units reserved`) : "No daily limit configured"}${day?.eventWindows.length ? `. ${day.eventWindows.length} event windows` : ""}`}
    >
      <span className="calendar-day-number">{props.day.date.getDate()}</span>
      {!props.modifiers.disabled && (
        <span className="calendar-day-summary">
          <span>
            {day
              ? day.closed
                ? "Closed"
                : `${day.allocatedUnits} / ${day.maxUnits}`
              : "Set limits"}
          </span>
          {day && !day.closed && (
            <span className="calendar-capacity-track">
              <span
                style={{
                  width: `${day.maxUnits ? Math.min(100, (day.allocatedUnits / day.maxUnits) * 100) : 0}%`,
                }}
              />
            </span>
          )}
        {day && day.eventWindows.length > 0 && (
          <span className="calendar-events">{day.eventWindows.length} events</span>
        )}
        </span>
      )}
    </DayButton>
  );
}

export function CapacityCalendar({
  calendar,
  from,
  to,
  selected,
  today,
}: {
  calendar: Calendar;
  from: string;
  to: string;
  selected: string;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigate = (query: Record<string, string>) =>
    startTransition(() =>
      router.push("/merchant/capacity?" + new URLSearchParams(query), {
        scroll: false,
      }),
    );
  function month(date: Date) {
    const start = dateValue(
      new Date(date.getFullYear(), date.getMonth(), 1, 12),
    );
    const end = dateValue(
      new Date(date.getFullYear(), date.getMonth() + 1, 0, 12),
    );
    navigate({ from: start, to: end, date: start });
  }
  return (
    <section
      className="surface production-calendar"
      aria-labelledby="calendar-dates"
      aria-busy={pending}
    >
      <div className="section-heading-row">
        <div>
          <h2 id="calendar-dates">Plan your month</h2>
          <p>Select a day to view events and edit production limits.</p>
        </div>
        <button
          type="button"
          className="button-secondary"
          disabled={pending}
          onClick={() => month(calendarDate(today))}
        >
          This month
        </button>
      </div>
      <Days.Provider value={calendar.days}>
        <DayPicker
          mode="single"
          required
          month={calendarDate(from)}
          numberOfMonths={from.slice(0, 7) === to.slice(0, 7) ? 1 : 2}
          selected={calendarDate(selected)}
          today={calendarDate(today)}
          onMonthChange={month}
          onSelect={(date) => navigate({ from, to, date: dateValue(date) })}
          disabled={
            pending
              ? true
              : [{ before: calendarDate(from) }, { after: calendarDate(to) }]
          }
          showOutsideDays={from.slice(0, 7) === to.slice(0, 7)}
          weekStartsOn={1}
          components={{ DayButton: CapacityDay }}
        />
      </Days.Provider>
      <div className="calendar-caption">
        <span>Reserved units / daily limit · Malaysia time</span>
        <span role="status">
          {pending ? "Loading calendar…" : `Selected ${selected}`}
        </span>
      </div>
    </section>
  );
}
