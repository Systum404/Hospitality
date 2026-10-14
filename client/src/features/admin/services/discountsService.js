const configuredApiOrigin = import.meta.env.VITE_API_BASE_URL?.trim();
const apiOrigin = configuredApiOrigin
  ? configuredApiOrigin.replace(/\/+$/, "")
  : import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : "";

export class DiscountsRequestError extends Error {
  constructor(message, { code = "DISCOUNTS_REQUEST_FAILED", status = 0 } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function getDiscounts(hotelId, { signal } = {}) {
  const response = await fetch(`${apiOrigin}/api/hotels/${encodeURIComponent(hotelId)}/discounts`, {
    credentials: "include",
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new DiscountsRequestError(payload?.error?.message || "The Discounts request failed.", {
      code: payload?.error?.code,
      status: response.status,
    });
  }
  return payload.data.discounts;
}

export async function createDiscount(hotelId, input) {
  const response = await fetch(`${apiOrigin}/api/hotels/${encodeURIComponent(hotelId)}/discounts`, {
    body: JSON.stringify(input),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new DiscountsRequestError(payload?.error?.message || "The Discount request failed.", {
      code: payload?.error?.code,
      status: response.status,
    });
  }
  return payload.data.discount;
}

async function mutateDiscount(hotelId, discountId, path, options) {
  const response = await fetch(`${apiOrigin}/api/hotels/${encodeURIComponent(hotelId)}/discounts/${encodeURIComponent(discountId)}${path}`, {
    credentials: "include",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new DiscountsRequestError(payload?.error?.message || "The Discount request failed.", {
      code: payload?.error?.code,
      status: response.status,
    });
  }
  return payload.data.discount;
}

export function updateDiscount(hotelId, discountId, input) {
  return mutateDiscount(hotelId, discountId, "", { body: JSON.stringify(input), method: "PATCH" });
}

export function updateDiscountStatus(hotelId, discountId, isActive) {
  return mutateDiscount(hotelId, discountId, "/status", { body: JSON.stringify({ is_active: isActive }), method: "PATCH" });
}

export function deleteDiscount(hotelId, discountId) {
  return mutateDiscount(hotelId, discountId, "", { method: "DELETE" });
}
