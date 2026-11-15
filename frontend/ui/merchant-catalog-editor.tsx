"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CatalogueProblem, ProductIdentityFields, useCatalogueCommand } from "./merchant-catalog";
import { ErrorMessage } from "./error-message";
import { Icon } from "./icons";
import { GalleryEditor, SavedGallery } from "./merchant-catalog-gallery";
import {
  CatalogueError, addStagedPhoto, cataloguePath, maxPhotos, movePhoto, photoIssue, prepareProductUpdate, publicationActions,
  readProduct, stagePhoto, statusNames, updateProduct,
  type FieldIssues, type MerchantSession, type Product, type ProductStatus, type VariantFields,
} from "./merchant-catalog-model";

function variantFields(product: Product): VariantFields[] {
  return product.variants.map(variant => ({
    key: variant.id, id: variant.id, name: variant.name, flavour: variant.flavour,
    price: (variant.unitMinor / 100).toFixed(2), prep: String(variant.prepMinutes), available: variant.available,
  }));
}

function inputProblem(issues: FieldIssues, field: string) {
  return issues[field] ? { "aria-invalid": true, "aria-describedby": field + "-error" } as const : {};
}

const variantInputs = [
  { name: "name", label: "Variant name", limit: 120, field: "name", inputMode: "text" },
  { name: "flavour", label: "Flavour", limit: 120, field: "flavour", inputMode: "text" },
  { name: "price", label: "Price (MYR)", limit: 10, field: "unitMinor", inputMode: "decimal" },
  { name: "prep", label: "Preparation (minutes)", limit: 5, field: "prepMinutes", inputMode: "numeric" },
] as const;

function VariantEditor({ index, variant, issues, change, remove }: {
  index: number;
  variant: VariantFields;
  issues: FieldIssues;
  change: (value: Partial<VariantFields>) => void;
  remove: () => void;
}) {
  return (
    <fieldset className="product-variant-card">
      <legend>Variant {index + 1}</legend>
      <div className="product-variant-fields">
      {variantInputs.map(({ name, label, limit, field, inputMode }) => {
        const id = `variants.${index}.${field}`;
        return (
          <div className="product-field" key={name}>
            <label htmlFor={id}>{label}</label>
            <input id={id} value={variant[name]} inputMode={inputMode} maxLength={limit} required
              onChange={event => change({ [name]: event.target.value })} {...inputProblem(issues, id)} />
            {issues[id] && <span className="product-field-error" id={id + "-error"}>{issues[id]}</span>}
          </div>
        );
      })}
      </div>
      <div className="product-variant-footer">
        <label className="product-availability">
          <input type="checkbox" checked={variant.available}
            onChange={event => change({ available: event.target.checked })} /> Available to order when listed
        </label>
      {!variant.id && <button className="button-quiet" type="button" onClick={remove} aria-label={`Remove new variant ${index + 1}`}>Remove new variant</button>}
      </div>
    </fieldset>
  );
}

