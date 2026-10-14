export const billingLineAmount = (item) => item.subtotal;
export const billingMoney = value => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

export function billingDateTime(value, timeZone, { timeOnly = false } = {}) {
  const options = timeOnly
    ? { hour: "2-digit", minute: "2-digit", timeZone }
    : { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone };
  return new Intl.DateTimeFormat("en-IN", options).format(new Date(value));
}
