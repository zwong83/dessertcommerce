"use client";

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

export function CatalogueProblem({ error, children }: { error: CatalogueError; children?: ReactNode }) {
  return (
    <div role="alert">
      <p>{error.message}{error.problem?.requestId && <> Reference: {error.problem.requestId}.</>}</p>
      {children}
      {error.needsSignIn && <p><Link href="/merchant/login" target="_blank" rel="noopener">Open merchant sign-in in a new tab</Link></p>}
    </div>
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
    <>
      <p>
        <label htmlFor="name">Product name</label><br />
        <input id="name" value={name} onChange={event => onName(event.target.value)} maxLength={120} required
          aria-invalid={issues.name ? true : undefined} aria-describedby={issues.name ? "name-error" : undefined} />
        {issues.name && <span id="name-error"> {issues.name}</span>}
      </p>
      <p>
        <label htmlFor="category">Category</label><br />
        <input id="category" value={category} onChange={event => onCategory(event.target.value)} maxLength={80}
          aria-invalid={issues.category ? true : undefined} aria-describedby={issues.category ? "category-error" : "category-help"} />
        <span id="category-help"> Use the same category name for products you want to group. Required to list.</span>
        {issues.category && <span id="category-error"> {issues.category}</span>}
      </p>
    </>
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
      {command.retry && (
        <p>{command.error?.needsSignIn ? "Sign in to the same merchant account, then retry." :
          "The draft may already exist. Retry this request to recover it without creating a duplicate."}</p>
      )}
      <form onSubmit={submit}>
        <fieldset disabled={command.busy || !!command.retry || !!createdId} style={{ minWidth: 0, width: "100%" }}>
          <legend>Draft details</legend>
          <ProductIdentityFields name={name} category={category} issues={issues}
            onName={value => { setName(value); setNameIssue(""); command.clearError(); }}
            onCategory={value => { setCategory(value); command.clearError(); }} />
          <button type="submit">Create draft</button>
        </fieldset>
      </form>
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
      <p><Link href={cataloguePath + "/new"}>Create a product draft</Link></p>
      <p>
        <label htmlFor="catalogue-status">Filter by publication status</label><br />
        <select id="catalogue-status" value={filter} onChange={event => {
          setFilter(event.target.value as ProductStatus | "");
          setCursors([null]);
          reload();
        }}>
          <option value="">All statuses</option>
          {Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </p>
      <p role="status">
        {busy ? "Loading products…" : result && !error ? `Page ${result.number}. ${result.page.items.length} products.` : ""}
      </p>
      {error && (
        <>
          <CatalogueProblem error={error} />
          <button type="button" onClick={reload}>Retry loading products</button>
        </>
      )}
      {result && !error?.needsSignIn && (
        <section aria-label="Catalogue results" aria-busy={busy} style={{ overflowWrap: "anywhere" }}>
          {(busy || error) && <p>Last loaded results · {result.filter ? statusNames[result.filter] : "All statuses"} · Page {result.number}</p>}
          {result.page.items.length === 0 ? <p>No products match this view.</p> : (
            <ul className="item-list">
              {result.page.items.map(product => (
                <li key={product.id}>
                  <Link href={productPagePath(product.id)}>{product.name}</Link>
                  <br />{product.category ?? "Uncategorized"} · {statusNames[product.status]} · {product.variants.length} variants
                </li>
              ))}
            </ul>
          )}
          {(pageNumber > 1 || result.page.nextCursor) && (
            <p>
              <button type="button" disabled={busy || pageNumber === 1} onClick={() => {
                setCursors(cursors.slice(0, -1));
                reload();
              }}>Previous page</button>{" "}
              <button type="button" disabled={busy || !!error || !result.page.nextCursor} onClick={() => {
                setCursors([...cursors, result.page.nextCursor]);
                reload();
              }}>Next page</button>
            </p>
          )}
        </section>
      )}
    </>
  );
}
