const configured = import.meta.env.VITE_API_BASE_URL?.trim();
const origin = configured
  ? configured.replace(/\/+$/, "")
  : import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : "";

export class PublicQrRequestError extends Error {
  constructor(message, { code = "PUBLIC_QR_REQUEST_FAILED", status = 0, uncertain = false } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.uncertain = uncertain;
  }
}

async function request(token, path = "", { capability, timeout = 20000, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${origin}/api/public/qr/${encodeURIComponent(token)}${path}`, {
      credentials: "omit",
      ...options,
      signal: options.signal || controller.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(capability ? { "X-Room-Capability": capability } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new PublicQrRequestError(payload?.error?.message || "Unable to complete the request.", {
        code: payload?.error?.code,
        status: response.status,
        uncertain: response.status >= 500,
      });
    }
    return payload.data;
  } catch (error) {
    if (error instanceof PublicQrRequestError) throw error;
    throw new PublicQrRequestError("The connection was interrupted. Please try again.", {
      code: error?.name === "AbortError" ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
      uncertain: options.method === "POST",
    });
  } finally {
    clearTimeout(timer);
  }
}

export const resolvePublicQr = token => request(token);
export const verifyRoomCapability = (token, capability) => request(token, "/room-capability", {
  method: "POST", body: JSON.stringify({ capability }),
});
export const getPublicQrMenu = (token, capability) => request(token, "/menu", { capability });
export const submitPublicQrOrder = (token, payload, capability, trackingCapability) => request(token, "/orders", {
  method: "POST", body: JSON.stringify(payload), capability,
  headers: { "X-Order-Tracking-Capability": trackingCapability },
});
