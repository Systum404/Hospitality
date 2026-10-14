const configuredApiOrigin = import.meta.env.VITE_API_BASE_URL?.trim();
const apiOrigin = configuredApiOrigin ? configuredApiOrigin.replace(/\/+$/, "") : import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:4000` : "";

export class RoomRequestError extends Error {
  constructor(message, { code = "ROOM_REQUEST_FAILED", status = 0 } = {}) { super(message); this.code = code; this.status = status; }
}

async function request(hotelId, path = "", options = {}) {
  const response = await fetch(`${apiOrigin}/api/hotels/${encodeURIComponent(hotelId)}/rooms${path}`, {
    credentials: "include", ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new RoomRequestError(payload?.error?.message || "Room request failed.", { code: payload?.error?.code, status: response.status });
  return payload.data;
}

export const getRooms = (hotelId, options = {}) => request(hotelId, "", options).then(({ rooms }) => rooms);
export const createRoom = (hotelId, input) => request(hotelId, "", { method: "POST", body: JSON.stringify(input) }).then(({ room }) => room);
export const updateRoom = (hotelId, id, input) => request(hotelId, `/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }).then(({ room }) => room);
export const updateRoomStatus = (hotelId, id, status) => request(hotelId, `/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }).then(({ room }) => room);
export const deleteRoom = (hotelId, id) => request(hotelId, `/${encodeURIComponent(id)}`, { method: "DELETE" }).then(({ room }) => room);
