const configuredApi = import.meta.env.VITE_API_BASE_URL?.trim();
const apiOrigin = configuredApi ? configuredApi.replace(/\/+$/, "") : import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:4000` : "";

async function request(path, options = {}) {
  const response = await fetch(`${apiOrigin}${path}`, { credentials: "include", ...options });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Notification request failed.");
    error.status = response.status;
    error.code = payload?.error?.code || "NOTIFICATION_REQUEST_FAILED";
    throw error;
  }
  return payload.data;
}

const path = hotelId => `/api/hotels/${encodeURIComponent(hotelId)}/notifications`;

export const SUPPORTED_STAFF_NOTIFICATION_ROLES = Object.freeze(["Admin", "Manager", "Reception", "Captain", "Kitchen"]);

export function getNotifications(hotelId, options = {}) {
  return request(path(hotelId), options);
}

export function markNotificationRead(hotelId, notificationId, options = {}) {
  return request(`${path(hotelId)}/${encodeURIComponent(notificationId)}/read`, { method: "PATCH", ...options });
}

export function markAllNotificationsRead(hotelId, options = {}) {
  return request(`${path(hotelId)}/read-all`, { method: "PATCH", ...options });
}
