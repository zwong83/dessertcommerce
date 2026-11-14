import type { AdminOrder, Charge, Order } from "./standard-model";
import { fulfilmentNames, label, localTime, money, orderStatuses } from "./standard-model";

export function Time({ at }: { at: string }) {
  return <time dateTime={at}>{localTime(at)}</time>;
}

export function OrderDetails({ order, contactPhone }: { order: Order | AdminOrder; contactPhone: string }) {
  const address = order.address;
  return (
    <>
      <p role="status">{orderStatuses[order.status]}</p>
      {order.safeOutcome && <p>{order.safeOutcome}</p>}
      <section aria-label="Handoff and tracking">
        <h2>Handoff and tracking</h2>
        <p>{fulfilmentNames[order.fulfilment]}</p>
        {order.pickupDisplay && <p>{order.pickupDisplay}</p>}
        {address && <p>{[address.line1, address.city, address.postcode, address.region].join(", ")}{address.note && <> · {address.note}</>}</p>}
        {order.fulfilment === "CUSTOMER_LALAMOVE" && <p>You pay Lalamove directly. The external delivery fee is separate from the order total.</p>}
        <ul className="item-list">
          <li>Requested handoff <Time at={order.requestedHandoffAt} /></li>
          <li>Promised handoff {order.promisedHandoffAt ? <Time at={order.promisedHandoffAt} /> : "Pending confirmation"}</li>
          {order.readyAt && <li>Ready at <Time at={order.readyAt} /></li>}
          {order.driverArrivedAt && <li>Driver arrived at <Time at={order.driverArrivedAt} /></li>}
          {order.handoffAt && <li>{order.fulfilment === "PICKUP" ? "Collected at" : "Handed off at"} <Time at={order.handoffAt} /></li>}
        </ul>
      </section>
      <section aria-label="Captured order details">
        <h2>Order details</h2>
        <p>{order.contactName} · {contactPhone}{order.notificationEmail && <> · {order.notificationEmail}</>}</p>
        <ul className="item-list">
          {order.items.map(item => <li key={item.variantId}>{item.quantity} × {item.product} · {item.variant} · {item.flavour} · {money(item.unitMinor)} each</li>)}
        </ul>
        <p>Subtotal {money(order.subtotalMinor)}</p>
        {order.feeMinor !== null && <p>Delivery fee {money(order.feeMinor)}</p>}
        {order.totalMinor !== null ? <p><strong>Agreed total {money(order.totalMinor)}</strong></p> : <p>Delivery fee and total are pending agreement.</p>}
        <details><summary>Captured terms</summary><p>{order.termsText}</p></details>
      </section>
    </>
  );
}

export function ChargeDetails({ charge }: { charge: Charge }) {
  return (
    <>
      <p role="status">{label(charge.state)}</p>
      <p>Expected {money(charge.expectedMinor)} · Verified {money(charge.paidMinor)} · Refunded {money(charge.refundedMinor)}</p>
      {charge.requiredRefundMinor > 0 && <p>Refund still owed {money(charge.requiredRefundMinor)}</p>}
      {charge.topUp ? (
        <div>
          <p><strong>Top-up {money(charge.topUp.outstandingMinor)}</strong></p>
          <p>Top-up proof deadline <Time at={charge.topUp.dueAt} /></p>
          {charge.topUp.status === "UNDER_REVIEW" && <p role="status">Top-up proof is under review. Timely proof keeps the production hold during review.</p>}
        </div>
      ) : (
        <>
          {charge.dueAt && <p>Original proof deadline <Time at={charge.dueAt} /></p>}
          {charge.reviewStatus === "UNDER_REVIEW" && <p role="status">Proof is under review. The merchant will verify the funds separately.</p>}
        </>
      )}
    </>
  );
}
