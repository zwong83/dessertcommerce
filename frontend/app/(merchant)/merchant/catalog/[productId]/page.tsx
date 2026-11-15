import { requirePageSession } from "@/server/http/page-session";
import { MerchantProductEditor } from "@/ui/merchant-catalog-editor";

export default async function MerchantProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { accountId, csrfToken } = await requirePageSession("ADMIN");
  const { productId } = await params;
  return (
    <main className="wide-page product-editor-page">
      <MerchantProductEditor key={`${accountId}:${productId}`} productId={productId} accountId={accountId} csrfToken={csrfToken} />
    </main>
  );
}
