const configured = import.meta.env.VITE_API_BASE_URL?.trim();
const origin = configured
  ? configured.replace(/\/+$/, "")
  : import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : "";

export class AdminInvitationRequestError extends Error {
  constructor(message, { code = "ADMIN_INVITATION_REQUEST_FAILED", status = 0 } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(token, path = "", options = {}) {
  try {
    const response = await fetch(`${origin}/api/public/admin-invitations/${encodeURIComponent(token)}${path}`, {
      credentials: "omit",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AdminInvitationRequestError(payload?.error?.message || "This invitation is invalid or no longer available.", {
        code: payload?.error?.code,
        status: response.status,
      });
    }
    return payload.data;
  } catch (error) {
    if (error instanceof AdminInvitationRequestError) throw error;
    throw new AdminInvitationRequestError("The connection was interrupted. Please try again.", { code: "NETWORK_ERROR" });
  }
}

export const inspectAdminInvitation = token => request(token);
export const acceptAdminInvitation = (token, input) => request(token, "/accept", {
  method: "POST",
  body: JSON.stringify(input),
});
export const selectAdminInvitationPlan = (token, plan) => request(token, "/plan", {
  method: "POST",
  body: JSON.stringify({ plan }),
});
