"use client";

import { Select } from "@/ui/select";
import { ErrorMessage } from "./error-message";
import { Icon } from "./icons";
import { MerchantProductCard } from "./merchant-catalog-card";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  CatalogueError, cataloguePath, createProduct, productPagePath, readProducts, refreshMerchantSession, statusNames,
  type MerchantSession, type ProductPage, type ProductStatus,
} from "./merchant-catalog-model";

type Command = { label: string; run: (csrfToken: string) => Promise<void>; canSetAside?: boolean };

export function useCatalogueCommand({ accountId, csrfToken }: MerchantSession) {
  const inFlight = useRef(false);
  const token = useRef(csrfToken);
  const refreshSession = useRef(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<Command | null>(null);
  const [error, setError] = useState<CatalogueError | null>(null);

  async function execute(command: Command) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (refreshSession.current) {
        token.current = await refreshMerchantSession(accountId);
        refreshSession.current = false;
      }
      await command.run(token.current);
      setRetry(null);
    } catch (failure) {
      const issue = failure instanceof CatalogueError
        ? failure : new CatalogueError(null, 0, "The catalogue response could not be processed.");
      setError(issue);
      if (issue.needsSignIn) refreshSession.current = true;
      // An interrupted response may have committed. Replay the same payload and idempotency key.
      setRetry(previous => issue.uncertain || issue.needsSignIn || previous === command && issue.status === 429
        ? command : null);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function setAside() {
    if (inFlight.current || !retry?.canSetAside) return;
    setRetry(null);
    setError(null);
  }

  return { busy, retry, error, execute, setAside, clearError: () => setError(null) };
}

export function CatalogueProblem({ error, children, focus }: { error: CatalogueError; children?: ReactNode; focus?: boolean }) {
  return (
    <ErrorMessage key={error.problem?.requestId ?? error.message} focus={focus}>
      <p>{error.message}{error.problem?.requestId && <> Reference: {error.problem.requestId}.</>}</p>
      {children}
      {error.needsSignIn && <p><Link href="/merchant/login" target="_blank" rel="noopener">Open merchant sign-in in a new tab</Link></p>}
    </ErrorMessage>
  );
}

export function ProductIdentityFields({ name, category, onName, onCategory, issues = {} }: {
  name: string;
  category: string;
  onName: (value: string) => void;
  onCategory: (value: string) => void;
  issues?: Record<string, string>;
}) {
  return (
    <div className="product-identity-fields">
      <div className="product-field">
        <label htmlFor="name">Product name <span className="product-required">Required</span></label>
        <input id="name" value={name} onChange={event => onName(event.target.value)} maxLength={120} required
          aria-invalid={issues.name ? true : undefined} aria-describedby={issues.name ? "name-error" : undefined} />
        {issues.name && <span className="product-field-error" id="name-error">{issues.name}</span>}
      </div>
      <div className="product-field">
        <label htmlFor="category">Category</label>
        <input id="category" value={category} onChange={event => onCategory(event.target.value)} maxLength={80}
          aria-invalid={issues.category ? true : undefined} aria-describedby={issues.category ? "category-error" : "category-help"} />
        <span className="product-field-help" id="category-help">Group similar products with the same category. Required before listing.</span>
        {issues.category && <span className="product-field-error" id="category-error">{issues.category}</span>}
      </div>
    </div>
  );
}

export function MerchantProductDraft(session: MerchantSession) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [nameIssue, setNameIssue] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const command = useCatalogueCommand(session);
  const field = command.error?.problem?.fieldErrors?.[0]?.field;
  const issues = field && command.error ? { [field]: command.error.message } : { name: nameIssue };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (command.busy || command.retry || createdId) return;
    if (!name.trim()) {
      command.clearError();
      setNameIssue("Enter a product name.");
      event.currentTarget.querySelector("input")?.focus();
      return;
    }
    const input = { name: name.trim(), category: category.trim() || null };
    const key = crypto.randomUUID();
    void command.execute({ label: "Retry draft creation", run: async csrfToken => {
      const product = await createProduct(input, csrfToken, key);
      setCreatedId(product.id);
      router.replace(productPagePath(product.id));
    } });
  }

  return (
    <>
      {command.error && <CatalogueProblem error={command.error} />}
      {!command.error && nameIssue && <ErrorMessage>{nameIssue}</ErrorMessage>}
      {command.retry && (
        <p>{command.error?.needsSignIn ? "Sign in to the same merchant account, then retry." :
          "The draft may already exist. Retry this request to recover it without creating a duplicate."}</p>
      )}
      <div className="product-draft-layout">
      <form className="surface product-basics-card" onSubmit={submit}>
        <fieldset className="product-fieldset-reset" disabled={command.busy || !!command.retry || !!createdId}>
          <legend className="visually-hidden">Draft details</legend>
          <div className="product-section-heading"><span className="product-section-icon"><Icon name="cake" size={22} /></span><div><h2>Product basics</h2><p>Give your new dessert a name and a place on your menu.</p></div></div>
          <ProductIdentityFields name={name} category={category} issues={issues}
            onName={value => { setName(value); setNameIssue(""); command.clearError(); }}
            onCategory={value => { setCategory(value); command.clearError(); }} />
          <div className="product-save-bar"><p><Icon name="lock" size={16} /> Drafts stay private until you list them.</p><button type="submit">{command.busy ? "Creating draft…" : "Create draft"}<Icon name="arrow" size={16} /></button></div>
        </fieldset>
      </form>
      <aside className="surface product-draft-guide" aria-labelledby="draft-next"><p className="eyebrow">From idea to menu</p><h2 id="draft-next">A little prep, then publish.</h2>
        <ol><li><span>01</span><div><h3>Create your draft</h3><p>Start with a name. You can change these details later.</p></div></li>
          <li><span>02</span><div><h3>Add the delicious details</h3><p>Set variants, flavours and prices, then add your photos.</p></div></li>
          <li><span>03</span><div><h3>Review and list</h3><p>Add a category and an available variant before listing for customers.</p></div></li></ol>
      </aside>
      </div>
      {command.retry && (
        <button type="button" disabled={command.busy} onClick={() => command.retry && void command.execute(command.retry)}>
          {command.retry.label}
        </button>
      )}
      <p role="status">{command.busy && "Creating draft…"}{createdId && <>Draft created. <Link href={productPagePath(createdId)}>Open editor</Link></>}</p>
    </>
  );
}

