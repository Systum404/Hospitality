export const restaurantOrderStatuses = ["pending", "preparing", "ready", "completed"];

export function isRestaurantOrderBillable(order) {
  return order?.status === "completed";
}

export function filterRestaurantOrders(orders, status) {
  return orders.filter(order => status === "all" || order.status === status);
}
