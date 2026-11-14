import type { ReactNode } from "react";
import { cookies } from "next/headers";
import type { components } from "@/contracts/customer-auth-v1";
import { readBackend } from "@/server/http/backend-client";
import { ApiProblem } from "@/server/http/problem";
import { sessionCookieName } from "@/server/http/request";
import { SiteShell } from "@/ui/site-shell";

export default async function StorefrontLayout({ children }: { children: ReactNode }) {
  let displayName: string | null = null;
  let customerSignedIn = false;
  if ((await cookies()).has(sessionCookieName)) {
    try {
      const profile = await readBackend<components["schemas"]["CustomerProfile"]>("auth/customer/profile");
      displayName = profile.displayName;
      customerSignedIn = true;
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
    }
  }
  return <SiteShell displayName={displayName} customerSignedIn={customerSignedIn}>{children}</SiteShell>;
}
