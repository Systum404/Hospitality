const configuredApiOrigin = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE_URL = configuredApiOrigin
  ? configuredApiOrigin.replace(/\/+$/, "")
  : import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : "";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include", headers: options.body ? { "Content-Type": "application/json" } : undefined, ...options });
  const payload = await response.json().catch(() => null);
  if (!response.ok) { const error = new Error(payload?.error?.message || payload?.message || "Unable to complete request."); error.status = response.status; throw error; }
  return payload?.data;
}

function mapOrder(order) {
  const source = order.source === "room_qr" ? "room" : "table";
  const tableLocation = [order.dining_table?.dining_area?.name, order.dining_table?.table_number].filter(Boolean).join(" · ") || "—";
  return { id: order.id, number: order.order_number, source, location: source === "room" ? (order.room_booking?.room?.room_number || "—") : tableLocation, guest: order.customer_name, customer: order.customer_name, amount: Number(order.total_amount), createdAt: order.created_at, specialRequest: order.notes || "", kitchenStatus: order.status, items: order.items.map((item) => ({ ...item, name: item.name })) };
}

export async function getKitchenOrders(hotelId, options = {}) { const data = await request(`/api/hotels/${hotelId}/kitchen/orders`, options); return (data.orders || []).map(mapOrder); }
export async function updateKitchenOrderStatus(hotelId, orderId, status) { const data = await request(`/api/hotels/${hotelId}/kitchen/orders/${orderId}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); return mapOrder(data.order); }
