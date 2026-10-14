const configured = import.meta.env.VITE_API_BASE_URL?.trim();
const origin = configured ? configured.replace(/\/+$/, "") : import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:4000` : "";
async function request(hotelId, resource, options = {}, collection = "bills") {
  if (!hotelId) throw new Error("An authenticated hotel is required for billing.");
  const response = await fetch(`${origin}/api/hotels/${encodeURIComponent(hotelId)}/${collection}${resource}`, {
    ...options, credentials: "include", headers: { ...(options.body ? { "Content-Type": "application/json" } : {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Billing request failed.");
    error.status = response.status; error.code = payload?.error?.code;
    throw error;
  }
  return payload.data;
}
export async function getBills(hotelId, { signal } = {}) { return (await request(hotelId, "", { signal })).bills; }
export async function getBillingWorkspace(hotelId, { signal } = {}) { return request(hotelId, "", { signal }); }
export async function getBill(hotelId, billId) { return (await request(hotelId, `/${encodeURIComponent(billId)}`)).bill; }
export async function getBillingAdjustments(hotelId, { signal } = {}) {
  const options = await request(hotelId, "", { signal }, "billing-options");
  return { taxSlabs: options.tax_slabs ?? [], discounts: options.discounts ?? [], billingSettings: options.billing_settings ?? null };
}
export async function createRoomBill(hotelId, bookingId, selections = {}) {
  return (await request(hotelId, `/${encodeURIComponent(bookingId)}/bill`, { method: "POST", body: JSON.stringify(selections) }, "room-bookings")).bill;
}
export async function createRestaurantBill(hotelId, orderId, selections = {}) {
  return (await request(hotelId, `/${encodeURIComponent(orderId)}/bill`, { method: "POST", body: JSON.stringify(selections) }, "orders")).bill;
}
export async function recordBillPayment(hotelId, billId, payment) {
  return (await request(hotelId, `/${encodeURIComponent(billId)}/payments`, { method: "POST", body: JSON.stringify(payment) })).bill;
}
export async function finalizeBill(hotelId, billId, selections = {}) {
  return (await request(hotelId, `/${encodeURIComponent(billId)}/finalize`, { method: "POST", body: JSON.stringify(selections) })).bill;
}
export async function recalculateBill(hotelId, billId, selections = {}) {
  return (await request(hotelId, `/${encodeURIComponent(billId)}/recalculate`, { method: "POST", body: JSON.stringify(selections) })).bill;
}
export async function voidBill(hotelId, billId) {
  return (await request(hotelId, `/${encodeURIComponent(billId)}/void`, { method: "POST", body: JSON.stringify({}) })).bill;
}
export { billingMoney } from "../utils/billingLinePresentation.js";
