import assert from "node:assert/strict";
import { filterRestaurantOrders, isRestaurantOrderBillable, restaurantOrderStatuses } from "../src/features/manager/services/managerRestaurantOrdersFilter.js";

const orders = [
  { id: "captain-pending", source: "captain", status: "pending" },
  { id: "table-preparing", source: "dining_table_qr", status: "preparing" },
  { id: "captain-ready", source: "captain", status: "ready" },
  { id: "table-completed", source: "dining_table_qr", status: "completed" },
];

assert.deepEqual(restaurantOrderStatuses, ["pending", "preparing", "ready", "completed"]);
assert.deepEqual(filterRestaurantOrders(orders, "all"), orders, "All orders preserves the complete API result");
for (const status of restaurantOrderStatuses) {
  const filtered = filterRestaurantOrders(orders, status);
  assert.ok(filtered.length > 0, `${status} fixture is represented`);
  assert.ok(filtered.every(order => order.status === status), `${status} returns only matching orders`);
}
assert.deepEqual(filterRestaurantOrders(orders.filter(order => order.status !== "ready"), "ready"), [], "a supported status with no matching orders returns an empty result");
assert.deepEqual(new Set(filterRestaurantOrders(orders, "all").map(order => order.source)), new Set(["captain", "dining_table_qr"]), "Captain and Table QR sources remain represented");
assert.equal(filterRestaurantOrders([], "all").length, 0, "empty API results remain empty");
assert.deepEqual(orders.filter(isRestaurantOrderBillable).map(order => order.id), ["table-completed"], "only completed orders expose restaurant billing actions");
assert.equal(isRestaurantOrderBillable(null), false, "missing orders are not billable");

console.log("Manager Restaurant Orders filter tests passed: 11/11");
