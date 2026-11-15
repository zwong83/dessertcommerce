import { redirect } from "next/navigation";

export default function MerchantNoticesPage() {
  redirect("/merchant/work?kind=NOTICE");
}
