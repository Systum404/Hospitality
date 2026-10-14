import { CheckCircle2, Clock3, CookingPot, PackageCheck } from "lucide-react";
import { CopyableIdentifier } from "../../../components/ui/CopyableIdentifier.jsx";
import { formatPublicOrderTimestamp, ORDER_STATUS_PRESENTATION } from "../services/orderTracking.js";

const statusIcons = { pending: Clock3, preparing: CookingPot, ready: PackageCheck, completed: CheckCircle2 };

export function OrderTrackingDetails({ announcement = "", order }) {
  const presentation = ORDER_STATUS_PRESENTATION[order.status] || ORDER_STATUS_PRESENTATION.pending;
  const StatusIcon = statusIcons[order.status] || Clock3;
  return (
    <section aria-labelledby="order-tracking-title" className="public-confirmation public-tracking">
      <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">{announcement}</p>
      <StatusIcon aria-hidden="true" size={44} />
      <p className="public-order-eyebrow">{order.hotel.name}</p>
      <h1 id="order-tracking-title">{presentation.label}</h1>
      <p>{presentation.description}</p>
      <div className="public-confirmation__reference"><span>Order number</span><strong><CopyableIdentifier label="order ID" value={order.order_number} /></strong><span className={`badge ${order.status === "completed" ? "badge--success" : "badge--warning"}`}>{presentation.label}</span></div>
      <p>{order.context.label}</p>
      <div className="public-confirmation__items">{order.items.map((item, index) => <article key={`${item.name}-${index}`}><div><strong>{item.name}</strong>{item.special_instructions ? <small>{item.special_instructions}</small> : null}</div><b>× {item.quantity}</b></article>)}</div>
      {order.notes ? <div className="public-confirmation__notes"><strong>Order notes</strong><p>{order.notes}</p></div> : null}
      <time dateTime={order.created_at}>Submitted {formatPublicOrderTimestamp(order.created_at, order.hotel.timezone)}</time>
      {order.completed_at ? <time dateTime={order.completed_at}>Completed {formatPublicOrderTimestamp(order.completed_at, order.hotel.timezone)}</time> : null}
    </section>
  );
}
