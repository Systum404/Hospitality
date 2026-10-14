import { PublicQrRequestError } from "./publicQrService.js";

const configured = import.meta.env.VITE_API_BASE_URL?.trim();
const origin = configured
  ? configured.replace(/\/+$/, "")
  : import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : "";

export async function getPublicOrderTracking(capability, { signal } = {}) {
  try {
    const response = await fetch(`${origin}/api/public/order-tracking`, {
      credentials: "omit",
      headers: { "X-Order-Tracking-Capability": capability },
      signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new PublicQrRequestError(payload?.error?.message || "Order tracking is unavailable.", {
        code: payload?.error?.code,
        status: response.status,
      });
    }
    return payload.data;
  } catch (error) {
    if (error instanceof PublicQrRequestError) throw error;
    if (error?.name === "AbortError") throw error;
    throw new PublicQrRequestError("The connection was interrupted. Please try again.", { code: "NETWORK_ERROR" });
  }
}

async function billingRequest(capability, resource = "", { signal } = {}) {
  try {
    const response = await fetch(`${origin}/api/public/order-billing${resource}`, {
      credentials: "omit",
      headers: { "X-Order-Tracking-Capability": capability },
      signal,
    });
    if (resource === "/pdf" && response.ok) {
      return {
        blob: await response.blob(),
        filename: response.headers.get("content-disposition")?.match(/filename="([^"]+)"/i)?.[1] || "receipt.pdf",
      };
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new PublicQrRequestError(payload?.error?.message || "Customer billing is unavailable.", {
        code: payload?.error?.code,
        status: response.status,
      });
    }
    return payload.data;
  } catch (error) {
    if (error instanceof PublicQrRequestError) throw error;
    if (error?.name === "AbortError") throw error;
    throw new PublicQrRequestError("The connection was interrupted. Please try again.", { code: "NETWORK_ERROR" });
  }
}

export function getPublicOrderBilling(capability, options) {
  return billingRequest(capability, "", options);
}

export function getPublicReceiptPdf(capability, options) {
  return billingRequest(capability, "/pdf", options);
}
