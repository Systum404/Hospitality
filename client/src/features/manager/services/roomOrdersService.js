const configured = import.meta.env.VITE_API_BASE_URL?.trim();
const origin = configured ? configured.replace(/\/+$/, "") : import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:4000` : "";
export class RoomOrderRequestError extends Error { constructor(message, { status = 0, code = "ROOM_ORDER_REQUEST_FAILED" } = {}) { super(message); this.status = status; this.code = code; } }
async function request(hotelId, path = "", options = {}) { const response = await fetch(`${origin}/api/hotels/${encodeURIComponent(hotelId)}/room-orders${path}`, { credentials: "include", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } }); const payload = await response.json().catch(() => null); if (!response.ok) throw new RoomOrderRequestError(payload?.error?.message || "Room order request failed.", { status: response.status, code: payload?.error?.code }); return payload.data; }
export const getRoomOrders = (hotelId, options = {}) => request(hotelId, "", options).then(({ room_orders }) => room_orders);
export const createRoomOrder = (hotelId, input) => request(hotelId, "", { method: "POST", body: JSON.stringify(input) }).then(({ room_order }) => room_order);
export const updateRoomOrder = (hotelId, id, input) => request(hotelId, `/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }).then(({ room_order }) => room_order);
export const updateRoomOrderStatus = (hotelId, id, status) => request(hotelId, `/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }).then(({ room_order }) => room_order);
export const deleteRoomOrder = (hotelId, id) => request(hotelId, `/${encodeURIComponent(id)}`, { method: "DELETE" }).then(({ room_order }) => room_order);
