import Link from "next/link";
import { readBackend, type BackendRead } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { CartControls } from "@/ui/cart-controls";

export default async function CartPage() {
  const session = await requirePageSession("CUSTOMER");
  const cart = await readBackend<BackendRead<"getCart">>("cart");
  return (
    <main>
      <h1>Your cart</h1>
      <p><Link href="/shop">Continue shopping</Link> · <Link href="/orders">Your orders</Link></p>
      <CartControls initialCart={cart} csrfToken={session.csrfToken} />
      <p><Link href="/checkout">Review checkout</Link></p>
    </main>
  );
}