function EditProduct({ product: initialProduct, session }: { product: Product; session: MerchantSession }) {
  const [saved, setSaved] = useState(initialProduct);
  const [name, setName] = useState(saved.name);
  const [category, setCategory] = useState(saved.category ?? "");
  const [variants, setVariants] = useState(() => variantFields(saved));
  const [ids, setIds] = useState(saved.imageRefs);
  const [target, setTarget] = useState<ProductStatus | null>(null);
  const [localIssues, setLocalIssues] = useState<FieldIssues>({});
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<Product | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<CatalogueError | null>(null);
  const compareRequest = useRef<AbortController | null>(null);
  const statusRegion = useRef<HTMLParagraphElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const publicationButton = useRef<HTMLButtonElement | null>(null);
  const focusNewVariant = useRef(false);
  const command = useCatalogueCommand(session);
  const archived = saved.status === "ARCHIVED";
  const action = publicationActions[saved.status].find(item => item.to === target);
  const dirty = name !== saved.name || category !== (saved.category ?? "")
    || JSON.stringify(variants) !== JSON.stringify(variantFields(saved)) || JSON.stringify(ids) !== JSON.stringify(saved.imageRefs);
  const locked = command.busy || !!command.retry;
  const atRisk = dirty || locked || conflict;
  const issues = { ...localIssues };
  if (command.error) {
    for (const { field } of command.error.problem?.fieldErrors ?? []) {
      issues[field] = command.error.message;
    }
  }


  useEffect(() => {
    if (target) confirmButton.current?.focus();
  }, [target]);

  useEffect(() => {
    if (focusNewVariant.current) {
      focusNewVariant.current = false;
      document.getElementById(`variants.${variants.length - 1}.name`)?.focus();
    }
  }, [variants.length]);

  useEffect(() => {
    if (!atRisk) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = true;
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [atRisk]);

  useEffect(() => () => compareRequest.current?.abort(), []);

  function loadSaved(product: Product) {
    setSaved(product);
    setName(product.name);
    setCategory(product.category ?? "");
    setVariants(variantFields(product));
    setIds(product.imageRefs);
    setTarget(null);
    setLatest(null);
    setConflict(false);
    setCheckError(null);
    setLocalIssues({});
  }

  function clearIssues() {
    setLocalIssues({});
    command.clearError();
  }

  async function checkLatest() {
    if (compareRequest.current) return;
    const controller = new AbortController();
    compareRequest.current = controller;
    setChecking(true);
    setCheckError(null);
    try {
      const product = await readProduct(saved.id, controller.signal);
      if (!controller.signal.aborted) setLatest(product);
    } catch (failure) {
      if (!controller.signal.aborted && failure instanceof CatalogueError) setCheckError(failure);
    } finally {
      compareRequest.current = null;
      if (!controller.signal.aborted) setChecking(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || archived || conflict) return;
    clearIssues();
    setNotice("");
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const status = submitter === confirmButton.current && action ? action.to : saved.status;
    const prepared = prepareProductUpdate(name, category, status, variants, ids);
    if (!prepared.input) {
      setLocalIssues(prepared.issues);
      return;
    }

    const { input } = prepared;
    const key = crypto.randomUUID();
    void command.execute({ label: "Retry product save", run: async csrfToken => {
      try {
        const product = await updateProduct(saved.id, saved.version, input, csrfToken, key);
        loadSaved(product);
        setNotice(`Product saved. Status: ${statusNames[product.status]}.`);
        statusRegion.current?.focus();
      } catch (failure) {
        if (failure instanceof CatalogueError && failure.problem?.code === "VERSION_CONFLICT") setConflict(true);
        throw failure;
      }
    } });
  }

  function upload(file: File, index: number | null) {
    if (locked || archived || conflict || (index === null && ids.length >= maxPhotos)) return;
    clearIssues();
    setNotice("");
    const issue = photoIssue(file);
    if (issue) {
      setLocalIssues({ imageRefs: issue });
      return;
    }
    const key = crypto.randomUUID();
    void command.execute({ label: "Retry photo upload", canSetAside: true, run: async csrfToken => {
      const media = await stagePhoto(saved.id, file, csrfToken, key);
      setIds(current => addStagedPhoto(current, media.id, index));
      setNotice("Photo staged. Save the product to apply the gallery.");
      statusRegion.current?.focus();
    } });
  }

  function changeGallery(next: string[], message: string) {
    clearIssues();
    setIds(next);
    setNotice(message);
  }

  return (
    <>
      <p className="product-breadcrumb"><Link href={cataloguePath} onNavigate={event => {
        if (atRisk && !window.confirm("Leave the editor and lose unsaved changes or pending retries?")) event.preventDefault();
      }}>← Back to catalogue</Link></p>
      <div className="page-heading product-editor-heading"><div><p className="eyebrow">Catalogue / Product editor</p><h1>{saved.name}</h1><p>Manage the details, choices and photos your customers see.</p></div>
        <div className="product-editor-meta"><span className="product-status" data-status={saved.status}>{statusNames[saved.status]}</span><span>Version {saved.version}</span>{dirty && <span className="product-unsaved">Unsaved changes</span>}</div>
      </div>
      <nav className="product-section-nav" aria-label="Product sections"><a href="#product-details">Details</a><a href="#variants">Variants</a><a href="#imageRefs">Photos</a><a href="#publication">Publication</a></nav>
      <p className={command.busy || notice ? "product-notice" : "visually-hidden"} ref={statusRegion} tabIndex={-1} role="status">{command.busy ? "Working…" : notice}</p>
      {command.error && <CatalogueProblem error={command.error} focus>
        {!conflict && !command.retry && <p>Your draft remains in the editor.</p>}
      </CatalogueProblem>}
      {!!Object.keys(issues).length && (
          <ErrorMessage key={JSON.stringify(issues)} focus={!command.error}>
            <p>Review the highlighted fields.</p>
            <ul>{Object.entries(issues).map(([field, issue]) => {
              const variantField = /^variants\.\d+\.(name|flavour|unitMinor|prepMinutes)$/.test(field);
              const anchor = variantField || ["name", "category", "imageRefs"].includes(field) ? field
                : field.startsWith("variants") ? "variants" : null;
              return <li key={field}>{anchor ? <a href={"#" + anchor}>{issue}</a> : issue}</li>;
            })}</ul>
          </ErrorMessage>
      )}
      {command.retry && (
        <p>{command.error?.needsSignIn ? "Sign in to the same merchant account, then retry." :
          "The result could not be confirmed. Retry to recover the outcome of the same request."}{" "}
          <button type="button" disabled={command.busy} onClick={() => command.retry && void command.execute(command.retry)}>
            {command.retry.label}
          </button>{" "}
          {command.retry.canSetAside && (
            <button type="button" disabled={command.busy} onClick={() => {
              command.setAside();
              setNotice("Upload set aside. The draft gallery is unchanged.");
              statusRegion.current?.focus();
            }}>Set aside upload</button>
          )}
        </p>
      )}
      {conflict && (
        <section className="surface product-conflict" aria-labelledby="version-conflict">
          <h3 id="version-conflict">A newer version is saved</h3>
          <p>Your edits are still below. Review the latest version before deciding whether to discard your draft.</p>
          <button type="button" disabled={checking} onClick={() => void checkLatest()}>Check latest version</button>
          {checking && <p role="status">Checking latest version…</p>}
          {checkError && <CatalogueProblem error={checkError} />}
          {latest && (
            <div>
              <p>{latest.name} · {latest.category ?? "Uncategorized"} · {statusNames[latest.status]} · Version {latest.version}</p>
              <details>
                <summary>Review latest variants and saved gallery</summary>
                {latest.variants.length > 0 && (
                  <ul>{latest.variants.map(variant => (
                    <li key={variant.id}>{variant.name} · {variant.flavour} · RM {(variant.unitMinor / 100).toFixed(2)}
                      {" · "}{variant.prepMinutes} min · {variant.available ? "Available" : "Unavailable"}</li>
                  ))}</ul>
                )}
                <SavedGallery productId={saved.id} ids={latest.imageRefs} />
              </details>
              <button type="button" disabled={checking} onClick={() => {
                clearIssues();
                loadSaved(latest);
                setNotice(`Loaded version ${latest.version}.`);
                statusRegion.current?.focus();
              }}>Discard my edits and load version {latest.version}</button>
            </div>
          )}
        </section>
      )}
      <form className="product-editor-form" onSubmit={submit}>
        <fieldset disabled={locked || archived} className="product-fieldset-reset">
          <legend className="visually-hidden">Edit product</legend>
          <div className="product-editor-layout"><div className="product-editor-main">
          <section id="product-details" className="surface product-editor-section" aria-labelledby="product-details-heading">
          <div className="product-section-heading"><span className="product-section-icon"><Icon name="cake" size={22} /></span><div><h2 id="product-details-heading">Product details</h2><p>The essentials for your menu.</p></div></div>
          <ProductIdentityFields name={name} category={category} issues={issues}
            onName={value => { setName(value); clearIssues(); }} onCategory={value => { setCategory(value); clearIssues(); }} />
          </section>
          <section className="surface product-editor-section" id="variants" tabIndex={-1} aria-labelledby="variants-heading">
            <div className="product-section-heading"><span className="product-section-icon"><Icon name="grid" size={22} /></span><div><h2 id="variants-heading">Variants &amp; flavours</h2><p>Set a price and preparation time for each choice.</p></div><span className="product-count">{variants.length} / 100</span></div>
            <p className="product-section-help">Turn off availability to retire an existing variant while keeping its purchase history.</p>
            {issues.variants && <p>{issues.variants}</p>}
            {variants.length === 0 && <div className="product-empty"><Icon name="cake" size={28} /><h3>Every dessert needs a choice</h3><p>Add your first variant with a flavour, price and preparation time.</p></div>}
            {variants.map((variant, index) => (
              <VariantEditor key={variant.key} index={index} variant={variant} issues={issues}
                change={value => { clearIssues(); setVariants(current => current.map(item => item.key === variant.key ? { ...item, ...value } : item)); }}
                remove={() => {
                  clearIssues();
                  setVariants(current => current.filter(item => item.key !== variant.key));
                  document.getElementById("add-variant")?.focus();
                }} />
            ))}
            <button className="button-secondary product-add-variant" type="button" id="add-variant" disabled={variants.length >= 100} onClick={() => {
              clearIssues();
              focusNewVariant.current = true;
              const variant = { key: crypto.randomUUID(), name: "", flavour: "", price: "", prep: "", available: true };
              setVariants(current => [...current, variant]);
            }}>Add variant</button>
            {variants.length >= 100 && <p>Variant limit reached. Reuse an existing variant if needed.</p>}
          </section>
          <fieldset disabled={conflict} className="product-fieldset-reset">
            <GalleryEditor productId={saved.id} ids={ids} savedIds={saved.imageRefs}
              onUpload={upload} onMove={(from, to) => changeGallery(movePhoto(ids, from, to), `Photo moved to position ${to + 1}.`)}
              onRemove={index => changeGallery(ids.filter((_, position) => index !== position), `Photo ${index + 1} removed from the draft.`)}
              issue={issues.imageRefs} />
          </fieldset>
          {!archived && <div className="surface product-save-bar"><div><strong>{dirty ? "Ready to save your changes?" : "Your product is up to date"}</strong><p>Save details and photos. Publication status stays the same.</p></div><button type="submit" disabled={conflict}><Icon name="check" size={16} />{command.busy ? "Working…" : "Save product"}</button></div>}
          </div>
          <aside className="surface product-publication" aria-labelledby="publication">
            <p className="eyebrow">Visibility</p><h2 id="publication">Publication</h2>
            <div className="product-publication-status"><span>Saved status</span><span className="product-status" data-status={saved.status}>{statusNames[saved.status]}</span></div>
            {archived ? <p>Archived products are read-only.</p> : (
              <>
                <p className="product-section-help">Choose an action, then confirm. This also saves your details, variants and photos.</p>
                <div className="product-publication-actions">
                  {publicationActions[saved.status].map(item => (
                    <button className="button-secondary" data-destructive={item.to === "ARCHIVED" || undefined} key={item.to} type="button" disabled={conflict} aria-pressed={item.to === target}
                      onClick={event => { publicationButton.current = event.currentTarget; setTarget(item.to); }}>{item.label}</button>
                  ))}
                </div>
                {action && (
                  <div className="product-publication-confirm">
                    <p id="publication-effect">{action.effect}</p>
                    <button ref={confirmButton} type="submit" disabled={conflict} aria-describedby="publication-effect">
                      Confirm: {action.label}
                    </button>{" "}
                    <button className="button-quiet" type="button" onClick={() => { setTarget(null); publicationButton.current?.focus(); }}>Cancel publication change</button>
                  </div>
                )}
              </>
            )}
          </aside></div>
        </fieldset>
      </form>
    </>
  );
}

export function MerchantProductEditor({ productId, accountId, csrfToken }: MerchantSession & { productId: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<CatalogueError | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void readProduct(productId, controller.signal).then(result => {
      if (!controller.signal.aborted) setProduct(result);
    }).catch((failure: CatalogueError) => {
      if (!controller.signal.aborted) setError(failure);
    });
    return () => controller.abort();
  }, [productId, attempt, csrfToken]);

  if (product) return <EditProduct product={product} session={{ accountId, csrfToken }} />;
  return (
    <>
      <p className="product-breadcrumb"><Link href={cataloguePath}>← Back to catalogue</Link></p>
      <div className="page-heading"><div><p className="eyebrow">Catalogue</p><h1>Product editor</h1></div></div>
      {error ? (
        <>
          <CatalogueProblem error={error} />
          <button type="button" onClick={() => { setError(null); setAttempt(value => value + 1); }}>Retry loading product</button>
        </>
      ) : <p role="status">Loading product…</p>}
    </>
  );
}
