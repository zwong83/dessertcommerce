import { redirect } from "next/navigation";
import { SignIn } from "@/ui/sign-in";
import { AuthPage } from "@/ui/auth-page";

export const dynamic = "force-dynamic";

export default function RecoverMerchantAccess() {
  if (process.env.SWEETCOMMERCE_MERCHANT_CODE_AUTHENTICATION !== "true") redirect("/merchant/login");

  return (
    <AuthPage merchant title="Recover merchant access" description="Verify your enrolled phone or email to reset your merchant login. Then ask your store administrator for a new private setup link.">
      <SignIn mode="recovery" />
    </AuthPage>
  );
}
