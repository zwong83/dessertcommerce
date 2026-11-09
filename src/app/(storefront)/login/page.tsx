import { SignIn } from "@/ui/sign-in";

export default function CustomerSignIn() {
  return (
    <main>
      <h1>Customer sign-in</h1>
      <p>Use the same verified phone number to find your cart on another device.</p>
      <SignIn mode="customer" />
    </main>
  );
}
