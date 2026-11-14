import Link from "next/link";
import { requirePageSession } from "@/server/http/page-session";
import { MerchantCatalogue } from "@/ui/merchant-catalog";

export default async function MerchantCataloguePage() {
  const { accountId, csrfToken } = await requirePageSession("ADMIN");
  return (
    <main>
      <header className="page-heading"><div><p className="eyebrow">The menu</p><h1>Product catalogue</h1><p>Manage the desserts, photos and options customers see in the shop.</p></div>
        <Link className="button" href="/merchant/catalog/new">Add product</Link></header>
      <MerchantCatalogue key={accountId} csrfToken={csrfToken} />
    </main>
  );
}
