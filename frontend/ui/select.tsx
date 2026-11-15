"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
} from "react";
import { Icon } from "./icons";

type Option = ReactElement<ComponentProps<"option">>;
type Props = Omit<ComponentProps<"select">, "multiple" | "size" | "ref">;
const emptyOption = "__empty_option__";

export function Select({
  children,
  value,
  defaultValue,
  onChange,
  className,
  style,
  ...props
}: Props) {
  const options = Children.toArray(children).filter(
    (child): child is Option =>
      isValidElement(child) && child.type === "option",
  );
  const initial = String(defaultValue ?? options[0]?.props.value ?? "");
  const [localValue, setLocalValue] = useState(initial);
  const selected = String(value ?? localValue);
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [labelText, setLabelText] = useState<string>();

  useEffect(() => {
    const label = native.current?.labels?.[0];
    if (label) {
      const text = label.cloneNode(true) as HTMLElement;
      text
        .querySelectorAll(".select-control")
        .forEach((control) => control.remove());
      setLabelText(text.textContent?.trim());
    }
    const form = native.current?.form;
    const reset = () => setLocalValue(initial);
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [initial]);

  return (
    <span className={"select-control " + (className ?? "")} style={style}>
      <select
        {...props}
        ref={native}
        className="control-native"
        value={selected}
        tabIndex={-1}
        aria-hidden="true"
        onFocus={() => trigger.current?.focus()}
        onChange={(event) => {
          setLocalValue(event.target.value);
          onChange?.(event);
        }}
      >
        {children}
      </select>
      <SelectPrimitive.Root
        value={selected || emptyOption}
        disabled={props.disabled}
        onValueChange={(next) => {
          if (!native.current) return;
          native.current.value = next === emptyOption ? "" : next;
          native.current.dispatchEvent(new Event("change", { bubbles: true }));
        }}
      >
        <SelectPrimitive.Trigger
          ref={trigger}
          className="select-trigger"
          aria-label={props["aria-label"] ?? labelText}
          aria-labelledby={props["aria-labelledby"]}
          aria-describedby={props["aria-describedby"]}
          aria-required={props.required}
          aria-invalid={props["aria-invalid"]}
        >
          <SelectPrimitive.Value
            placeholder={
              options.find((option) => String(option.props.value ?? "") === "")
                ?.props.children ?? "Choose an option"
            }
          >
            {options.find(
              (option) => String(option.props.value ?? "") === selected,
            )?.props.children ?? "Choose an option"}
          </SelectPrimitive.Value>
          <SelectPrimitive.Icon>
            <Icon name="chevronDown" size={16} />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            className="select-menu"
            position="popper"
            sideOffset={6}
            collisionPadding={12}
          >
            <SelectPrimitive.ScrollUpButton className="select-scroll">
              <Icon name="up" size={15} />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className="select-options">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={String(option.props.value)}
                  value={String(option.props.value) || emptyOption}
                  disabled={option.props.disabled}
                  className="select-option"
                >
                  <SelectPrimitive.ItemText>
                    {option.props.children}
                  </SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator>
                    <Icon name="check" size={16} />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="select-scroll">
              <Icon name="down" size={15} />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </span>
  );
}
