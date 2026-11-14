import { AuthPage } from "@/ui/auth-page";
import { MerchantAccess } from "@/ui/merchant-access";

export default function MerchantSignIn() {
  return (
    <AuthPage merchant>
      <MerchantAccess />
    </AuthPage>
  );
}
