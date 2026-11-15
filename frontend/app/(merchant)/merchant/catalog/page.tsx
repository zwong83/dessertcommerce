import Link from "next/link";
import { requirePageSession } from "@/server/http/page-session";
import { MerchantCatalogue } from "@/ui/merchant-catalog";
import { Icon } from "@/ui/icons";

export default async function MerchantCataloguePage() {
  const { accountId, csrfToken } = await requirePageSession("ADMIN");
  return (
    <main className="wide-page merchant-catalogue-page">
      <header className="page-heading"><div><p className="eyebrow">The menu</p><h1>Product catalogue</h1><p>Manage the desserts, photos and options customers see in the shop.</p></div>
        <Link className="button" href="/merchant/catalog/new"><Icon name="cake" size={18} /> Add product</Link></header>
      <MerchantCatalogue key={accountId} csrfToken={csrfToken} />
    </main>
  );
}
