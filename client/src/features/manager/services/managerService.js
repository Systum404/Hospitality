const configuredApiOrigin = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE_URL = configuredApiOrigin
  ? configuredApiOrigin.replace(/\/+$/, "")
  : import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : "";

export async function getManagerDashboard(hotelId, options = {}) {
  if (!hotelId) throw new Error("An authenticated hotel is required.");
  const response = await fetch(`${API_BASE_URL}/api/hotels/${encodeURIComponent(hotelId)}/manager/dashboard`, {
    credentials: "include",
    ...options,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Unable to load dashboard data.");
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload?.data;
}

export async function getManagerReports(hotelId, range, options = {}) {
  if (!hotelId) throw new Error("An authenticated hotel is required.");
  const query = new URLSearchParams({ range });
  const response = await fetch(`${API_BASE_URL}/api/hotels/${encodeURIComponent(hotelId)}/manager/reports?${query}`, {
    credentials: "include",
    ...options,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Unable to load report data.");
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload?.report;
}

