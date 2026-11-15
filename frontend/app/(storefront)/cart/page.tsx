import Link from "next/link";
import { readBackend, type BackendRead } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { CartControls } from "@/ui/cart-controls";

export default async function CartPage() {
  const session = await requirePageSession("CUSTOMER");
  const cart = await readBackend<BackendRead<"getCart">>("cart");
  return (
    <main>
      <header className="page-heading"><div><p className="eyebrow">Your selection</p><h1>Your cart</h1><p>Review your desserts and quantities before checkout.</p></div>
        <Link className="button button-quiet" href="/shop">Continue shopping</Link></header>
      <CartControls initialCart={cart} csrfToken={session.csrfToken} />
    </main>
  );
}
