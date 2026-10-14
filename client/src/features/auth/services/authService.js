const configuredApiOrigin = import.meta.env.VITE_API_BASE_URL?.trim();
const apiOrigin = configuredApiOrigin
  ? configuredApiOrigin.replace(/\/+$/, "")
  : import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : "";

class AuthenticationRequestError extends Error {
  constructor(message, { code = "AUTHENTICATION_REQUEST_FAILED", payload = null, status = 0 } = {}) {
    super(message);
    this.code = code;
    this.payload = payload;
    this.status = status;
  }
}

async function authenticationRequest(path, options = {}) {
  const response = await fetch(`${apiOrigin}/api/auth${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AuthenticationRequestError(payload?.error?.message || "Authentication request failed.", {
      code: payload?.error?.code,
      payload,
      status: response.status,
    });
  }

  return payload;
}

export async function createSession(credentials) {
  const payload = await authenticationRequest("/login", {
    body: JSON.stringify(credentials),
    method: "POST",
  });
  return payload.user;
}

export async function getSession({ signal } = {}) {
  const payload = await authenticationRequest("/session", { signal });
  return payload.user;
}

export async function selectSessionContext({ assignmentId, challenge }) {
  const payload = await authenticationRequest("/context", {
    body: JSON.stringify({ assignmentId, challenge }),
    method: "POST",
  });
  return payload.user;
}

export async function changeRequiredPassword({ challenge, newPassword }) {
  return authenticationRequest("/password-change", {
    body: JSON.stringify({ challenge, newPassword }),
    method: "POST",
  });
}

export async function endSession() {
  await authenticationRequest("/logout", { method: "POST" });
}
