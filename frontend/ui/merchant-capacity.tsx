"use client";

import { Select } from "@/ui/select";
import { Icon } from "./icons";
import { OperatingPolicy, DessertTableWindows } from "./capacity-support";
import { ErrorMessage } from "./error-message";

import Link from "next/link";
import { useState } from "react";
import { Time } from "./order-details";
import { readStandard } from "./standard-api";
import { CommandFeedback, CommandForm, Confirm, Field, useStandardCommands, type StandardCommands } from "./standard-forms";
import { formText, orderStatuses, type JsonInput, type ReadResult, type Session } from "./standard-model";

type CalendarDay = ReadResult<"getCapacityCalendar">["days"][number];
type Products = ReadResult<"listMerchantProducts">;
type Policy = ReadResult<"getOperatingPolicy">;
type Edit = JsonInput<"previewCapacityImpact">;
type Impact = ReadResult<"previewCapacityImpact">;
type LimitField = { key: string; productId: string; units: string };

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
    <section className="surface capacity-editor" aria-label="Daily production capacity">
      <header className="capacity-editor-heading">
        <div><p className="eyebrow"><Icon name="calendar" size={16} /> Daily capacity · MYT</p>
          <h2><time dateTime={date}>{new Intl.DateTimeFormat("en-MY", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"))}</time></h2>
          <p>Set how much your kitchen can take on for this date.</p></div>
        <span className="capacity-status">{saved ? saved.closed ? "Closed" : "Open" : "Not configured"}</span>
      </header>
      <dl className="capacity-snapshot">
        <div><dt>Current daily limit</dt><dd>{saved ? saved.maxUnits : "—"}<span> units</span></dd></div>
        <div><dt>Reserved or used</dt><dd>{saved?.allocatedUnits ?? 0}<span> units</span></dd></div>
        <div><dt>Product limits</dt><dd>{saved?.productLimits.length ?? 0}<span> configured</span></dd></div>
      </dl>
      <CommandForm className="capacity-edit-form" commands={commands} legend="Proposed capacity limits" submit="Preview impact"
        submitHint="Review affected orders before saving your changes."
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
        <div className="capacity-basics">
          <div className="capacity-availability">
            <label className="capacity-toggle"><span>Close this date</span><input role="switch" type="checkbox" name="closed" aria-describedby="capacity-closed-help" defaultChecked={saved?.closed} onChange={() => setPreview(undefined)} /></label>
            <p id="capacity-closed-help">Stop new commitments for this date. Existing orders keep their promised handoff.</p>
          </div>
          <div className="capacity-daily-limit">
            <Field name="dayLimit" type="number" min={0} max={2_147_483_647} step={1} required defaultValue={saved?.maxUnits}
              aria-describedby="capacity-limit-help" placeholder="e.g. 100" onChange={() => setPreview(undefined)}>Total daily limit (units)</Field>
            <p id="capacity-limit-help">The total preparation units your kitchen can handle.</p>
          </div>
        </div>
        <div className="capacity-product-heading"><div><h3>Product limits <span>{limits.length}</span></h3><p>Optionally cap individual products within the daily limit.</p></div>
          <button className="button-secondary" disabled={limits.length >= 100} type="button" onClick={() => {
            setLimits(rows => [...rows, { key: crypto.randomUUID(), productId: "", units: "" }]);
            setPreview(undefined);
          }}><span aria-hidden="true">+</span> Add product limit</button>
        </div>
        {!limits.length && <div className="capacity-empty"><Icon name="cake" size={24} /><div><strong>No product-specific limits</strong><p>The total daily limit applies across your products.</p></div></div>}
        <div className="capacity-product-list">
        {limits.map((item, index) => (
          <fieldset key={item.key} className="capacity-product-row">
            <legend>Product limit {index + 1}</legend>
            <p><label>Product<br />
              <Select required value={item.productId} style={{ maxWidth: "100%" }} onChange={event => {
                const productId = event.target.value;
                setLimits(rows => rows.map(row => row.key === item.key ? { ...row, productId } : row));
                setPreview(undefined);
              }}>
                <option value="">Choose a product</option>
                {item.productId && !products.items.some(product => product.id === item.productId) && <option value={item.productId}>Existing product · {item.productId}</option>}
                {products.items.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
              </Select>
            </label></p>
            <Field name={"product-limit-" + index} type="number" min={0} max={2_147_483_647} step={1} required value={item.units}
              onChange={event => {
                const units = event.target.value;
                setLimits(rows => rows.map(row => row.key === item.key ? { ...row, units } : row));
                setPreview(undefined);
              }}>Product limit (units)</Field>
            <button className="button-quiet capacity-remove" aria-label={`Remove product limit ${index + 1}`} type="button" onClick={() => { setLimits(rows => rows.filter(row => row.key !== item.key)); setPreview(undefined); }}>Remove</button>
          </fieldset>
        ))}
        </div>
        {products.nextCursor && <p><button type="button" disabled={loadingProducts} onClick={() => void loadMoreProducts()}>{loadingProducts ? "Loading products…" : "Load more product choices"}</button></p>}
      </CommandForm>
      {preview && impact && (
        <section className="capacity-impact" aria-label="Capacity impact preview">
          <h3>Capacity impact preview</h3>
          <p>{impact.occupiedUnits} occupied units, {impact.usedUnits} used units · {impact.affectedCount} affected orders.</p>
          <p>Preview expires <Time at={impact.expiresAt} />. Existing commitments keep their promised handoff.</p>
          {!currentPreview && <p role="status">Preview the impact again before saving.</p>}
          {!impact.canSave && <ErrorMessage>The proposed limits cannot cover occupied or used units.</ErrorMessage>}
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
      <div className="capacity-section-toolbar"><span>Daily settings and availability</span><button className="button-quiet" type="button" disabled={commands.busy} onClick={commands.refresh}>Refresh calendar</button></div>
      <CapacityEditor key={date} date={date} saved={day} initialProducts={products} commands={commands} />
      <div className="capacity-support">
      <OperatingPolicy policy={policy} commands={commands} />
      <DessertTableWindows date={date} day={day} />
      </div>
    </>
  );
}
