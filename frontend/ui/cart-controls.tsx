"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "./icons";
import { ErrorMessage } from "./error-message";
import type { components } from "../contracts/standard-v1";

type Cart = components["schemas"]["Cart"];
type CartNotice = { message: string; error?: boolean };
const currency = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" });

function CartFeedback({ notice }: { notice: CartNotice | null }) {
  if (!notice) return null;
  return notice.error ? <ErrorMessage>{notice.message}</ErrorMessage> : <span role="status">{notice.message}</span>;
}

async function getCart(): Promise<Cart> {
  const response = await fetch("/api/v1/cart", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load your cart. Sign in again if your session expired.");
  return response.json() as Promise<Cart>;
}

async function writeQuantity(variant: string, quantity: number, version: number, csrfToken: string) {
  const response = await fetch("/api/v1/cart/items/" + variant, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json", "X-CSRF-Token": csrfToken,
      "If-Match": '"' + version + '"', "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ quantity }),
  });
  if (response.status === 409) return { cart: await getCart(), conflict: true };
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(problem?.message ?? "Could not update your cart.");
  }
  return { cart: await response.json() as Cart, conflict: false };
}

export function AddToCart({ variant, csrfToken }: { variant: string; csrfToken: string }) {
  const [notice, setNotice] = useState<CartNotice | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    setNotice(null);
    try {
      const cart = await getCart();
      const quantity = (cart.lines.find((line) => line.variantId === variant)?.quantity ?? 0) + 1;
      const result = await writeQuantity(variant, quantity, cart.version, csrfToken);
      setNotice({ message: result.conflict ? "Your cart changed. Try adding this item again." : "Added to your cart.", error: result.conflict });
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "Could not update your cart.", error: true });
    } finally {
      setBusy(false);
    }
  }

  return <div className="variant-actions"><button type="button" disabled={busy} onClick={add}><Icon name="bag" size={16} /> {busy ? "Adding…" : "Add to cart"}</button><CartFeedback notice={notice} /></div>;
}

export function CartControls({ initialCart, csrfToken }: { initialCart: Cart; csrfToken: string }) {
  const [cart, setCart] = useState(initialCart);
  const [notice, setNotice] = useState<CartNotice | null>(null);
  const [busy, setBusy] = useState(false);

  async function setQuantity(variantId: string, quantity: number) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await writeQuantity(variantId, quantity, cart.version, csrfToken);
      setCart(result.cart);
      setNotice({ message: result.conflict ? "Your cart changed on another device. Review the current quantities." : "Cart updated.", error: result.conflict });
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "Could not update your cart.", error: true });
    } finally {
      setBusy(false);
    }
  }

  if (!cart.lines.length) return <div className="empty-state">
    <span className="tile-icon"><Icon name="bag" /></span><h2>Your cart is empty</h2>
    <p>Find something sweet in the dessert menu.</p><Link className="button" href="/shop">Browse desserts</Link>
    <CartFeedback notice={notice} />
  </div>;

  const allAvailable = cart.lines.every(line => line.available);
  return (
    <div className="cart-layout">
      <div>
      <ul className="item-list">
        {cart.lines.map((line) => (
          <li key={line.variantId}>
            <div className="variant-row"><span><strong>{line.product}</strong><small>{line.variant}</small></span><span className="price">{currency.format(line.unitMinor / 100)} each</span></div>
            {!line.available && <p>This selection is no longer available.</p>}
            <form className="cart-quantity" onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void setQuantity(line.variantId, Number(data.get("quantity")));
            }}>
              <label htmlFor={"qty-" + line.variantId}>Quantity for {line.product}</label>
              <input id={"qty-" + line.variantId} key={line.quantity} name="quantity" type="number"
                defaultValue={line.quantity} min={1} max={999} required />
              <button className="button-secondary" type="submit" disabled={busy || !line.available}>Save quantity</button>
              <button className="button-quiet" type="button" disabled={busy} onClick={() => void setQuantity(line.variantId, 0)}>Remove</button>
            </form>
          </li>
        ))}
      </ul>
      <CartFeedback notice={notice} />
      </div>
      <aside className="surface cart-summary" aria-label="Cart summary">
        <h2>Order summary</h2><p>Estimated subtotal</p><p className="summary-price">{currency.format(cart.referenceSubtotalMinor / 100)}</p>
        <p>Any delivery fee will be confirmed separately.</p>
        {allAvailable ? <Link className="button" href="/checkout">Review checkout <Icon name="arrow" size={16} /></Link> : <p>Remove unavailable items before checkout.</p>}
      </aside>
    </div>
  );
}
