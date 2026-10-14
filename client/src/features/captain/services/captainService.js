const configuredApiOrigin = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE_URL = configuredApiOrigin
  ? configuredApiOrigin.replace(/\/+$/, "")
  : import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : "";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include", headers: options.body ? { "Content-Type": "application/json" } : undefined, ...options });
  const payload = await response.json().catch(() => null);
  if (!response.ok) { const error = new Error(payload?.error?.message || payload?.message || "Unable to complete request."); error.status = response.status; error.code = payload?.error?.code; throw error; }
  return payload?.data;
}

function mapWorkspace(data) {
  const menuItems = data.menu_items.map((item) => ({ id: item.id, name: item.name, price: Number(item.price), category: item.category?.name || "Uncategorized", status: item.is_available ? "available" : "unavailable", description: item.description || "" }));
  const orders = (data.orders || []).map((order) => ({ id: order.id, number: order.order_number, source: order.source, assignedToCaptain: order.assigned_to_captain, assignedToCurrentCaptain: order.assigned_to_current_captain, table: order.dining_table?.table_number || "—", tableId: order.table_id, customer: order.customer_name, phone: order.customer_phone, notes: order.notes || "", items: (order.items || []).map((item) => ({ id: item.menu_item_id, lineId: item.id, name: item.menu_item.name, price: Number(item.unit_price), category: item.menu_item.category?.name || "Uncategorized", quantity: item.quantity, status: item.status })), itemCount: (order.items || []).reduce((total, item) => total + item.quantity, 0), amount: Number(order.total_amount), status: order.status, time: new Date(order.created_at).toLocaleString(), createdAt: order.created_at })).sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));
  orders.forEach((order) => {
    const area = data.areas.find((candidate) => candidate.tables.some((table) => table.id === order.tableId));
    order.area = area?.name || "";
    order.tableNumber = order.table;
    order.table = [order.area, order.tableNumber].filter(Boolean).join(" · ") || "—";
  });
  const latestOrderByTable = new Map();
  orders.forEach((order) => {
    if (order.status !== "completed" && !latestOrderByTable.has(order.tableId)) latestOrderByTable.set(order.tableId, order);
  });
  const tables = data.areas.flatMap((area) => area.tables.map((table) => { const activeOrder = latestOrderByTable.get(table.id); return { id: table.table_number, databaseId: table.id, area: area.name, capacity: table.capacity, status: table.status, customer: activeOrder?.customer || "", amount: activeOrder?.amount, orders: activeOrder?.itemCount || 0 }; }));
  return { ...data, tables, menuItems, orders, recentOrders: orders };
}

export async function getCaptainDashboard(hotelId) { return mapWorkspace(await request(`/api/hotels/${hotelId}/captain/workspace`)); }
export async function createCaptainOrder(hotelId, order) { return request(`/api/hotels/${hotelId}/captain/orders`, { method: "POST", body: JSON.stringify(order) }); }
export async function updateCaptainOrder(hotelId, orderId, order) { return request(`/api/hotels/${hotelId}/captain/orders/${orderId}`, { method: "PATCH", body: JSON.stringify(order) }); }
export async function handoffTableQrOrder(hotelId, orderId) { return request(`/api/hotels/${hotelId}/captain/orders/${orderId}/kitchen-handoff`, { method: "POST", body: JSON.stringify({}) }); }
export async function deleteCaptainOrder(hotelId, orderId) { return request(`/api/hotels/${hotelId}/captain/orders/${orderId}`, { method: "DELETE" }); }
export async function updateCaptainTable(hotelId, tableId, status) { return request(`/api/hotels/${hotelId}/captain/tables/${tableId}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); }
