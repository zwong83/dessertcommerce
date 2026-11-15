import Link from "next/link";
import { requirePageSession } from "@/server/http/page-session";
import { MerchantProductDraft } from "@/ui/merchant-catalog";

export default async function NewMerchantProductPage() {
  const { accountId, csrfToken } = await requirePageSession("ADMIN");
  return (
    <main className="wide-page product-draft-page">
      <p className="product-breadcrumb"><Link href="/merchant/catalog">← Back to catalogue</Link></p>
      <div className="page-heading"><div><p className="eyebrow">Catalogue</p>
      <h1>Add product</h1>
      <p>Start with the basics. Bring your product to life in the editor.</p></div></div>
      <MerchantProductDraft key={accountId} accountId={accountId} csrfToken={csrfToken} />
    </main>
  );
}
