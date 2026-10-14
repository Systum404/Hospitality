import { randomUUID } from "node:crypto";
import { ROLE_KEYS } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { assertOrderStatusTransition, ORDER_STATUSES } from "./orderStatusLifecycle.js";
import { notifyActiveHotelRoleUsers } from "./operationalNotificationService.js";

const TABLE_STATUSES = new Set(["available", "occupied", "reserved"]);
const RESTAURANT_SOURCES = ["captain", "dining_table_qr"];
const ACTIVE_ORDER_STATUSES = ["pending", "preparing", "ready"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const itemSelection = { id: true, menu_item_id: true, item_name: true, quantity: true, unit_price: true, subtotal: true, status: true, special_instructions: true, menu_item: { select: { id: true, name: true, price: true, menu_category: { select: { id: true, name: true } } } } };
const orderSelection = { id: true, order_number: true, source: true, table_id: true, captain_id: true, customer_name: true, customer_phone: true, customer_email: true, status: true, subtotal: true, tax_amount: true, discount_amount: true, total_amount: true, payment_status: true, notes: true, created_at: true, updated_at: true, completed_at: true, dining_table: { select: { id: true, table_number: true, capacity: true, status: true, dining_area: { select: { id: true, name: true } } } }, order_item: { select: itemSelection } };

const fail = (message, code, statusCode = 400) => { throw new AppError(message, { code, statusCode }); };
const cents = (value) => { const [whole, fraction = ""] = String(value).split("."); return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2)); };
const decimal = (value) => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;

function serializeOrder({ subtotal, tax_amount, discount_amount, total_amount, order_item, captain_id, ...order }, currentCaptainId = null) {
  return {
    ...order,
    assigned_to_captain: Boolean(captain_id),
    assigned_to_current_captain: Boolean(captain_id && currentCaptainId && captain_id === currentCaptainId),
    subtotal: subtotal.toFixed(2), tax_amount: tax_amount.toFixed(2), discount_amount: discount_amount.toFixed(2), total_amount: total_amount.toFixed(2),
    items: order_item.map(({ unit_price, subtotal: itemSubtotal, menu_item, item_name, ...item }) => ({ ...item, item_name, unit_price: unit_price.toFixed(2), subtotal: itemSubtotal.toFixed(2), menu_item: { ...menu_item, name: item_name, price: menu_item.price.toFixed(2), category: menu_item.menu_category } })),
  };
}

async function requireHotel(client, hotelId) {
  if (!await client.hotel.findUnique({ where: { id: hotelId }, select: { id: true } })) fail("Hotel not found.", "HOTEL_NOT_FOUND", 404);
}

async function requireTable(client, hotelId, tableId) {
  const table = await client.dining_table.findFirst({ where: { id: tableId, hotel_id: hotelId, dining_area: { is: { hotel_id: hotelId } } }, select: { id: true, status: true } });
  if (!table) fail("Dining table not found for this hotel.", "DINING_TABLE_NOT_FOUND", 404);
  return table;
}

async function lockTable(client, hotelId, tableId) {
  const rows = await client.$queryRaw`
    SELECT dining_table.id, dining_table.status
    FROM dining_table
    INNER JOIN dining_area
      ON dining_area.id = dining_table.dining_area_id
     AND dining_area.hotel_id = dining_table.hotel_id
    WHERE dining_table.id = ${tableId}::uuid
      AND dining_table.hotel_id = ${hotelId}::uuid
      AND dining_area.hotel_id = ${hotelId}::uuid
    FOR UPDATE OF dining_table
  `;
  const table = rows[0];
  if (!table) fail("Dining table not found for this hotel.", "DINING_TABLE_NOT_FOUND", 404);
  return table;
}

async function lockRestaurantOrder(client, hotelId, orderId) {
  const rows = await client.$queryRaw`
    SELECT id, status, table_id, captain_id, order_number, source
    FROM orders
    WHERE id = ${orderId}::uuid
      AND hotel_id = ${hotelId}::uuid
      AND source IN ('captain'::order_source, 'dining_table_qr'::order_source)
    FOR UPDATE
  `;
  const order = rows[0];
  if (!order) fail("Captain order not found.", "CAPTAIN_ORDER_NOT_FOUND", 404);
  if (order.status === "completed") {
    fail("Completed restaurant orders cannot be changed or deleted.", "RESTAURANT_ORDER_IMMUTABLE", 409);
  }
  return order;
}

