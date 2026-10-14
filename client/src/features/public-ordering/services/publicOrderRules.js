export const PUBLIC_ORDER_MAX_QUANTITY = 100;
const BASIC_EMAIL = /^\S+@\S+\.\S+$/;

export function nextPublicOrderQuantity(current, delta) {
  return Math.min(PUBLIC_ORDER_MAX_QUANTITY, Math.max(0, current + delta));
}

export function validateTableCustomer(customer) {
  const errors = {};
  if (!customer.customer_name.trim()) errors.customer_name = "Name is required.";
  if (!customer.customer_phone.trim()) errors.customer_phone = "Phone is required.";
  if (customer.customer_email && !BASIC_EMAIL.test(customer.customer_email)) errors.customer_email = "Enter a valid email address.";
  return errors;
}
