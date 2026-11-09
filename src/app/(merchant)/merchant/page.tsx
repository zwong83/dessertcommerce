import Link from "next/link";
import { requirePageSession } from "@/server/http/page-session";
import { Logout } from "@/ui/logout";

export default async function MerchantWorkspace() {
  const session = await requirePageSession("ADMIN");
  return (
    <main>
      <h1>Merchant workspace</h1>
      <p>You are signed in with the dedicated merchant account.</p>
      <nav aria-label="Merchant operations"><ul><li><Link href="/merchant/work">Standard order work</Link></li><li><Link href="/merchant/capacity">Production calendar</Link></li><li><Link href="/merchant/catalog">Product catalogue</Link></li><li><Link href="/merchant/reports">Reports</Link></li></ul></nav>
      <Logout csrfToken={session.csrfToken} login="/merchant/login" />
    </main>
  );
}
