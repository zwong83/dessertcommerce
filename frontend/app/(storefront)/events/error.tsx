"use client";

import { RouteFailure } from "@/ui/standard-forms";

export default function EventsError({ reset }: { reset: () => void }) {
  return <RouteFailure retry={reset} back={{ href: "/shop", label: "Back to shop" }} />;
}
