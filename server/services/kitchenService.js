import { ROLE_KEYS } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { assertOrderStatusTransition } from "./orderStatusLifecycle.js";
import { notifyAssignedHotelRoleUser } from "./operationalNotificationService.js";

const KITCHEN_SOURCES = ["captain", "room_qr", "dining_table_qr"];
const KITCHEN_TARGET_STATUSES = new Set(["preparing", "ready", "completed"]);
const fail = (message, code, statusCode = 400) => { throw new AppError(message, { code, statusCode }); };
const selection = { id: true, order_number: true, source: true, table_id: true, customer_name: true, customer_phone: true, status: true, notes: true, total_amount: true, created_at: true, dining_table: { select: { table_number: true, dining_area: { select: { name: true } } } }, room_booking: { select: { room: { select: { room_number: true } } } }, order_item: { select: { id: true, item_name: true, quantity: true, status: true, special_instructions: true, menu_item: { select: { name: true } } } } };
async function requireHotel(client, hotelId) { if (!await client.hotel.findUnique({ where: { id: hotelId }, select: { id: true } })) fail("Hotel not found.", "HOTEL_NOT_FOUND", 404); }
async function lockKitchenOrder(client, hotelId, orderId) {
  const orders = await client.$queryRaw`
    SELECT id, status, table_id, captain_id, order_number, source
    FROM orders
    WHERE id = ${orderId}::uuid
      AND hotel_id = ${hotelId}::uuid
      AND source IN ('captain'::order_source, 'room_qr'::order_source, 'dining_table_qr'::order_source)
      AND (source <> 'dining_table_qr'::order_source OR captain_id IS NOT NULL)
    FOR UPDATE
  `;
  if (!orders.length) fail("Kitchen order not found.", "KITCHEN_ORDER_NOT_FOUND", 404);
  return orders[0];
}
function serialize(order) { return { ...order, total_amount: order.total_amount.toFixed(2), items: order.order_item.map(({ menu_item, item_name, ...item }) => ({ ...item, item_name, name: item_name || menu_item.name })) }; }

export async function getKitchenOrders(hotelId) {
  await requireHotel(prisma, hotelId);
  const orders = await prisma.orders.findMany({ where: { hotel_id: hotelId, status: { in: ["pending", "preparing", "ready"] }, OR: [{ source: { in: ["captain", "room_qr"] } }, { source: "dining_table_qr", captain_id: { not: null } }] }, orderBy: { created_at: "asc" }, select: selection });
  return orders.map(serialize);
}

export async function updateKitchenOrderStatus(hotelId, orderId, status) {
  return prisma.$transaction(async (transaction) => {
    await requireHotel(transaction, hotelId);
    const order = await lockKitchenOrder(transaction, hotelId, orderId);
    assertOrderStatusTransition(order.status, status);
    await transaction.orders.update({ where: { id: orderId }, data: { status, ...(status === "completed" && order.status !== "completed" ? { completed_at: new Date() } : {}) } });
    await transaction.order_item.updateMany({ where: { order_id: orderId }, data: { status } });
    if (status === "ready" && order.status !== "ready" && order.captain_id) {
      await notifyAssignedHotelRoleUser(transaction, hotelId, order.captain_id, ROLE_KEYS.CAPTAIN, {
        eventKey: `restaurant-order-ready:${order.id}`,
        type: "restaurant_order",
        title: "Order Ready",
        message: `Restaurant order ${order.order_number} is ready.`,
      });
    }
    if (status === "completed" && order.table_id && !await transaction.orders.findFirst({ where: { id: { not: orderId }, hotel_id: hotelId, table_id: order.table_id, source: { in: ["captain", "dining_table_qr"] }, status: { in: ["pending", "preparing", "ready"] } }, select: { id: true } })) {
      await transaction.dining_table.updateMany({ where: { id: order.table_id, hotel_id: hotelId, status: "occupied" }, data: { status: "available" } });
    }
    return serialize(await transaction.orders.findFirst({ where: { id: orderId, hotel_id: hotelId }, select: selection }));
  });
}

export function validateKitchenStatus(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1 || typeof input.status !== "string" || !KITCHEN_TARGET_STATUSES.has(input.status)) fail("status is invalid.", "INVALID_KITCHEN_ORDER_STATUS");
  return input.status;
}
