import { AuthPage } from "@/ui/auth-page";
import { MerchantAccess } from "@/ui/merchant-access";

export const dynamic = "force-dynamic";

export default function MerchantSignIn() {
  return (
    <AuthPage merchant asideContent={
      <div className="auth-aside-note">
        <p><strong>Setting up your merchant account?</strong></p>
        <p>Ask your store administrator for a private setup link, then open it to create your account.</p>
      </div>
    }>
      <MerchantAccess codeAuthenticationEnabled={process.env.SWEETCOMMERCE_MERCHANT_CODE_AUTHENTICATION === "true"} />
    </AuthPage>
  );
}
