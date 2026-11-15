"use client";

import { type ComponentPropsWithoutRef, useState } from "react";
import { Icon } from "./icons";

type PasswordFieldProps = Omit<ComponentPropsWithoutRef<"input">, "type"> & {
  id: string;
  label: string;
};

export function PasswordField({ id, label, disabled, ...input }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const revealed = visible && !disabled;

  return <>
    <label htmlFor={id}>{label}</label>
    <div className="password-field">
      <input {...input} id={id} type={revealed ? "text" : "password"} disabled={disabled}
        spellCheck={false} autoCapitalize="none" autoCorrect="off" />
      <button className="password-field-toggle" type="button" disabled={disabled}
        aria-controls={id} aria-label={(revealed ? "Hide " : "Show ") + label.toLowerCase()}
        onClick={() => setVisible(previous => !previous)}>
        <Icon name={revealed ? "eye" : "eyeOff"} size={19} />
      </button>
    </div>
  </>;
}
