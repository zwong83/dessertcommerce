import Link from "next/link";
import { readBackend, type BackendRead } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { Checkout } from "@/ui/checkout";

export default async function CheckoutPage() {
  const session = await requirePageSession("CUSTOMER");
  const cart = await readBackend<BackendRead<"getCart">>("cart");
  return <main><h1>Checkout</h1><p><Link href="/cart">Back to cart</Link></p><Checkout cart={cart} csrfToken={session.csrfToken} /></main>;
}
