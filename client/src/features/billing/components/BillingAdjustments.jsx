import { Input } from "../../../components/ui/Input.jsx";
import { Select } from "../../../components/ui/Select.jsx";

// Leave an untouched tax selection undefined so JSON serialization omits it and
// the backend can apply the hotel's configured default to a newly-created bill.
// Selecting "No tax" explicitly changes this value to null.
export const emptyBillingSelection = { tax_slab_id: undefined, discount_id: null, service_charge_rate: undefined };

export function selectionFromBill(bill) {
  return {
    tax_slab_id: bill?.tax_snapshot?.configuration_id ?? null,
    discount_id: bill?.discount_snapshot?.configuration_id ?? null,
    service_charge_rate: bill?.service_charge_snapshot?.overridden ? bill.service_charge_snapshot.applied_rate : undefined,
  };
}

export function BillingAdjustmentFields({ disabled, options, selection, onChange }) {
  return <div className="form-grid billing-adjustment-fields">
    <Select disabled={disabled} label="Tax slab" value={selection.tax_slab_id ?? ""} onChange={event => onChange({ ...selection, tax_slab_id: event.target.value || null })}>
      <option value="">No tax</option>
      {(options?.taxSlabs ?? []).map(tax => <option key={tax.id} value={tax.id}>{tax.name} · {tax.rate}%</option>)}
    </Select>
    <Select disabled={disabled} label="Discount" value={selection.discount_id ?? ""} onChange={event => onChange({ ...selection, discount_id: event.target.value || null })}>
      <option value="">No discount</option>
      {(options?.discounts ?? []).map(discount => <option key={discount.id} value={discount.id}>{discount.name} · {discount.discount_type === "percentage" ? `${discount.discount_value}%` : `₹${discount.discount_value}`}</option>)}
    </Select>
    {options?.billingSettings?.service_charge_enabled ? <Input
      disabled={disabled}
      label={`Service charge rate (default ${options.billingSettings.service_charge_rate}%)`}
      max={options.billingSettings.service_charge_rate}
      min="0"
      step="0.01"
      type="number"
      value={selection.service_charge_rate ?? ""}
      onChange={event => onChange({ ...selection, service_charge_rate: event.target.value === "" ? undefined : event.target.value })}
    /> : null}
  </div>;
}

export function BillingAdjustmentSummary({ bill, money }) {
  return <>
    <dt>Selected Discount</dt><dd>{bill.discount_snapshot?.name ?? "None"}</dd>
    <dt>Discount Amount</dt><dd>{money(bill.discount_amount)}</dd>
    <dt>Service Charge{bill.service_charge_snapshot?.applied_rate != null ? ` · ${bill.service_charge_snapshot.applied_rate}%` : ""}</dt><dd>{money(bill.service_charge_amount ?? 0)}</dd>
    <dt>Taxable Amount</dt><dd>{money(bill.taxable_subtotal ?? bill.subtotal)}</dd>
    <dt>Selected Tax</dt><dd>{bill.tax_snapshot ? `${bill.tax_snapshot.name} · ${bill.tax_snapshot.rate}%` : "None"}</dd>
    <dt>Tax Amount</dt><dd>{money(bill.tax_amount)}</dd>
  </>;
}
