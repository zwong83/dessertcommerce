import Link from "next/link";
import { readBackend, type BackendRead } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { Checkout } from "@/ui/checkout";

export default async function CheckoutPage() {
  const session = await requirePageSession("CUSTOMER");
  const cart = await readBackend<BackendRead<"getCart">>("cart");
  return <main><header className="page-heading"><div><p className="eyebrow">Your order</p><h1>Checkout</h1><p>Choose how and when to receive your desserts, then review your order.</p></div>
    <Link className="button button-quiet" href="/cart">Back to cart</Link></header><Checkout cart={cart} csrfToken={session.csrfToken} /></main>;
}
