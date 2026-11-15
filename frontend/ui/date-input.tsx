"use client";

import { DayPicker } from "@daypicker/react";
import * as Popover from "@radix-ui/react-popover";
import { useRef, useState, type ComponentProps } from "react";
import { Icon } from "./icons";

export function calendarDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function dateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function DateInput({
  onChange,
  value,
  defaultValue,
  ...props
}: ComponentProps<"input">) {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState(
    String(value ?? defaultValue ?? ""),
  );
  const current = String(value ?? selection);
  return (
    <span className="date-input">
      <input
        {...props}
        ref={input}
        value={value}
        defaultValue={defaultValue}
        onChange={(event) => {
          setSelection(event.target.value);
          onChange?.(event);
        }}
      />
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          if (next) setSelection(input.current?.value ?? "");
          setOpen(next);
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            className="date-picker-trigger"
            disabled={props.disabled || props.readOnly}
            aria-label="Open calendar"
          >
            <Icon name="calendar" size={18} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="date-popover"
            sideOffset={8}
            collisionPadding={12}
            aria-label="Choose a date"
          >
            <DayPicker
              mode="single"
              autoFocus
              defaultMonth={current ? calendarDate(current) : undefined}
              selected={current ? calendarDate(current) : undefined}
              disabled={[
                ...(props.min
                  ? [{ before: calendarDate(String(props.min)) }]
                  : []),
                ...(props.max
                  ? [{ after: calendarDate(String(props.max)) }]
                  : []),
              ]}
              onSelect={(date) => {
                if (!date || !input.current) return;
                const time = current.slice(10) || "T12:00";
                const next =
                  dateValue(date) +
                  (props.type === "datetime-local" ? time : "");
                const setter = Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "value",
                )?.set;
                setter?.call(input.current, next);
                input.current.dispatchEvent(
                  new Event("input", { bubbles: true }),
                );
                input.current.dispatchEvent(
                  new Event("change", { bubbles: true }),
                );
                setSelection(next);
                setOpen(false);
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </span>
  );
}
