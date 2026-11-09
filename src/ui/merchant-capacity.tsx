"use client";

import Link from "next/link";
import { useState } from "react";
import { Time } from "./order-details";
import { readStandard } from "./standard-api";
import { CommandFeedback, CommandForm, Confirm, Field, useStandardCommands, type StandardCommands } from "./standard-forms";
import { formText, label, orderStatuses, type JsonInput, type ReadResult, type Session } from "./standard-model";

type CalendarDay = ReadResult<"getCapacityCalendar">["days"][number];
type Products = ReadResult<"listMerchantProducts">;
type Policy = ReadResult<"getOperatingPolicy">;
type Edit = JsonInput<"previewCapacityImpact">;
type Impact = ReadResult<"previewCapacityImpact">;
type LimitField = { key: string; productId: string; units: string };

const weekdays: Record<Policy["openWeekdays"][number], string> = {
  MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
};

function OperatingPolicy({ policy, commands }: { policy: Policy; commands: StandardCommands }) {
  return (
    <section aria-label="Weekly handoff policy">
      <h2>Weekly handoff policy</h2>
      <p>Current hours {policy.opensAt}–{policy.closesAt} MYT · {policy.openWeekdays.map(day => weekdays[day]).join(", ")}</p>
      <p>Same-day orders close at {policy.sameDaySubmitCutoff} MYT. The latest same-day handoff is {policy.latestSameDayHandoff} MYT.</p>
      <details>
        <summary>Edit weekly handoff policy</summary>
        <CommandForm commands={commands} legend="Default handoff days and hours (MYT)" submit="Save weekly policy"
          onSubmit={(data, form) => {
            const openWeekdays = data.getAll("weekday") as Policy["openWeekdays"];
            const opensAt = formText(data, "opens"), closesAt = formText(data, "closes");
            if (!openWeekdays.length || closesAt <= opensAt) throw new Error("Choose at least one weekday and set a closing time after opening.");
            commands.json<"updateOperatingPolicy">({
              path: "admin/operating-policy", method: "PUT", version: policy.version,
              json: { openWeekdays, opensAt, closesAt },
            }, () => {
              form.reset();
              return "Weekly policy saved for new commitments.";
            });
          }}>
          {Object.entries(weekdays).map(([value, name]) => <p key={value}>
            <label><input type="checkbox" name="weekday" value={value} defaultChecked={policy.openWeekdays.includes(value as keyof typeof weekdays)} /> {name}</label>
          </p>)}
          <Field name="opens" type="time" defaultValue={policy.opensAt} required>Opening time (MYT)</Field>
          <Field name="closes" type="time" defaultValue={policy.closesAt} required>Closing time (MYT)</Field>
          <Confirm>Apply these hours to new commitments. Keep existing promised handoffs.</Confirm>
        </CommandForm>
      </details>
    </section>
  );
}

function asUnits(value: string) {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number > 2_147_483_647) throw new Error("Enter non-negative whole capacity units.");
  return number;
}

