import Link from "next/link";
import { readBackend, type BackendRead } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { AddToCart } from "@/ui/cart-controls";
import { Logout } from "@/ui/logout";

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
    <main>
      <h1>Gather Dessert shop</h1>
      <nav aria-label="Shopping"><Link href="/cart">Your cart</Link> · <Link href="/orders">Your orders</Link> · <Link href="/events">Dessert table events</Link></nav>
      {products.items.length === 0 && <p>There are no desserts available in this view.</p>}
      <ul className="item-list">
        {products.items.map((product) => (
          <li key={product.id}>
            <h2>{product.name}</h2>
            {product.category && <p><Link href={"/shop?" + new URLSearchParams({ category: product.category })}>{product.category}</Link></p>}
            {product.imageRefs.map((id) => (
              // These images are served through the owner-scoped application boundary.
              <img key={id} src={"/api/v1/catalog/media/" + id} alt={product.name} loading="lazy" width={160} height={120} />
            ))}
            <ul className="item-list">
              {product.variants.filter((variant) => variant.available).map((variant) => (
                <li key={variant.id}>
                  <p>{variant.name} · {variant.flavour} · {currency.format(variant.unitMinor / 100)}</p>
                  <AddToCart variant={variant.id} csrfToken={session.csrfToken} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {products.nextCursor && <p><Link href={"/shop?" + next}>Next page</Link></p>}
      <Logout csrfToken={session.csrfToken} login="/login" />
    </main>
  );
}
