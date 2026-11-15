"use client";

import { useRouter } from "next/navigation";
import { RouteFailure } from "@/ui/standard-forms";

export default function MerchantError({ reset }: { reset: () => void }) {
  const router = useRouter();
  return <RouteFailure back={{ href: "/merchant", label: "Return to the merchant workspace" }} retry={() => { router.refresh(); reset(); }} />;
}
