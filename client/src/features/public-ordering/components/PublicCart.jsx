import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import { PUBLIC_ORDER_MAX_QUANTITY } from "../services/publicOrderRules.js";

export function PublicCart({ cart, notes, onChangeInstructions, onChangeNotes, onQuantity, onRemove, onReview }) {
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const estimated = cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0).toFixed(2);
  return (
    <aside aria-labelledby="public-cart-title" className="public-cart">
      {cart.length ? <div className="public-cart-mobile" aria-label={`${count} ${count === 1 ? "item" : "items"} in cart`}>
        <span><strong>{count} {count === 1 ? "item" : "items"}</strong><small>Estimated ₹{estimated}</small></span>
        <Button onClick={onReview}>Review order</Button>
      </div> : null}
      <header><div><span className="public-order-icon public-order-icon--small"><ShoppingBag aria-hidden="true" size={18} /></span><h2 id="public-cart-title">Your order</h2></div><span aria-live="polite">{count} {count === 1 ? "item" : "items"}</span></header>
      {cart.length ? <>
        <div className="public-cart__lines">{cart.map(item => <article key={item.id}>
          <div><strong>{item.name}</strong><span>₹{item.price} each</span></div>
          <div className="public-quantity">
            <button aria-label={`Decrease ${item.name} quantity`} onClick={() => onQuantity(item.id, -1)} type="button"><Minus aria-hidden="true" size={16} /></button>
            <output aria-label={`${item.name} quantity`}>{item.quantity}</output>
            <button aria-label={`Increase ${item.name} quantity`} disabled={item.quantity >= PUBLIC_ORDER_MAX_QUANTITY} onClick={() => onQuantity(item.id, 1)} type="button"><Plus aria-hidden="true" size={16} /></button>
            <button aria-label={`Remove ${item.name} from cart`} className="public-cart__remove" onClick={() => onRemove(item.id)} type="button"><Trash2 aria-hidden="true" size={16} /></button>
          </div>
          <label>Special instructions <span>Optional</span><textarea maxLength="10000" onChange={(event) => onChangeInstructions(item.id, event.target.value)} rows="2" value={item.special_instructions} /></label>
        </article>)}</div>
        <label className="public-cart__notes">Order notes <span>Optional</span><textarea maxLength="10000" onChange={(event) => onChangeNotes(event.target.value)} rows="3" value={notes} /></label>
        <div className="public-cart__total"><span>Estimated total <small>Final amount is confirmed after submission.</small></span><strong>₹{estimated}</strong></div>
        <Button onClick={onReview}>Review order</Button>
      </> : <div className="public-cart__empty"><ShoppingBag aria-hidden="true" size={24} /><p>Your cart is empty.</p><small>Add an item from the menu to begin.</small></div>}
    </aside>
  );
}
