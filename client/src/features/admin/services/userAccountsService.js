const configuredApiOrigin = import.meta.env.VITE_API_BASE_URL?.trim();
const apiOrigin = configuredApiOrigin
  ? configuredApiOrigin.replace(/\/+$/, "")
  : import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : "";

export class UserAccountsRequestError extends Error {
  constructor(message, { code = "USER_ACCOUNTS_REQUEST_FAILED", status = 0 } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(hotelId, path = "", options = {}) {
  const response = await fetch(`${apiOrigin}/api/hotels/${encodeURIComponent(hotelId)}/users${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new UserAccountsRequestError(payload?.error?.message || "Unable to complete the user account request.", {
      code: payload?.error?.code,
      status: response.status,
    });
  }
  return payload.data;
}

export const getUsers = (hotelId, options = {}) => request(hotelId, "", options);
export const createUser = (hotelId, input) => request(hotelId, "", { method: "POST", body: JSON.stringify(input) }).then(({ user }) => user);
export const updateUser = (hotelId, userId, input) => request(hotelId, `/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify(input) }).then(({ user }) => user);
export const updateUserStatus = (hotelId, userId, is_active) => request(hotelId, `/${encodeURIComponent(userId)}/status`, { method: "PATCH", body: JSON.stringify({ is_active }) }).then(({ user }) => user);
export const deleteUser = (hotelId, userId) => request(hotelId, `/${encodeURIComponent(userId)}`, { method: "DELETE" }).then(({ user }) => user);