async function buildItems(client, hotelId, entries, status) {
  const ids = entries.map((item) => item.menu_item_id);
  if (new Set(ids).size !== ids.length) fail("Each menu item may appear only once in an order.", "DUPLICATE_ORDER_ITEM");
  const menuItems = await client.menu_item.findMany({ where: { id: { in: ids }, hotel_id: hotelId, is_available: true }, select: { id: true, name: true, price: true } });
  if (menuItems.length !== ids.length) fail("One or more available menu items were not found for this hotel.", "MENU_ITEM_NOT_FOUND", 404);
  const byId = new Map(menuItems.map((item) => [item.id, item]));
  let total = 0n;
  const data = entries.map((entry) => {
    const item = byId.get(entry.menu_item_id);
    const subtotal = cents(item.price) * BigInt(entry.quantity);
    total += subtotal;
    return { id: randomUUID(), menu_item_id: entry.menu_item_id, item_name: item.name, quantity: entry.quantity, unit_price: decimal(cents(item.price)), subtotal: decimal(subtotal), status, special_instructions: entry.special_instructions || null };
  });
  return { data, subtotal: decimal(total) };
}

export async function getCaptainWorkspace(hotelId, captainId) {
  await requireHotel(prisma, hotelId);
  const [areas, categories, menuItems, orders] = await Promise.all([
    prisma.dining_area.findMany({ where: { hotel_id: hotelId }, orderBy: { name: "asc" }, select: { id: true, name: true, status: true, total_tables: true, dining_table: { where: { hotel_id: hotelId }, orderBy: { table_number: "asc" }, select: { id: true, table_number: true, capacity: true, status: true } } } }),
    prisma.menu_category.findMany({ where: { hotel_id: hotelId, is_active: true }, orderBy: [{ display_order: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.menu_item.findMany({ where: { hotel_id: hotelId, is_available: true, OR: [{ category_id: null }, { menu_category: { is: { hotel_id: hotelId, is_active: true } } }] }, orderBy: { name: "asc" }, select: { id: true, name: true, description: true, price: true, is_available: true, menu_category: { select: { id: true, name: true } } } }),
    prisma.orders.findMany({ where: { hotel_id: hotelId, source: { in: RESTAURANT_SOURCES }, dining_table: { is: { hotel_id: hotelId } } }, orderBy: { created_at: "desc" }, select: orderSelection }),
  ]);
  const occupied = new Set(orders.filter(order => ACTIVE_ORDER_STATUSES.includes(order.status)).map(order => order.table_id));
  return { areas: areas.map(({ dining_table, ...area }) => ({ ...area, tables: dining_table.map(table => ({ ...table, status: occupied.has(table.id) ? "occupied" : table.status === "occupied" ? "available" : table.status })) })), categories, menu_items: menuItems.map((item) => ({ ...item, price: item.price.toFixed(2), category: item.menu_category })), orders: orders.map(order => serializeOrder(order, captainId)) };
}

export async function handoffTableQrOrderToKitchen(hotelId, orderId, captainId) {
  return prisma.$transaction(async (transaction) => {
    await requireHotel(transaction, hotelId);
    const existing = await lockRestaurantOrder(transaction, hotelId, orderId);
    if (existing.source !== "dining_table_qr") fail("Only Table QR orders use Captain handoff.", "TABLE_QR_HANDOFF_NOT_ALLOWED", 409);
    if (existing.captain_id && existing.captain_id !== captainId) fail("This Table QR order has already been assigned to another Captain.", "TABLE_QR_ORDER_ALREADY_ASSIGNED", 409);
    if (!existing.captain_id) {
      if (existing.status !== "pending") fail("Only pending Table QR orders can be handed to Kitchen.", "TABLE_QR_HANDOFF_NOT_ALLOWED", 409);
      const assigned = await transaction.orders.updateMany({
        where: { id: orderId, hotel_id: hotelId, source: "dining_table_qr", status: "pending", captain_id: null },
        data: { captain_id: captainId },
      });
      if (assigned.count !== 1) fail("This Table QR order is no longer available for handoff.", "TABLE_QR_ORDER_ALREADY_ASSIGNED", 409);
    }
    await notifyActiveHotelRoleUsers(transaction, hotelId, ROLE_KEYS.KITCHEN, {
      eventKey: `restaurant-order-created:${orderId}`,
      type: "restaurant_order",
      title: "New Restaurant Order",
      message: `Restaurant order ${existing.order_number} requires preparation.`,
    });
    const order = await transaction.orders.findFirst({ where: { id: orderId, hotel_id: hotelId }, select: orderSelection });
    return serializeOrder(order, captainId);
  });
}

export async function createCaptainOrder(hotelId, captainId, input) {
  return prisma.$transaction(async (transaction) => {
    await requireHotel(transaction, hotelId);
    const table = await requireTable(transaction, hotelId, input.table_id);
    if (table.status === "occupied") fail("An occupied table must be managed through its existing Captain order.", "DINING_TABLE_OCCUPIED", 409);
    const activeOrder = await transaction.orders.findFirst({ where: { hotel_id: hotelId, table_id: input.table_id, source: { in: RESTAURANT_SOURCES }, status: { in: ACTIVE_ORDER_STATUSES } }, select: { id: true } });
    if (activeOrder) fail("This table already has an active Captain order.", "CAPTAIN_TABLE_HAS_ACTIVE_ORDER", 409);
    const built = await buildItems(transaction, hotelId, input.items, "pending");
    const order = await transaction.orders.create({ data: { id: randomUUID(), hotel_id: hotelId, table_id: input.table_id, captain_id: captainId, order_number: `CAP-${randomUUID()}`, source: "captain", customer_name: input.customer_name, customer_phone: input.customer_phone, customer_email: input.customer_email || null, status: "pending", subtotal: built.subtotal, tax_amount: "0.00", discount_amount: "0.00", total_amount: built.subtotal, payment_status: "pending", notes: input.notes || null, order_item: { create: built.data } }, select: orderSelection });
    const tableUpdate = await transaction.dining_table.updateMany({ where: { id: input.table_id, hotel_id: hotelId, status: { not: "occupied" } }, data: { status: "occupied" } });
    if (tableUpdate.count !== 1) fail("This table is no longer available for a new Captain order.", "DINING_TABLE_OCCUPIED", 409);
    await notifyActiveHotelRoleUsers(transaction, hotelId, ROLE_KEYS.KITCHEN, {
      eventKey: `restaurant-order-created:${order.id}`,
      type: "restaurant_order",
      title: "New Restaurant Order",
      message: `Restaurant order ${order.order_number} requires preparation.`,
    });
    await notifyActiveHotelRoleUsers(transaction, hotelId, ROLE_KEYS.MANAGER, {
      eventKey: `manager-order-created:${order.id}`,
      type: "manager_operational",
      title: "New Order",
      message: `Restaurant order ${order.order_number} was created.`,
    });
    return serializeOrder(order);
  });
}

export async function updateCaptainOrder(hotelId, orderId, input) {
  return prisma.$transaction(async (transaction) => {
    await requireHotel(transaction, hotelId);
    const existing = await lockRestaurantOrder(transaction, hotelId, orderId);
    if (existing.source === "dining_table_qr" && !existing.captain_id) fail("Send this Table QR order to Kitchen before managing it.", "TABLE_QR_HANDOFF_REQUIRED", 409);
    if (input.status) assertOrderStatusTransition(existing.status, input.status);
    const data = { ...input };
    if (input.items) {
      const built = await buildItems(transaction, hotelId, input.items, input.status || existing.status);
      delete data.items;
      data.subtotal = built.subtotal; data.total_amount = built.subtotal;
      await transaction.order_item.deleteMany({ where: { order_id: orderId } });
      data.order_item = { create: built.data };
    }
    if (data.status === "completed") data.completed_at = new Date();
    await transaction.orders.update({ where: { id: orderId }, data });
    if (data.status && !input.items) {
      await transaction.order_item.updateMany({ where: { order_id: orderId }, data: { status: data.status } });
    }
    if (data.status === "completed" && existing.table_id && !await transaction.orders.findFirst({ where: { id: { not: orderId }, hotel_id: hotelId, table_id: existing.table_id, source: { in: RESTAURANT_SOURCES }, status: { in: ACTIVE_ORDER_STATUSES } }, select: { id: true } })) {
      await transaction.dining_table.updateMany({ where: { id: existing.table_id, hotel_id: hotelId, status: "occupied" }, data: { status: "available" } });
    }
    return serializeOrder(await transaction.orders.findFirst({ where: { id: orderId, hotel_id: hotelId, source: { in: RESTAURANT_SOURCES } }, select: orderSelection }));
  });
}

export async function deleteCaptainOrder(hotelId, orderId) {
  return prisma.$transaction(async (transaction) => {
    await requireHotel(transaction, hotelId);
    await lockRestaurantOrder(transaction, hotelId, orderId);
    const order = await transaction.orders.findFirst({ where: { id: orderId, hotel_id: hotelId, source: { in: RESTAURANT_SOURCES } }, select: orderSelection });
    await transaction.orders.delete({ where: { id: order.id } });
    if (order.table_id && !await transaction.orders.findFirst({ where: { hotel_id: hotelId, table_id: order.table_id, source: { in: RESTAURANT_SOURCES }, status: { in: ACTIVE_ORDER_STATUSES } }, select: { id: true } })) {
      await transaction.dining_table.updateMany({ where: { id: order.table_id, hotel_id: hotelId, status: "occupied" }, data: { status: "available" } });
    }
    return serializeOrder(order);
  });
}

export async function updateCaptainTableStatus(hotelId, tableId, status) {
  return prisma.$transaction(async (transaction) => {
    await requireHotel(transaction, hotelId);
    await lockTable(transaction, hotelId, tableId);
    if (status !== "occupied" && await transaction.orders.findFirst({
      where: {
        hotel_id: hotelId,
        table_id: tableId,
        source: { in: RESTAURANT_SOURCES },
        status: { in: ACTIVE_ORDER_STATUSES },
      },
      select: { id: true },
    })) {
      fail("This table has an active Captain order and must remain occupied.", "CAPTAIN_TABLE_HAS_ACTIVE_ORDER", 409);
    }
    await transaction.dining_table.updateMany({ where: { id: tableId, hotel_id: hotelId }, data: { status } });
    return transaction.dining_table.findFirst({ where: { id: tableId, hotel_id: hotelId }, select: { id: true, table_number: true, capacity: true, status: true } });
  });
}

export function validateCaptainOrder(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Request body must be a JSON object.", "INVALID_REQUEST_BODY");
  const allowed = new Set(["table_id", "customer_name", "customer_phone", "customer_email", "notes", "items"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) fail("Unsupported Captain order fields.", "INVALID_CAPTAIN_ORDER_FIELDS");
  for (const field of ["table_id", "customer_name", "customer_phone", "items"]) if (!Object.hasOwn(input, field)) fail(`${field} is required.`, "INVALID_CAPTAIN_ORDER");
  if (typeof input.table_id !== "string" || !UUID_PATTERN.test(input.table_id) || typeof input.customer_name !== "string" || !input.customer_name.trim() || input.customer_name.length > 255 || typeof input.customer_phone !== "string" || !input.customer_phone.trim() || input.customer_phone.length > 20) fail("Captain order customer and table details are invalid.", "INVALID_CAPTAIN_ORDER");
  if (input.customer_email !== undefined && (typeof input.customer_email !== "string" || input.customer_email.length > 255)) fail("customer_email is invalid.", "INVALID_CAPTAIN_ORDER");
  if (input.notes !== undefined && (typeof input.notes !== "string" || input.notes.length > 10000)) fail("notes is invalid.", "INVALID_CAPTAIN_ORDER");
  return { ...input, customer_name: input.customer_name.trim(), customer_phone: input.customer_phone.trim(), customer_email: input.customer_email?.trim(), notes: input.notes?.trim(), items: validateItems(input.items) };
}

export function validateCaptainOrderPatch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !Object.keys(input).length) fail("Provide at least one Captain order field to update.", "INVALID_CAPTAIN_ORDER_UPDATE");
  const allowed = new Set(["items", "notes", "status"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) fail("Unsupported Captain order fields.", "INVALID_CAPTAIN_ORDER_FIELDS");
  const data = {};
  if (Object.hasOwn(input, "items")) data.items = validateItems(input.items);
  if (Object.hasOwn(input, "notes")) { if (typeof input.notes !== "string" || input.notes.length > 10000) fail("notes is invalid.", "INVALID_CAPTAIN_ORDER"); data.notes = input.notes.trim(); }
  if (Object.hasOwn(input, "status")) { if (typeof input.status !== "string" || !ORDER_STATUSES.has(input.status)) fail("status is invalid.", "INVALID_CAPTAIN_ORDER_STATUS"); data.status = input.status; }
  return data;
}

function validateItems(items) {
  if (!Array.isArray(items) || !items.length) fail("items must contain at least one menu item.", "INVALID_CAPTAIN_ORDER_ITEMS");
  return items.map((item, index) => { if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some((key) => !["menu_item_id", "quantity", "special_instructions"].includes(key)) || typeof item.menu_item_id !== "string" || !UUID_PATTERN.test(item.menu_item_id) || !Number.isInteger(item.quantity) || item.quantity < 1 || (item.special_instructions !== undefined && typeof item.special_instructions !== "string")) fail(`items[${index}] is invalid.`, "INVALID_CAPTAIN_ORDER_ITEMS"); return { menu_item_id: item.menu_item_id, quantity: item.quantity, special_instructions: item.special_instructions }; });
}

export function validateCaptainTableStatus(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1 || typeof input.status !== "string" || !TABLE_STATUSES.has(input.status)) fail("status is invalid.", "INVALID_DINING_TABLE_STATUS");
  return input.status;
}
