const configuredApiOrigin = import.meta.env.VITE_API_BASE_URL?.trim();
const apiOrigin = configuredApiOrigin
  ? configuredApiOrigin.replace(/\/+$/, "")
  : import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : "";

export class CompanyControlPlaneError extends Error {
  constructor(message, { code = "COMPANY_REQUEST_FAILED", status = 0 } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${apiOrigin}/api/company${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new CompanyControlPlaneError(payload?.error?.message || "Company request failed.", {
      code: payload?.error?.code,
      status: response.status,
    });
  }
  return payload?.data;
}

export const listCompanyHotels = ({ page = 1, pageSize = 25 } = {}) => request(`/hotels?page=${page}&pageSize=${pageSize}`);
export async function listAllCompanyHotels() {
  const first = await listCompanyHotels({ page: 1, pageSize: 100 });
  const items = [...first.items];
  for (let page = 2; items.length < first.total; page += 1) {
    const next = await listCompanyHotels({ page, pageSize: 100 });
    items.push(...next.items);
  }
  return { items, total: first.total };
}
export const getCompanyHotel = (hotelId) => request(`/hotels/${hotelId}`);
export const createCompanyHotel = (input) => request("/hotels", { method: "POST", body: JSON.stringify(input) });
export const updateCompanyHotel = (hotelId, input) => request(`/hotels/${hotelId}`, { method: "PATCH", body: JSON.stringify(input) });
export const changeCompanyHotelPlan = (hotelId, plan) => request(`/hotels/${hotelId}/plan`, { method: "PATCH", body: JSON.stringify({ plan }) });
export const setCompanyHotelActive = (hotelId, active) => request(`/hotels/${hotelId}/${active ? "activate" : "deactivate"}`, { method: "POST", body: "{}" });

export const listHotelAdmins = (hotelId) => request(`/hotels/${hotelId}/admins`);
export const setHotelAdminAssignmentActive = (hotelId, assignmentId, active) => request(`/hotels/${hotelId}/admins/${assignmentId}/${active ? "reactivate" : "deactivate"}`, { method: "POST", body: "{}" });
export const listAdminInvitations = (hotelId) => request(`/hotels/${hotelId}/admin-invitations`);
export const createAdminInvitation = (hotelId, input) => request(`/hotels/${hotelId}/admin-invitations`, { method: "POST", body: JSON.stringify(input) });
export const resendAdminInvitation = (invitationId) => request(`/admin-invitations/${invitationId}/resend`, { method: "POST", body: "{}" });
export const revokeAdminInvitation = (invitationId) => request(`/admin-invitations/${invitationId}/revoke`, { method: "POST", body: "{}" });

export const setCompanyIdentityActive = (userId, active) => request(`/users/${userId}/${active ? "reactivate" : "deactivate"}`, { method: "POST", body: "{}" });
export const resetCompanyUserPassword = (userId) => request(`/users/${userId}/password-reset`, { method: "POST", body: "{}" });
