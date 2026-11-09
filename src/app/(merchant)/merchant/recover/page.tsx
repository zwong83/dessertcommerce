import { SignIn } from "@/ui/sign-in";

export default function RecoverMerchantAccess() {
  return (
    <main>
      <h1>Recover merchant access</h1>
      <p>Verify an enrolled phone or email. If neither is available, use the merchant’s controlled support process.</p>
      <SignIn mode="recovery" />
    </main>
  );
}
