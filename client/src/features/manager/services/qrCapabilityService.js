const configured = import.meta.env.VITE_API_BASE_URL?.trim();
const origin = configured
  ? configured.replace(/\/+$/, "")
  : import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : "";

export class QrCapabilityRequestError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function issueRoomOrderingCapability(hotelId, bookingId) {
  const response = await fetch(`${origin}/api/hotels/${encodeURIComponent(hotelId)}/qr-codes/room-bookings/${encodeURIComponent(bookingId)}/capability`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new QrCapabilityRequestError(payload?.error?.message || "Unable to issue room ordering access.", { code: payload?.error?.code, status: response.status });
  return payload.data.room_capability;
}
