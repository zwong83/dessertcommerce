import { redirect } from "next/navigation";

export default function MerchantEventsPage() {
  redirect("/merchant/work?kind=EVENT");
}
