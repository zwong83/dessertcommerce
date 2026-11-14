import Link from "next/link";
import { readBackend, type BackendRead } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { AddToCart } from "@/ui/cart-controls";
import { Logout } from "@/ui/logout";
import { Icon } from "@/ui/icons";

const currency = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" });

export default async function CustomerShop({ searchParams }: { searchParams: Promise<{ category?: string; cursor?: string }> }) {
  const session = await requirePageSession("CUSTOMER");
  const query = await searchParams;
  const category = typeof query.category === "string" && query.category.length <= 80 ? query.category : undefined;
  const cursor = typeof query.cursor === "string" ? query.cursor : undefined;
  const filters = new URLSearchParams();
  if (category) filters.set("category", category);
  if (cursor !== undefined) filters.set("cursor", cursor);
  const products = await readBackend<BackendRead<"listCatalog">>("catalog", filters.toString());
  const next = new URLSearchParams();
  if (category) next.set("category", category);
  if (products.nextCursor) next.set("cursor", products.nextCursor);

  return (
    <main className="wide-page">
      <header className="page-heading"><div><p className="eyebrow">The menu</p><h1>Gather Dessert shop</h1><p>Pick your flavours and add them to your cart. Choose pickup or delivery at checkout.</p></div>
        <Link className="button" href="/cart"><Icon name="bag" size={18} /> View cart</Link></header>
      {category && <div className="actions"><span className="chip">Category: {category}</span><Link href="/shop">Clear category</Link></div>}
      {products.items.length === 0 && <div className="empty-state"><h2>No desserts to show</h2><p>{category ? "Try browsing the full menu." : "Check back for more desserts."}</p>{category && <Link href="/shop" className="button">View all desserts</Link>}</div>}
      <ul className="product-grid">
        {products.items.map((product) => (
          <li key={product.id} className="product-card">
            {product.imageRefs.length ? <div className="product-photos">{product.imageRefs.map((id) => (
              <img key={id} src={"/api/v1/catalog/media/" + id} alt={product.name} loading="lazy" width={480} height={320} />
            ))}</div> : <div className="product-placeholder"><Icon name="cake" /></div>}
            <div className="product-info">
            {product.category && <Link className="chip" href={"/shop?" + new URLSearchParams({ category: product.category })}>{product.category}</Link>}
            <h2>{product.name}</h2>
            <ul className="variant-list">
              {product.variants.filter((variant) => variant.available).map((variant) => (
                <li key={variant.id}>
                  <div className="variant-row"><span><strong>{variant.name}</strong><small>{variant.flavour}</small></span><span className="price">{currency.format(variant.unitMinor / 100)}</span></div>
                  <AddToCart variant={variant.id} csrfToken={session.csrfToken} />
                </li>
              ))}
            </ul>
            </div>
          </li>
        ))}
      </ul>
      <div className="pagination">
        {cursor && <Link className="button button-quiet" href={category ? "/shop?" + new URLSearchParams({ category }) : "/shop"}>Back to first page</Link>}
        {products.nextCursor && <Link className="button button-secondary" href={"/shop?" + next}>More desserts <Icon name="arrow" size={16} /></Link>}
      </div>
      <Logout csrfToken={session.csrfToken} login="/login" />
    </main>
  );
}
