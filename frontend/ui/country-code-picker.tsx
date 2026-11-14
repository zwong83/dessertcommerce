"use client";

import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icons";

const regionNames = new Intl.DisplayNames("en", { type: "region" });
const searchable = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const countries = getCountries().map(country => {
  const name = regionNames.of(country) ?? country;
  return { country, name, searchName: searchable(name), callingCode: "+" + getCountryCallingCode(country) };
}).sort((a, b) => a.name.localeCompare(b.name, "en"));

export function CountryCodePicker({ value, onChange }: {
  value: CountryCode;
  onChange: (country: CountryCode) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const picker = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const activeRow = useRef<HTMLLIElement>(null);

  const selection = countries.find(option => option.country === value)!;
  const term = searchable(query.trim());
  const results = term
    ? countries.filter(option => option.searchName.includes(term)
      || option.callingCode.startsWith(term.startsWith("+") ? term : "+" + term))
    : [selection, ...countries.filter(option => option.country !== value)];
  const active = results[activeIndex];
  const optionId = (country: CountryCode) => id + "-" + country;

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !picker.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [open, query, activeIndex]);

  function openPicker() {
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  }

  function closePicker() {
    setOpen(false);
    trigger.current?.focus();
  }

  function choose(country: CountryCode) {
    onChange(country);
    closePicker();
  }

  function handleSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePicker();
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (active) choose(active.country);
    } else if (results.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(index => Math.max(0, Math.min(results.length - 1, index + step)));
    }
  }

  return <div className="country-picker" ref={picker} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label id={id + "-label"} htmlFor={id + "-trigger"}>Country code</label>
    <button id={id + "-trigger"} className="country-picker-trigger" type="button" ref={trigger}
      aria-labelledby={id + "-label " + id + "-selection"} aria-expanded={open}
      aria-controls={open ? id + "-panel" : undefined} onClick={() => open ? closePicker() : openPicker()}
      onKeyDown={event => {
        if (event.key === "ArrowDown" && !open) {
          event.preventDefault();
          openPicker();
        }
      }}>
      <span id={id + "-selection"} className="country-picker-value">
        <strong>{selection.callingCode}</strong> <span>{selection.name}</span>
      </span>
      <Icon name="chevronDown" size={16} />
    </button>
    {open && <div className="country-picker-panel" id={id + "-panel"}>
      <div className="country-picker-search">
        <Icon name="search" size={17} />
        <input ref={search} type="text" role="combobox" aria-label="Search countries and calling codes"
          placeholder="Search country or code" autoComplete="off" spellCheck={false} value={query}
          aria-expanded="true" aria-autocomplete="list" aria-controls={id + "-results"}
          aria-activedescendant={active ? optionId(active.country) : undefined}
          onChange={event => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={handleSearchKey} />
      </div>
      <ul role="listbox" aria-label="Countries and calling codes" id={id + "-results"} className="country-picker-results">
        {results.map(option => {
          const highlighted = option.country === active?.country;
          return <li id={optionId(option.country)} key={option.country} role="option" aria-selected={highlighted}
            ref={highlighted ? activeRow : undefined}
            onMouseDown={event => event.preventDefault()} onClick={() => choose(option.country)}>
            {option.country === value ? <Icon name="check" size={16} /> : <span aria-hidden="true" />}
            <span>{option.name}</span>
            <span className="country-picker-code">{option.callingCode}</span>
          </li>;
        })}
      </ul>
      {!results.length && <p className="country-picker-empty" role="status">No countries match your search.</p>}
    </div>}
  </div>;
}
