import Link from "next/link";

export default function Storefront() {
  return (
    <main>
      <h1>Gather Dessert</h1>
      <p>Sign in to browse desserts, manage orders or request a dessert table for your event.</p>
      <Link href="/login">Customer sign-in</Link>
      <p><Link href="/events">Dessert table events</Link></p>
    </main>
  );
}
