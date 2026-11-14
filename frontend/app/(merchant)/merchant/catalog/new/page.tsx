import Link from "next/link";
import { requirePageSession } from "@/server/http/page-session";
import { MerchantProductDraft } from "@/ui/merchant-catalog";

export default async function NewMerchantProductPage() {
  const { accountId, csrfToken } = await requirePageSession("ADMIN");
  return (
    <main>
      <p><Link href="/merchant/catalog">Back to catalogue</Link></p>
      <h1>New product draft</h1>
      <p>Create a draft to add variants, prices and photos. You can list the product from its editor.</p>
      <MerchantProductDraft key={accountId} accountId={accountId} csrfToken={csrfToken} />
    </main>
  );
}