function CapacityEditor({ date, saved, initialProducts, commands }: { date: string; saved?: CalendarDay; initialProducts: Products; commands: StandardCommands }) {
  const [limits, setLimits] = useState<LimitField[]>(() => (saved?.productLimits ?? []).map(item => ({
    key: item.productId, productId: item.productId, units: String(item.maxUnits),
  })));
  const [products, setProducts] = useState(initialProducts);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [preview, setPreview] = useState<{ edit: Edit; impact: Impact }>();

  function previewEdit(edit: Edit, cursor?: string) {
    const query = new URLSearchParams({ limit: "25" });
    if (cursor) query.set("cursor", cursor);
    commands.json<"previewCapacityImpact">({ path: "admin/capacity/preview?" + query, json: edit }, result => {
      setPreview(previous => ({
        edit,
        impact: cursor && previous ? {
          ...result,
          items: [...new Map([...previous.impact.items, ...result.items].map(item => [item.orderId, item])).values()],
        } : result,
      }));
      return result.canSave ? "Capacity impact is ready to review." : "These limits are below occupied or used units. Adjust them and preview again.";
    }, false);
  }

  async function loadMoreProducts() {
    if (!products.nextCursor || loadingProducts) return;
    setLoadingProducts(true);
    try {
      const query = new URLSearchParams({ limit: "100", cursor: products.nextCursor });
      const page = await readStandard<"listMerchantProducts">("admin/products?" + query);
      setProducts({ items: [...products.items, ...page.items], nextCursor: page.nextCursor });
    } catch {
      commands.showError(new Error("Could not load more products. Try again."));
    } finally {
      setLoadingProducts(false);
    }
  }

  const impact = preview?.impact;
  const currentPreview = impact && impact.expectedVersion === (saved?.version ?? 0) && !commands.notice?.problem?.stale;

  return (
    <section aria-label="Daily production capacity">
      <h2>Capacity for {date} (MYT)</h2>
      {saved ? <p>{saved.closed ? "Closed to new commitments" : "Open, subject to weekly policy"} · {saved.allocatedUnits} occupied out of {saved.maxUnits} units.</p>
        : <p>No daily limit is configured for this date.</p>}
      <CommandForm commands={commands} legend="Proposed capacity limits" submit="Preview impact"
        onSubmit={data => {
          const productLimits = limits.map(item => {
            if (!item.productId) throw new Error("Choose a product for every product limit.");
            return { productId: item.productId, limit: asUnits(item.units) };
          });
          if (new Set(productLimits.map(item => item.productId)).size !== productLimits.length) throw new Error("Use one limit per product.");
          setPreview(undefined);
          previewEdit({
            date, closed: data.has("closed"), dayLimit: asUnits(formText(data, "dayLimit")),
            productLimits, expectedVersion: saved?.version ?? 0,
          });
        }}>
        <p><label><input type="checkbox" name="closed" defaultChecked={saved?.closed} onChange={() => setPreview(undefined)} /> Close this date to new commitments</label></p>
        <Field name="dayLimit" type="number" min={0} max={2_147_483_647} step={1} required defaultValue={saved?.maxUnits}
          onChange={() => setPreview(undefined)}>Total daily limit (units)</Field>
        {limits.map((item, index) => (
          <fieldset key={item.key} style={{ minWidth: 0 }}>
            <legend>Product limit {index + 1}</legend>
            <p><label>Product<br />
              <select required value={item.productId} style={{ maxWidth: "100%" }} onChange={event => {
                const productId = event.target.value;
                setLimits(rows => rows.map(row => row.key === item.key ? { ...row, productId } : row));
                setPreview(undefined);
              }}>
                <option value="">Choose a product</option>
                {item.productId && !products.items.some(product => product.id === item.productId) && <option value={item.productId}>Existing product · {item.productId}</option>}
                {products.items.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </label></p>
            <Field name={"product-limit-" + index} type="number" min={0} max={2_147_483_647} step={1} required value={item.units}
              onChange={event => {
                const units = event.target.value;
                setLimits(rows => rows.map(row => row.key === item.key ? { ...row, units } : row));
                setPreview(undefined);
              }}>Product limit (units)</Field>
            <button type="button" onClick={() => { setLimits(rows => rows.filter(row => row.key !== item.key)); setPreview(undefined); }}>Remove product limit {index + 1}</button>
          </fieldset>
        ))}
        <p><button disabled={limits.length >= 100} type="button" onClick={() => {
          setLimits(rows => [...rows, { key: crypto.randomUUID(), productId: "", units: "" }]);
          setPreview(undefined);
        }}>Add product limit</button></p>
        {products.nextCursor && <p><button type="button" disabled={loadingProducts} onClick={() => void loadMoreProducts()}>{loadingProducts ? "Loading products…" : "Load more product choices"}</button></p>}
      </CommandForm>
      {preview && impact && (
        <section aria-label="Capacity impact preview">
          <h3>Capacity impact preview</h3>
          <p>{impact.occupiedUnits} occupied units, {impact.usedUnits} used units · {impact.affectedCount} affected orders.</p>
          <p>Preview expires <Time at={impact.expiresAt} />. Existing commitments keep their promised handoff.</p>
          {!currentPreview && <p role="status">Preview the impact again before saving.</p>}
          {!impact.canSave && <p role="alert">The proposed limits cannot cover occupied or used units.</p>}
          <ul className="item-list">{impact.items.map(item => <li key={item.orderId}>
            <Link href={"/merchant/orders/" + item.orderId} prefetch={false}>Order {item.orderNumber}</Link> · {orderStatuses[item.status]} · {item.units} units
            <p>{item.kind === "EXISTING_COMMITMENT" ? "Existing commitment" : "Pending request requires a new capacity check"}
              {item.promisedHandoffAt && <> · <Time at={item.promisedHandoffAt} /></>}</p>
          </li>)}</ul>
          {currentPreview && impact.nextCursor && <p><button type="button" disabled={commands.locked}
            onClick={() => impact.nextCursor && previewEdit(preview.edit, impact.nextCursor)}>Load more affected orders</button></p>}
          {currentPreview && impact.canSave && <CommandForm key={impact.impactToken} commands={commands} legend="Confirm the reviewed capacity edit"
            submit="Save capacity change" onSubmit={() => {
              commands.json<"configureCapacity">({ path: "admin/capacity", method: "PUT", json: { ...preview.edit, impactToken: impact.impactToken } }, () => {
                setPreview(undefined);
                return "Capacity change saved.";
              });
            }}>
            <Confirm>I reviewed the impact and confirm these limits.</Confirm>
          </CommandForm>}
        </section>
      )}
    </section>
  );
}

export function MerchantCapacity({ date, day, policy, products, session }: {
  date: string; day?: CalendarDay; policy: Policy; products: Products; session: Session;
}) {
  const commands = useStandardCommands(session);
  return (
    <>
      <CommandFeedback commands={commands} />
      <p><button type="button" disabled={commands.busy} onClick={commands.refresh}>Refresh calendar</button></p>
      <OperatingPolicy policy={policy} commands={commands} />
      <section aria-label="Dessert table resource windows">
        <h2>Dessert table windows for {date} (MYT)</h2>
        {!day?.eventWindows.length && <p>No held, booked or used event windows for this date.</p>}
        <ul className="item-list">{day?.eventWindows.map(window => <li key={window.eventId + ":" + window.startsAt}>
          <Link href={"/merchant/events/" + encodeURIComponent(window.eventId)} prefetch={false}>Open event</Link>
          {" · "}{label(window.status)} · <Time at={window.startsAt} /> to <Time at={window.endsAt} />
        </li>)}</ul>
      </section>
      <CapacityEditor key={date} date={date} saved={day} initialProducts={products} commands={commands} />
    </>
  );
}
