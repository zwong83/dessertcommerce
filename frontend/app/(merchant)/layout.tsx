import type { ReactNode } from "react";
import { SiteShell } from "@/ui/site-shell";

export default function MerchantLayout({ children }: { children: ReactNode }) {
  return <SiteShell merchant>{children}</SiteShell>;
}
