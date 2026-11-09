import Link from "next/link";
import { SignIn } from "@/ui/sign-in";

export default function MerchantSignIn() {
  return (
    <main>
      <h1>Merchant sign-in</h1>
      <p>Use a contact enrolled for the Gather Dessert administrator.</p>
      <SignIn mode="merchant" />
      <p><Link href="/merchant/recover">Recover merchant access</Link></p>
    </main>
  );
}
