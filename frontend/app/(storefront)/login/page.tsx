import { CustomerAccess } from "@/ui/customer-access";
import { AuthPage } from "@/ui/auth-page";

export default async function CustomerSignIn({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const destination = next === "/events" || next === "/events/new" || next === "/profile" ? next : "/shop";
  return <AuthPage>
    <CustomerAccess destination={destination}
      customerPhoneVerification={process.env.SWEETCOMMERCE_CUSTOMER_PHONE_VERIFICATION === "true"} />
  </AuthPage>;
}
