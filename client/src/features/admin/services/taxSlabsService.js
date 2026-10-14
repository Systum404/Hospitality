const configuredApiOrigin = import.meta.env.VITE_API_BASE_URL?.trim();
const apiOrigin = configuredApiOrigin
  ? configuredApiOrigin.replace(/\/+$/, "")
  : import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : "";

export class TaxSlabsRequestError extends Error {
  constructor(message, { code = "TAX_SLABS_REQUEST_FAILED", status = 0 } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${apiOrigin}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new TaxSlabsRequestError(payload?.error?.message || "The Tax Slabs request failed.", {
      code: payload?.error?.code,
      status: response.status,
    });
  }
  return payload;
}

const taxSlabsPath = (hotelId) => `/api/hotels/${encodeURIComponent(hotelId)}/tax-slabs`;

export async function getTaxSlabs(hotelId, { signal } = {}) {
  const payload = await request(taxSlabsPath(hotelId), { signal });
  return payload.data.tax_slabs;
}

export async function createTaxSlab(hotelId, input) {
  const payload = await request(taxSlabsPath(hotelId), { body: JSON.stringify(input), method: "POST" });
  return payload.data.tax_slab;
}

export async function updateTaxSlab(hotelId, taxSlabId, input) {
  const payload = await request(`${taxSlabsPath(hotelId)}/${encodeURIComponent(taxSlabId)}`, {
    body: JSON.stringify(input), method: "PATCH",
  });
  return payload.data.tax_slab;
}

export async function updateTaxSlabStatus(hotelId, taxSlabId, isActive) {
  const payload = await request(`${taxSlabsPath(hotelId)}/${encodeURIComponent(taxSlabId)}/status`, {
    body: JSON.stringify({ is_active: isActive }), method: "PATCH",
  });
  return payload.data.tax_slab;
}

export async function deleteTaxSlab(hotelId, taxSlabId) {
  const payload = await request(`${taxSlabsPath(hotelId)}/${encodeURIComponent(taxSlabId)}`, { method: "DELETE" });
  return payload.data.tax_slab;
}
