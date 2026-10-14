import { AlertTriangle } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import { TableCustomerDetails } from "./TableCustomerDetails.jsx";

export function OrderReview({ cart, conflict, context, customer, customerErrors, customerRef, error, notes, onAbandon, onBack, onCustomerChange, onSubmit, submitting, uncertain }) {
  const estimated = cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0).toFixed(2);
  const target = context.qr.type === "room" ? `Room ${context.room.number}` : `${context.dining_area.name} · Table ${context.table.number}`;
  const pendingIsLocked = conflict || uncertain;
  const submit = event => {
    event.preventDefault();
    if (!submitting) onSubmit();
  };
  return (
    <form aria-labelledby="order-review-title" className="public-review" noValidate onSubmit={submit}>
      <p className="public-order-eyebrow">{context.hotel.name}</p>
      <h1 id="order-review-title">Review your order</h1>
      <p className="public-review__target">{target}</p>
      {context.qr.type === "dining_table" ? <TableCustomerDetails disabled={pendingIsLocked} errors={customerErrors} onChange={onCustomerChange} ref={customerRef} value={customer} /> : null}
      <div className="public-review__items">{cart.map(item => <article key={item.id}><div><strong>{item.name}</strong><span>{item.quantity} × ₹{item.price}</span>{item.special_instructions ? <small>{item.special_instructions}</small> : null}</div><b>₹{(Number(item.price) * item.quantity).toFixed(2)}</b></article>)}</div>
      {notes ? <div className="public-review__notes"><strong>Order notes</strong><p>{notes}</p></div> : null}
      <div className="public-review__total"><div><strong>Estimated total</strong><small>The hotel confirms the final amount after submission. No payment is collected here.</small></div><b>₹{estimated}</b></div>
      {error ? <div className={`public-submit-message${uncertain ? " public-submit-message--uncertain" : ""}`} role="alert"><AlertTriangle aria-hidden="true" size={20} /><div><strong>{uncertain ? "Submission status uncertain" : "Order not submitted"}</strong><p>{error}</p></div></div> : null}
      <footer><Button disabled={submitting} onClick={pendingIsLocked ? onAbandon : onBack} variant="ghost">{pendingIsLocked ? "Abandon and edit" : "Back to menu"}</Button>{!conflict ? <Button disabled={submitting || !cart.length} type="submit">{submitting ? "Submitting…" : uncertain ? "Retry submission" : "Place order"}</Button> : null}</footer>
    </form>
  );
}
