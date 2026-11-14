import { SignIn } from "@/ui/sign-in";
import { AuthPage } from "@/ui/auth-page";

export default function RecoverMerchantAccess() {
  return (
    <AuthPage merchant title="Recover merchant access" description="Verify your enrolled phone or email to reset your merchant login. After recovery, use Sign up to set a new username and password.">
      <SignIn mode="recovery" />
    </AuthPage>
  );
}
