import { useState } from "react";
import { CheckCircle2, Copy, LocateFixed } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../../../components/ui/Button.jsx";
import { CopyableIdentifier } from "../../../components/ui/CopyableIdentifier.jsx";
import { copyTrackingLink, formatPublicOrderTimestamp, trackingLink } from "../services/orderTracking.js";

export function OrderConfirmation({ order, timezone, trackingCapability }) {
  const [copyFeedback, setCopyFeedback] = useState("");
  const link = trackingLink(trackingCapability);
  const copy = async () => {
    const result = await copyTrackingLink(link);
    setCopyFeedback(result.message);
    setTimeout(() => setCopyFeedback(""), 1500);
  };
  return (
    <section aria-labelledby="order-confirmation-title" className="public-confirmation">
      <CheckCircle2 aria-hidden="true" size={44} />
      <p className="public-order-eyebrow">Order confirmed</p>
      <h1 id="order-confirmation-title">Your order has been sent to hotel staff.</h1>
      <div className="public-confirmation__reference"><span>Order number</span><strong><CopyableIdentifier label="order ID" value={order.order_number} /></strong><span className="badge badge--warning">{order.status}</span></div>
      <p>{order.target.type === "room" ? `Room ${order.target.room_number}` : `${order.target.dining_area} · Table ${order.target.table_number}`}</p>
      <div className="public-confirmation__items">{order.items.map((item, index) => <article key={`${item.item_name}-${index}`}><div><strong>{item.item_name}</strong><span>{item.quantity} × ₹{item.unit_price}</span>{item.special_instructions ? <small>{item.special_instructions}</small> : null}</div><b>₹{item.subtotal}</b></article>)}</div>
      <dl><div><dt>Subtotal</dt><dd>₹{order.subtotal}</dd></div><div><dt>Tax</dt><dd>₹{order.tax_amount}</dd></div><div><dt>Discount</dt><dd>₹{order.discount_amount}</dd></div><div className="is-total"><dt>Total</dt><dd>₹{order.total_amount}</dd></div></dl>
      {order.notes ? <div className="public-confirmation__notes"><strong>Order notes</strong><p>{order.notes}</p></div> : null}
      <time dateTime={order.created_at}>Submitted {formatPublicOrderTimestamp(order.created_at, timezone)}</time>
      <div className="public-confirmation__actions">
        <Link className="button button--primary button--md" to={`/order-tracking#${trackingCapability}`}><span className="button__icon"><LocateFixed aria-hidden="true" size={17} /></span><span>Track Order</span></Link>
        <Button icon={Copy} onClick={copy} variant="secondary">{copyFeedback || "Copy tracking link"}</Button>
      </div>
      <span aria-live="polite" className="sr-only" role="status">{copyFeedback}</span>
      <small>No payment was collected. Please contact hotel staff if you need assistance.</small>
    </section>
  );
}
