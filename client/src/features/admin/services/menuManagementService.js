const configuredApiOrigin = import.meta.env.VITE_API_BASE_URL?.trim();
const apiOrigin = configuredApiOrigin
  ? configuredApiOrigin.replace(/\/+$/, "")
  : import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : "";

export class MenuManagementRequestError extends Error {
  constructor(message, { code = "MENU_MANAGEMENT_REQUEST_FAILED", status = 0 } = {}) {
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
    throw new MenuManagementRequestError(payload?.error?.message || "The Menu request failed.", {
      code: payload?.error?.code,
      status: response.status,
    });
  }

  return payload;
}

const hotelPath = (hotelId, resource) => `/api/hotels/${encodeURIComponent(hotelId)}/${resource}`;

export async function getMenuCategories(hotelId, { signal } = {}) {
  const payload = await request(hotelPath(hotelId, "menu-categories"), { signal });
  return payload.data.menu_categories;
}

export async function getMenuItems(hotelId, { signal } = {}) {
  const payload = await request(hotelPath(hotelId, "menu-items"), { signal });
  return payload.data.menu_items;
}

export async function createMenuItem(hotelId, input) {
  const payload = await request(hotelPath(hotelId, "menu-items"), {
    body: JSON.stringify(input),
    method: "POST",
  });
  return payload.data.menu_item;
}

export async function updateMenuItem(hotelId, itemId, input) {
  const payload = await request(`${hotelPath(hotelId, "menu-items")}/${encodeURIComponent(itemId)}`, {
    body: JSON.stringify(input),
    method: "PATCH",
  });
  return payload.data.menu_item;
}

export async function updateMenuItemStatus(hotelId, itemId, isAvailable) {
  const payload = await request(`${hotelPath(hotelId, "menu-items")}/${encodeURIComponent(itemId)}/status`, {
    body: JSON.stringify({ is_available: isAvailable }),
    method: "PATCH",
  });
  return payload.data.menu_item;
}

export async function deleteMenuItem(hotelId, itemId) {
  const payload = await request(`${hotelPath(hotelId, "menu-items")}/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
  return payload.data.menu_item;
}

export async function createMenuCategory(hotelId, input) {
  const payload = await request(hotelPath(hotelId, "menu-categories"), {
    body: JSON.stringify(input),
    method: "POST",
  });
  return payload.data.menu_category;
}

export async function updateMenuCategory(hotelId, categoryId, input) {
  const payload = await request(`${hotelPath(hotelId, "menu-categories")}/${encodeURIComponent(categoryId)}`, {
    body: JSON.stringify(input),
    method: "PATCH",
  });
  return payload.data.menu_category;
}

export async function updateMenuCategoryStatus(hotelId, categoryId, isActive) {
  const payload = await request(`${hotelPath(hotelId, "menu-categories")}/${encodeURIComponent(categoryId)}/status`, {
    body: JSON.stringify({ is_active: isActive }),
    method: "PATCH",
  });
  return payload.data.menu_category;
}

export async function deleteMenuCategory(hotelId, categoryId) {
  const payload = await request(`${hotelPath(hotelId, "menu-categories")}/${encodeURIComponent(categoryId)}`, {
    method: "DELETE",
  });
  return payload.data.menu_category;
}
