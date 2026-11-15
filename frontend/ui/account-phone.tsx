"use client";

import { getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import type { Ref } from "react";
import { CountryCodePicker } from "./country-code-picker";

const internationalPhonePattern = /^\+[1-9][0-9]{7,14}$/;

export function internationalPhone(input: string, country: CountryCode) {
  const compact = input.replace(/[\s().-]/g, "");
  if (internationalPhonePattern.test(compact)) return compact;
  if (!/^[0-9]+$/.test(compact)) return undefined;
  const parsed = parsePhoneNumberFromString(compact, { defaultCountry: country, extract: false });
  if (!parsed || parsed.countryCallingCode !== getCountryCallingCode(country)) return undefined;
  return internationalPhonePattern.test(parsed.number) ? parsed.number : undefined;
}

export function AccountPhone({ id, country, onCountryChange, value, onChange, inputRef }: {
  id: string;
  country: CountryCode;
  onCountryChange: (country: CountryCode) => void;
  value: string;
  onChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return <div className="account-phone-fields">
    <CountryCodePicker value={country} onChange={onCountryChange} />
    <div>
      <label htmlFor={id}>Phone number</label>
      <input id={id} name="phone" ref={inputRef} type="tel" autoComplete="tel" maxLength={32} required
        value={value} onChange={event => onChange(event.target.value)} />
    </div>
  </div>;
}
