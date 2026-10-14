import { forwardRef } from "react";

export const TableCustomerDetails = forwardRef(function TableCustomerDetails({ disabled = false, errors, onChange, value }, ref) {
  return (
    <fieldset className="public-customer-form">
      <legend>Customer details</legend>
      <p>Used only to identify this table order.</p>
      <label>Name <span aria-hidden="true">*</span><input autoComplete="name" disabled={disabled} maxLength="255" name="customer_name" onChange={onChange} ref={ref} value={value.customer_name} />{errors.customer_name ? <small role="alert">{errors.customer_name}</small> : null}</label>
      <label>Phone <span aria-hidden="true">*</span><input autoComplete="tel" disabled={disabled} inputMode="tel" maxLength="20" name="customer_phone" onChange={onChange} value={value.customer_phone} />{errors.customer_phone ? <small role="alert">{errors.customer_phone}</small> : null}</label>
      <label>Email <em>Optional</em><input autoComplete="email" disabled={disabled} maxLength="255" name="customer_email" onChange={onChange} type="email" value={value.customer_email} />{errors.customer_email ? <small role="alert">{errors.customer_email}</small> : null}</label>
    </fieldset>
  );
});