export function MerchantCatalogue({ csrfToken }: { csrfToken: string }) {
  const [filter, setFilter] = useState<ProductStatus | "">("");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ page: ProductPage; filter: ProductStatus | ""; number: number } | null>(null);
  const [error, setError] = useState<CatalogueError | null>(null);
  const [busy, setBusy] = useState(true);
  const cursor = cursors[cursors.length - 1];
  const pageNumber = cursors.length;

  useEffect(() => {
    const controller = new AbortController();
    void readProducts(filter, cursor, controller.signal).then(page => {
      if (!controller.signal.aborted) setResult({ page, filter, number: pageNumber });
    }).catch((failure: CatalogueError) => {
      if (!controller.signal.aborted) {
        if (failure.needsSignIn) setResult(null);
        setError(failure);
      }
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [cursor, filter, pageNumber, refresh, csrfToken]);

  function reload() {
    setError(null);
    setBusy(true);
    setRefresh(value => value + 1);
  }

  return (
    <>
      <section className="surface catalogue-filter-panel" aria-labelledby="catalogue-filters-title">
        <div className="catalogue-section-heading"><div><h2 id="catalogue-filters-title">Find your products</h2><p>Choose a publication status to manage your menu.</p></div>
          <button className="button-secondary" type="button" disabled={busy} onClick={reload}>Refresh products</button>
        </div>
        <div className="catalogue-filter-controls"><div>
        <label htmlFor="catalogue-status">Publication status</label>
        <Select id="catalogue-status" value={filter} onChange={event => {
          setFilter(event.target.value as ProductStatus | "");
          setCursors([null]);
          reload();
        }}>
          <option value="">All statuses</option>
          {Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        </div>
        {filter && <button className="button-quiet" type="button" onClick={() => { setFilter(""); setCursors([null]); reload(); }}>Clear filter</button>}
        </div>
        <p className="catalogue-filter-help">Drafts stay private until you list them. Open a product to manage photos, variants and pricing.</p>
      </section>
      <p className={"catalogue-load-status" + (busy ? "" : " visually-hidden")} role="status">
        {busy ? "Loading products…" : result && !error ? `Page ${result.number}. ${result.page.items.length} products.` : ""}
      </p>
      {error && (
        <>
          <CatalogueProblem error={error} />
          <button className="button-secondary" type="button" disabled={busy} onClick={reload}>Retry loading products</button>
        </>
      )}
      {result && !error?.needsSignIn && (
        <section className="catalogue-results" aria-label="Catalogue results" aria-busy={busy}>
          {(busy || error) && <p className="catalogue-stale-note">Last loaded results · {result.filter ? statusNames[result.filter] : "All statuses"} · Page {result.number}</p>}
          <dl className="catalogue-page-summary" aria-label="Current page summary">
            <div><dt>Products on this page</dt><dd>{result.page.items.length}</dd></div>
            <div><dt>Listed on this page</dt><dd>{result.page.items.filter(product => product.status === "LISTED").length}</dd></div>
            <div><dt>Drafts on this page</dt><dd>{result.page.items.filter(product => product.status === "DRAFT").length}</dd></div>
          </dl>
          <div className="catalogue-section-heading catalogue-results-heading"><div><h2>Your products</h2><p>{result.filter ? statusNames[result.filter] : "All publication statuses"} · Page {result.number}</p></div>
            <span className="capacity-status">{result.page.items.length} {result.page.items.length === 1 ? "product" : "products"}</span>
          </div>
          {result.page.items.length === 0 ? <div className="surface catalogue-empty"><span className="catalogue-empty-icon"><Icon name="cake" size={32} /></span>
            <h3>{result.filter ? "No " + statusNames[result.filter].toLowerCase() + " products" : "Your menu starts here"}</h3>
            <p>{result.filter ? "Choose another publication status to find your products." : "Create your first product draft, then add photos, variants and prices before listing it."}</p>
            {result.filter ? <button className="button-secondary" type="button" disabled={busy} onClick={() => { setFilter(""); setCursors([null]); reload(); }}>Show all products</button>
              : <Link className="button" href="/merchant/catalog/new">Add your first product <Icon name="arrow" size={16} /></Link>}
          </div> : (
            <ul className="catalogue-product-grid" aria-label="Products">
              {result.page.items.map(product => <MerchantProductCard key={product.id} product={product} />)}
            </ul>
          )}
          {(pageNumber > 1 || result.page.nextCursor) && (
            <nav className="catalogue-pagination" aria-label="Catalogue pagination">
              <button className="button-secondary" type="button" disabled={busy || pageNumber === 1} onClick={() => {
                setCursors(cursors.slice(0, -1));
                reload();
              }}>Previous page</button><span>Page {result.number}</span>
              <button type="button" disabled={busy || !!error || !result.page.nextCursor} onClick={() => {
                setCursors([...cursors, result.page.nextCursor]);
                reload();
              }}>Next page</button>
            </nav>
          )}
        </section>
      )}
      {busy && !result && <div className="catalogue-product-grid catalogue-loading" aria-hidden="true">{[1, 2, 3].map(item => <div className="catalogue-loading-card" key={item}><div /><span /><span /></div>)}</div>}
    </>
  );
}
