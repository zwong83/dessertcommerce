import Link from "next/link";
import { requirePageSession } from "@/server/http/page-session";
import { MerchantCatalogue } from "@/ui/merchant-catalog";

export default async function MerchantCataloguePage() {
  const { accountId, csrfToken } = await requirePageSession("ADMIN");
  return (
    <main>
      <p><Link href="/merchant">Merchant workspace</Link></p>
      <h1>Product catalogue</h1>
      <MerchantCatalogue key={accountId} csrfToken={csrfToken} />
    </main>
  );
}
