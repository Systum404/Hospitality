const configuredApiOrigin = import.meta.env.VITE_API_BASE_URL?.trim();
const apiOrigin = configuredApiOrigin
  ? configuredApiOrigin.replace(/\/+$/, "")
  : import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : "";

export class AreasTablesRequestError extends Error {
  constructor(message, { code = "AREAS_TABLES_REQUEST_FAILED", status = 0 } = {}) {
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
    throw new AreasTablesRequestError(payload?.error?.message || "The Areas & Tables request failed.", {
      code: payload?.error?.code,
      status: response.status,
    });
  }

  return payload;
}

const hotelPath = (hotelId, resource) => `/api/hotels/${encodeURIComponent(hotelId)}/${resource}`;

export async function getDiningAreas(hotelId, { signal } = {}) {
  const payload = await request(hotelPath(hotelId, "dining-areas"), { signal });
  return payload.data.dining_areas;
}

export async function createDiningArea(hotelId, input) {
  const payload = await request(hotelPath(hotelId, "dining-areas"), {
    body: JSON.stringify(input),
    method: "POST",
  });
  return payload.data.dining_area;
}

export async function updateDiningArea(hotelId, areaId, input) {
  const payload = await request(`${hotelPath(hotelId, "dining-areas")}/${encodeURIComponent(areaId)}`, {
    body: JSON.stringify(input),
    method: "PATCH",
  });
  return payload.data.dining_area;
}

export async function updateDiningAreaStatus(hotelId, areaId, status) {
  const payload = await request(`${hotelPath(hotelId, "dining-areas")}/${encodeURIComponent(areaId)}/status`, {
    body: JSON.stringify({ status }),
    method: "PATCH",
  });
  return payload.data.dining_area;
}

export async function deleteDiningArea(hotelId, areaId) {
  const payload = await request(`${hotelPath(hotelId, "dining-areas")}/${encodeURIComponent(areaId)}`, {
    method: "DELETE",
  });
  return payload.data.dining_area;
}

export async function createDiningTable(hotelId, input) {
  const payload = await request(hotelPath(hotelId, "dining-tables"), {
    body: JSON.stringify(input),
    method: "POST",
  });
  return payload.data.dining_table;
}

export async function updateDiningTable(hotelId, tableId, input) {
  const payload = await request(`${hotelPath(hotelId, "dining-tables")}/${encodeURIComponent(tableId)}`, {
    body: JSON.stringify(input),
    method: "PATCH",
  });
  return payload.data.dining_table;
}

export async function updateDiningTableStatus(hotelId, tableId, status) {
  const payload = await request(`${hotelPath(hotelId, "dining-tables")}/${encodeURIComponent(tableId)}/status`, {
    body: JSON.stringify({ status }),
    method: "PATCH",
  });
  return payload.data.dining_table;
}

export async function deleteDiningTable(hotelId, tableId) {
  const payload = await request(`${hotelPath(hotelId, "dining-tables")}/${encodeURIComponent(tableId)}`, {
    method: "DELETE",
  });
  return payload.data.dining_table;
}
