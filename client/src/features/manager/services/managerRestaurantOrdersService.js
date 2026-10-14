const configuredApiOrigin = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE_URL = configuredApiOrigin
  ? configuredApiOrigin.replace(/\/+$/, "")
  : import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : "";

export async function getManagerRestaurantOrders(hotelId, options = {}) {
  if (!hotelId) throw new Error("An authenticated hotel is required.");
  const response = await fetch(
    `${API_BASE_URL}/api/hotels/${encodeURIComponent(hotelId)}/manager/restaurant-orders`,
    { credentials: "include", ...options },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Restaurant orders could not be loaded.");
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload?.data?.restaurant_orders || [];
}
