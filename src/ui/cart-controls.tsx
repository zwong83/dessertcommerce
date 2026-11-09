"use client";

import { useState } from "react";
import type { components } from "../contracts/standard-v1";

type Cart = components["schemas"]["Cart"];
const currency = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" });

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
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    setNotice("");
    try {
      const cart = await getCart();
      const quantity = (cart.lines.find((line) => line.variantId === variant)?.quantity ?? 0) + 1;
      const result = await writeQuantity(variant, quantity, cart.version, csrfToken);
      setNotice(result.conflict ? "Your cart changed. Try adding this item again." : "Added to your cart.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update your cart.");
    } finally {
      setBusy(false);
    }
  }

  return <div><button type="button" disabled={busy} onClick={add}>Add one</button><span role="status"> {notice}</span></div>;
}

export function CartControls({ initialCart, csrfToken }: { initialCart: Cart; csrfToken: string }) {
  const [cart, setCart] = useState(initialCart);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function setQuantity(variantId: string, quantity: number) {
    setBusy(true);
    setNotice("");
    try {
      const result = await writeQuantity(variantId, quantity, cart.version, csrfToken);
      setCart(result.cart);
      setNotice(result.conflict ? "Your cart changed on another device. Review the current quantities." : "Cart updated.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update your cart.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {cart.lines.length === 0 && <p>Your cart is empty.</p>}
      <ul className="item-list">
        {cart.lines.map((line) => (
          <li key={line.variantId}>
            <strong>{line.product}</strong> · {line.variant} · {currency.format(line.unitMinor / 100)} each
            {!line.available && <p>This selection is no longer available.</p>}
            <form onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void setQuantity(line.variantId, Number(data.get("quantity")));
            }}>
              <label htmlFor={"qty-" + line.variantId}>Quantity for {line.product}</label>
              <input id={"qty-" + line.variantId} key={line.quantity} name="quantity" type="number"
                defaultValue={line.quantity} min={1} max={999} required />
              <button type="submit" disabled={busy || !line.available}>Save</button>
              <button type="button" disabled={busy} onClick={() => void setQuantity(line.variantId, 0)}>Remove</button>
            </form>
          </li>
        ))}
      </ul>
      <p><strong>Estimated subtotal: {currency.format(cart.referenceSubtotalMinor / 100)}</strong></p>
      <p role="status">{notice}</p>
    </>
  );
}
