const configuredApiOrigin = import.meta.env.VITE_API_BASE_URL?.trim();
const apiOrigin = configuredApiOrigin ? configuredApiOrigin.replace(/\/+$/, "") : import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:4000` : "";

export async function getAdminDashboard(hotelId, options = {}) {
  if (!hotelId) throw new Error("An authenticated hotel is required.");
  const response = await fetch(`${apiOrigin}/api/hotels/${encodeURIComponent(hotelId)}/admin/dashboard`, { credentials: "include", ...options });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Unable to load dashboard data.");
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload.data;
}
