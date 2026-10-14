const configuredApi = import.meta.env.VITE_API_BASE_URL?.trim();
const apiOrigin = configuredApi ? configuredApi.replace(/\/+$/, "") : import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:4000` : "";

export async function getReceptionDashboard(hotelId, options = {}) {
  const response = await fetch(`${apiOrigin}/api/hotels/${encodeURIComponent(hotelId)}/reception/dashboard`, { credentials: "include", ...options });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Reception dashboard could not be loaded.");
    error.status = response.status;
    error.code = payload?.error?.code || "RECEPTION_DASHBOARD_REQUEST_FAILED";
    throw error;
  }
  return payload.data;
}

export async function lookupReceptionBooking(hotelId, bookingNumber, options = {}) {
  const response = await fetch(`${apiOrigin}/api/hotels/${encodeURIComponent(hotelId)}/reception/booking-lookup`, { method: "POST", credentials: "include", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) }, body: JSON.stringify({ bookingNumber }) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Booking lookup failed.");
    error.status = response.status;
    error.code = payload?.error?.code || "BOOKING_LOOKUP_FAILED";
    throw error;
  }
  return payload.data.booking;
}

export async function issueReceptionRoomCapability(hotelId, bookingId) {
  const response = await fetch(`${apiOrigin}/api/hotels/${encodeURIComponent(hotelId)}/qr-codes/room-bookings/${encodeURIComponent(bookingId)}/capability`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Unable to issue room ordering access.");
    error.status = response.status;
    error.code = payload?.error?.code || "ROOM_CAPABILITY_REQUEST_FAILED";
    throw error;
  }
  return payload.data.room_capability;
}

export async function getReceptionTableStatus(hotelId, options = {}) {
  const response = await fetch(`${apiOrigin}/api/hotels/${encodeURIComponent(hotelId)}/reception/table-status`, { credentials: "include", ...options });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Table status could not be loaded.");
    error.status = response.status;
    error.code = payload?.error?.code || "RECEPTION_TABLE_STATUS_REQUEST_FAILED";
    throw error;
  }
  return payload.data.tables;
}

async function attendanceRequest(path, options = {}) {
  const response = await fetch(`${apiOrigin}${path}`, { credentials: "include", ...options });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Attendance request failed.");
    error.status = response.status;
    error.code = payload?.error?.code || "ATTENDANCE_REQUEST_FAILED";
    throw error;
  }
  return payload.data;
}

export function getReceptionAttendance(hotelId, date, options = {}) {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  return attendanceRequest(`/api/hotels/${encodeURIComponent(hotelId)}/reception/attendance${query}`, options);
}

export function saveReceptionAttendance(hotelId, { userId, attendanceDate, status }, options = {}) {
  return attendanceRequest(`/api/hotels/${encodeURIComponent(hotelId)}/reception/attendance`, {
    method: "PUT",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: JSON.stringify({ userId, attendanceDate, status }),
  });
}
