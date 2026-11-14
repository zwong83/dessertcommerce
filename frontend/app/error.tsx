"use client";

import { RouteFailure } from "@/ui/standard-forms";

export default function PageError({ reset }: { reset: () => void }) {
  return <RouteFailure retry={reset} back={{ href: "/", label: "Back to Gather Dessert" }} />;
}
