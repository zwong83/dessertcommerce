"use client";

import { Select } from "@/ui/select";
import { ErrorMessage } from "./error-message";
import { Icon } from "./icons";
import { MerchantProductCard } from "./merchant-catalog-card";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  CatalogueError, cataloguePath, createProduct, productPagePath, refreshMerchantSession, statusNames,
  type MerchantSession, type Product,
} from "./merchant-catalog-model";

import {
  cataloguePageSize, defaultCatalogueFilters, filterCatalogue, readCatalogue, type CatalogueFilters,
} from "./merchant-catalog-filters";

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
  const [filters, setFilters] = useState<CatalogueFilters>(defaultCatalogueFilters);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<CatalogueError | null>(null);
  const [busy, setBusy] = useState(true);
  const searchInput = useRef<HTMLInputElement>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError(null);
    void readCatalogue(controller.signal).then(items => {
      if (!controller.signal.aborted) setProducts(items);
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const issue = failure instanceof CatalogueError ? failure
        : new CatalogueError(null, 0, "The catalogue could not be loaded. Please try again.");
      if (issue.needsSignIn) setProducts(null);
      setError(issue);
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [refresh, csrfToken]);

  const categories = useMemo(() => [...new Set((products ?? []).flatMap(product =>
    product.category ? [product.category] : []))].sort((a, b) => a.localeCompare(b)), [products]);
  const matches = useMemo(() => filterCatalogue(products ?? [], filters), [products, filters]);
  const pages = Math.max(1, Math.ceil(matches.length / cataloguePageSize));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * cataloguePageSize;
  const visible = matches.slice(start, start + cataloguePageSize);
  const activeFilters = [
    ...(filters.search.trim() ? [{ key: "search" as const, label: `Search: ${filters.search.trim()}` }] : []),
    ...(filters.category ? [{ key: "category" as const, label: filters.category }] : []),
    ...(filters.status ? [{ key: "status" as const, label: statusNames[filters.status] }] : []),
    ...(filters.photos ? [{ key: "photos" as const, label: filters.photos === "with" ? "With photos" : "Missing photos" }] : []),
  ];

  function changeFilter<K extends keyof CatalogueFilters>(key: K, value: CatalogueFilters[K]) {
    setFilters(previous => ({ ...previous, [key]: value }));
    setPage(1);
  }
  function clearFilters() {
    setFilters(previous => ({ ...defaultCatalogueFilters, sort: previous.sort }));
    setPage(1);
    searchInput.current?.focus();
  }
  function reload() {
    setError(null);
    setBusy(true);
    setRefresh(value => value + 1);
  }
  function changePage(next: number) {
    setPage(next);
    resultsHeading.current?.focus();
  }

  return (
    <>
      <section className="surface catalogue-filter-panel" aria-labelledby="catalogue-filters-title">
        <div className="catalogue-section-heading"><div><h2 id="catalogue-filters-title">Find your products</h2>
          <p>Search your whole menu, then narrow it down.</p></div>
          <button className="button-secondary" type="button" disabled={busy} onClick={reload}>{busy ? "Refreshing…" : "Refresh products"}</button>
        </div>
        <div className="catalogue-search-row">
          <div className="catalogue-search-field">
            <label htmlFor="catalogue-search">Search products</label>
            <div className="catalogue-search-input"><Icon name="search" size={20} />
              <input ref={searchInput} id="catalogue-search" type="search" value={filters.search}
                placeholder="Try tart, Christmas or chocolate…" maxLength={120}
                aria-describedby="catalogue-search-help" aria-controls="catalogue-product-results"
                onChange={event => changeFilter("search", event.target.value)}
                onKeyDown={event => { if (event.key === "Escape") changeFilter("search", ""); }} />
              {filters.search && <button type="button" className="catalogue-search-clear" aria-label="Clear search"
                onClick={() => { changeFilter("search", ""); searchInput.current?.focus(); }}><Icon name="close" size={18} /></button>}
            </div>
            <p id="catalogue-search-help" className="catalogue-filter-help">Find a product by name, category, flavour or variant.</p>
          </div>
          <div className="catalogue-sort-field"><label htmlFor="catalogue-sort">Sort by</label>
            <Select id="catalogue-sort" value={filters.sort} onChange={event => changeFilter("sort", event.target.value as CatalogueFilters["sort"])}>
              <option value="name">Name: A–Z</option><option value="name-desc">Name: Z–A</option>
              <option value="price-low">Starting price: low to high</option><option value="price-high">Starting price: high to low</option>
            </Select>
          </div>
        </div>
        <div className="catalogue-filter-controls">
          <div><label htmlFor="catalogue-category">Category</label>
            <Select id="catalogue-category" value={filters.category} disabled={!products} onChange={event => changeFilter("category", event.target.value)}>
              <option value="">All categories</option>
              {categories.map(category => <option key={category} value={category}>{category}</option>)}
            </Select>
          </div>
          <div><label htmlFor="catalogue-status">Publication status</label>
            <Select id="catalogue-status" value={filters.status} onChange={event => changeFilter("status", event.target.value as CatalogueFilters["status"])}>
              <option value="">All statuses</option>
              {Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </div>
          <div><label htmlFor="catalogue-photos">Product photos</label>
            <Select id="catalogue-photos" value={filters.photos} onChange={event => changeFilter("photos", event.target.value as CatalogueFilters["photos"])}>
              <option value="">All products</option><option value="with">With photos</option><option value="without">Missing photos</option>
            </Select>
          </div>
        </div>
        {activeFilters.length > 0 && <div className="catalogue-active-filters" aria-label="Active filters">
          <span>Filtered by</span>
          {activeFilters.map(({ key, label }) => <button type="button" className="catalogue-filter-chip" key={key}
            aria-label={`Remove ${label} filter`} onClick={() => { changeFilter(key, ""); searchInput.current?.focus(); }}>
            <span>{label}</span><Icon name="close" size={14} /></button>)}
          <button className="button-quiet" type="button" onClick={clearFilters}>Clear all</button>
        </div>}
      </section>
      <p className={"catalogue-load-status" + (busy ? "" : " visually-hidden")} role="status" aria-atomic="true">
        {busy ? "Loading your full catalogue…" : products && !error
          ? `${matches.length} ${matches.length === 1 ? "product" : "products"} found. ${matches.length ? `Showing ${start + 1}–${start + visible.length}. Page ${currentPage} of ${pages}.` : "Try another search or clear your filters."}` : ""}
      </p>
      {error && <><CatalogueProblem error={error} />
        <button className="button-secondary" type="button" disabled={busy} onClick={reload}>Retry loading products</button></>}
      {products && !error?.needsSignIn && (
        <section id="catalogue-product-results" className="catalogue-results" aria-label="Catalogue results" aria-busy={busy}>
          {(busy || error) && <p className="catalogue-stale-note">Showing the last loaded catalogue. {error ? "Refresh to get the latest products." : "Updating products…"}</p>}
          <dl className="catalogue-page-summary" aria-label="Catalogue summary">
            <div><dt>Total products</dt><dd>{products.length}</dd></div>
            <div><dt>Matching products</dt><dd>{matches.length}</dd></div>
            <div><dt>Missing photos in results</dt><dd>{matches.filter(product => !product.imageRefs.length).length}</dd></div>
          </dl>
          <div className="catalogue-section-heading catalogue-results-heading"><div>
            <h2 ref={resultsHeading} tabIndex={-1}>Your products</h2>
            <p>{matches.length ? `Showing ${start + 1}–${start + visible.length} of ${matches.length} products` : "No products to show"}
              {activeFilters.length > 0 && " · Filters applied"}</p></div>
            <span className="capacity-status">{matches.length} {matches.length === 1 ? "product" : "products"}</span>
          </div>
          {matches.length === 0 ? <div className="surface catalogue-empty"><span className="catalogue-empty-icon"><Icon name={activeFilters.length ? "search" : "cake"} size={32} /></span>
            <h3>{activeFilters.length ? "No products match your filters" : "Your menu starts here"}</h3>
            <p>{activeFilters.length ? "Try a shorter search, choose another category, or clear your filters to see the whole menu."
              : "Create your first product draft, then add photos, variants and prices before listing it."}</p>
            {activeFilters.length ? <button className="button-secondary" type="button" onClick={clearFilters}>Clear all filters</button>
              : <Link className="button" href="/merchant/catalog/new">Add your first product <Icon name="arrow" size={16} /></Link>}
          </div> : <ul className="catalogue-product-grid" aria-label="Products">
            {visible.map(product => <MerchantProductCard key={product.id} product={product} />)}
          </ul>}
          {pages > 1 && <nav className="catalogue-pagination" aria-label="Catalogue pagination">
            <button className="button-secondary" type="button" disabled={busy || currentPage === 1} onClick={() => changePage(currentPage - 1)}>Previous page</button>
            <span>Page {currentPage} of {pages}</span>
            <button type="button" disabled={busy || currentPage === pages} onClick={() => changePage(currentPage + 1)}>Next page</button>
          </nav>}
        </section>
      )}
      {busy && !products && <div className="catalogue-product-grid catalogue-loading" aria-hidden="true">{[1, 2, 3].map(item => <div className="catalogue-loading-card" key={item}><div /><span /><span /></div>)}</div>}
    </>
  );
}
