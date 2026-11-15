"use client";

import { useRouter } from "next/navigation";
import { RouteFailure } from "@/ui/standard-forms";

export default function OrdersError({ reset }: { reset: () => void }) {
  const router = useRouter();
  return <RouteFailure back={{ href: "/orders", label: "Go to your newest orders" }} retry={() => { router.refresh(); reset(); }} />;
}
