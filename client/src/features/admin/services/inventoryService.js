const configuredApiOrigin = import.meta.env.VITE_API_BASE_URL?.trim();
const apiOrigin = configuredApiOrigin ? configuredApiOrigin.replace(/\/+$/, "") : import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:4000` : "";

export class InventoryRequestError extends Error { constructor(message, { code = "INVENTORY_REQUEST_FAILED", status = 0 } = {}) { super(message); this.code = code; this.status = status; } }

async function request(hotelId, path = "", options = {}) {
  const response = await fetch(`${apiOrigin}/api/hotels/${encodeURIComponent(hotelId)}/inventory${path}`, { credentials: "include", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new InventoryRequestError(payload?.error?.message || "Inventory request failed.", { code: payload?.error?.code, status: response.status });
  return payload.data;
}

export const getInventoryItems = (hotelId, options = {}) => request(hotelId, "", options).then(({ inventory }) => inventory);
export const createInventoryItem = (hotelId, input) => request(hotelId, "", { method: "POST", body: JSON.stringify(input) }).then(({ inventory_item: item }) => item);
export const updateInventoryItem = (hotelId, id, input) => request(hotelId, `/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }).then(({ inventory_item: item }) => item);
export const deleteInventoryItem = (hotelId, id) => request(hotelId, `/${encodeURIComponent(id)}`, { method: "DELETE" }).then(({ inventory_item: item }) => item);
