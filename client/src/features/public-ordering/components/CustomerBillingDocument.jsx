import { Download, Printer, ReceiptIndianRupee } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import { billingLineAmount, billingMoney } from "../../billing/utils/billingLinePresentation.js";
import { formatPublicOrderTimestamp } from "../services/orderTracking.js";

const contextLabel = context => context.type === "room"
  ? `Room ${context.room_number || "—"}`
  : `${context.dining_area || "Dining area"} · Table ${context.table_number || "—"}`;

export function CustomerBillingDocument({ billing, downloading = false, onDownload }) {
  if (!billing?.available) {
    return <section aria-label="Customer billing" className="public-billing-unavailable"><ReceiptIndianRupee aria-hidden="true" size={28} /><div><h2>Bill not available yet</h2><p>The hotel will issue your invoice after staff finalize the bill.</p></div></section>;
  }
  const receipt = billing.document_type === "receipt";
  return (
    <section aria-labelledby="customer-billing-title" className="billing-receipt customer-billing-document">
      <header><span>A</span><div><p className="public-order-eyebrow">{receipt ? "Customer receipt" : "Customer invoice"}</p><h2 id="customer-billing-title">{billing.hotel.name}</h2><p>{billing.hotel.address || "Hotel Management System"}</p></div></header>
      <section className="billing-receipt__meta">
        <div><small>{receipt ? "Receipt reference" : "Invoice number"}</small><strong>{billing.invoice_number}</strong></div>
        <div><small>Issued</small><strong>{billing.issued_at ? formatPublicOrderTimestamp(billing.issued_at, billing.hotel.timezone) : "—"}</strong></div>
        <div><small>Context</small><strong>{contextLabel(billing.context)}</strong></div>
        <div><small>Status</small><strong>{billing.payment_status.replaceAll("_", " ")}</strong></div>
      </section>
      <table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>{billing.items.map((item, index) => <tr key={`${item.description}-${index}`}><td>{item.description}</td><td>{item.quantity}</td><td>{billingMoney(item.unit_price)}</td><td>{billingMoney(billingLineAmount(item))}</td></tr>)}</tbody></table>
      <dl>
        <div><dt>Subtotal</dt><dd>{billingMoney(billing.subtotal)}</dd></div>
        <div><dt>Discount{billing.discount?.name ? ` · ${billing.discount.name}` : ""}</dt><dd>{billingMoney(billing.discount_amount)}</dd></div>
        {Number(billing.service_charge_amount) > 0 ? <div><dt>Service charge{billing.service_charge?.rate ? ` · ${billing.service_charge.rate}%` : ""}</dt><dd>{billingMoney(billing.service_charge_amount)}</dd></div> : null}
        <div><dt>Taxable amount</dt><dd>{billingMoney(billing.taxable_subtotal)}</dd></div>
        <div><dt>Tax{billing.tax?.name ? ` · ${billing.tax.name}` : ""}</dt><dd>{billingMoney(billing.tax_amount)}</dd></div>
        <div className="billing-receipt__total"><dt>Total</dt><dd>{billingMoney(billing.total_amount)}</dd></div>
        <div><dt>Amount paid</dt><dd>{billingMoney(billing.amount_paid)}</dd></div>
        <div><dt>Balance due</dt><dd>{billingMoney(billing.balance_due)}</dd></div>
      </dl>
      {billing.payments.length ? <section aria-label="Recorded payments" className="customer-billing-payments"><h3>Recorded payments</h3>{billing.payments.map((payment, index) => <div key={`${payment.recorded_at}-${index}`}><span>{payment.method} · {formatPublicOrderTimestamp(payment.recorded_at, billing.hotel.timezone)}</span><strong>{billingMoney(payment.amount)}</strong></div>)}</section> : null}
      <footer><p>{receipt ? "This receipt reflects the persisted AAZIRA payment ledger." : "Payment execution is handled separately by the company."}</p><div className="customer-billing-actions"><Button icon={Printer} onClick={() => window.print()} variant="outline">Print {receipt ? "Receipt" : "Invoice"}</Button>{receipt ? <Button disabled={downloading} icon={Download} onClick={onDownload}>{downloading ? "Preparing…" : "Download PDF"}</Button> : null}</div></footer>
    </section>
  );
}
