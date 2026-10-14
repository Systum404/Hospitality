const configuredApiOrigin = import.meta.env.VITE_API_BASE_URL?.trim();
const apiOrigin = configuredApiOrigin ? configuredApiOrigin.replace(/\/+$/, "") : import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:4000` : "";

async function request(path, options = {}) {
  const response = await fetch(`${apiOrigin}${path}`, { credentials: "include", ...options });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Unable to load hotel settings.");
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload.data;
}

const base = hotelId => `/api/hotels/${encodeURIComponent(hotelId)}/settings`;
export const getHotelSettings = (hotelId, options = {}) => request(base(hotelId), options);
export const updateHotelBillingSettings = (hotelId, input) => request(`${base(hotelId)}/billing`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export const updateHotelMetadata = (hotelId, input) => request(`${base(hotelId)}/hotel`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
