import Link from "next/link";
import { notFound } from "next/navigation";
import { readBackend, type BackendRead } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { ApiProblem } from "@/server/http/problem";
import { CustomerOrder } from "@/ui/customer-order";
import { OrderDetails } from "@/ui/order-details";
import { uuid, whatsAppLink } from "@/ui/standard-model";

export default async function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { accountId, role, csrfToken } = await requirePageSession("CUSTOMER");
  const { orderId } = await params;
  if (!uuid.test(orderId)) notFound();
  let order: BackendRead<"getOwnOrder">;
  try {
    order = await readBackend<BackendRead<"getOwnOrder">>("orders/" + encodeURIComponent(orderId));
  } catch (error) {
    if (error instanceof ApiProblem && error.status === 404) notFound();
    throw error;
  }

  return (
    <main>
      <nav aria-label="Orders"><Link href="/orders">Your orders</Link> · <Link href="/shop">Shop</Link></nav>
      <h1>Order {order.number}</h1>
      <OrderDetails order={order} contactPhone={order.phone} />
      <CustomerOrder key={accountId + ":" + order.id} order={order} session={{ accountId, role, csrfToken }}
        whatsApp={whatsAppLink(process.env.SWEETCOMMERCE_WHATSAPP_URL)} />
    </main>
  );
}
