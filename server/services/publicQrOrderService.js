import { createHash, randomUUID } from "node:crypto";
import { ROLE_KEYS } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { PUBLIC_ORDER_LIMITS } from "../config/publicOrderLimits.js";
import { AppError } from "../middleware/errorHandler.js";
import { notifyActiveHotelRoleUsers, notifyActiveReceptionUsers } from "./operationalNotificationService.js";
import { hashOrderTrackingCapability } from "./orderTrackingService.js";
import { resolvePublicOrderContext } from "./qrService.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASIC_EMAIL = /^\S+@\S+\.\S+$/;
const BASE_FIELDS = new Set(["idempotency_key", "items", "notes"]);
const TABLE_FIELDS = new Set([...BASE_FIELDS, "customer_name", "customer_phone", "customer_email"]);
const selection = {
  id: true, idempotency_fingerprint: true, order_number: true, source: true,
  status: true, subtotal: true, tax_amount: true, discount_amount: true, total_amount: true,
  notes: true, created_at: true,
  dining_table: { select: { table_number: true, dining_area: { select: { name: true } } } },
  room_booking: { select: { room: { select: { room_number: true } } } },
  order_item: {
    orderBy: { id: "asc" },
    select: { item_name: true, quantity: true, unit_price: true, subtotal: true, status: true, special_instructions: true },
  },
};

const fail = (message, code, statusCode = 400) => { throw new AppError(message, { code, statusCode }); };
const cents = value => {
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
};
const money = value => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
const nullableText = (value, field, max) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > max) fail(`${field} is invalid.`, "INVALID_PUBLIC_ORDER");
  return value.trim() || null;
};
const optionalCustomerEmail = value => {
  const email = nullableText(value, "customer_email", 255);
  if (email && !BASIC_EMAIL.test(email)) fail("Customer email is invalid.", "INVALID_PUBLIC_ORDER_CUSTOMER");
  return email;
};

function validateItems(value) {
  if (!Array.isArray(value) || !value.length) fail("items must contain at least one menu item.", "INVALID_PUBLIC_ORDER_ITEMS");
  if (value.length > PUBLIC_ORDER_LIMITS.maxUniqueLines) {
    fail(`A public order may contain at most ${PUBLIC_ORDER_LIMITS.maxUniqueLines} unique menu items.`, "PUBLIC_ORDER_LINE_LIMIT_EXCEEDED");
  }
  const items = value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail(`items[${index}] is invalid.`, "INVALID_PUBLIC_ORDER_ITEMS");
    const keys = Object.keys(item);
    if (keys.some(key => !["menu_item_id", "quantity", "special_instructions"].includes(key)) || !keys.includes("menu_item_id") || !keys.includes("quantity")) {
      fail(`items[${index}] contains unsupported or missing fields.`, "INVALID_PUBLIC_ORDER_ITEMS");
    }
    if (typeof item.menu_item_id !== "string" || !UUID.test(item.menu_item_id)) {
      fail(`items[${index}] is invalid.`, "INVALID_PUBLIC_ORDER_ITEMS");
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > PUBLIC_ORDER_LIMITS.maxQuantityPerLine) {
      fail(`items[${index}].quantity must be an integer between 1 and ${PUBLIC_ORDER_LIMITS.maxQuantityPerLine}.`, "PUBLIC_ORDER_QUANTITY_LIMIT_EXCEEDED");
    }
    return { menu_item_id: item.menu_item_id, quantity: item.quantity, special_instructions: nullableText(item.special_instructions, `items[${index}].special_instructions`, 10000) };
  });
  if (new Set(items.map(item => item.menu_item_id)).size !== items.length) fail("Each menu item may appear only once in an order.", "DUPLICATE_PUBLIC_ORDER_ITEM");
  return items;
}

function validateResourceInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("Request body must be a JSON object.", "INVALID_REQUEST_BODY");
  if (!Object.hasOwn(body, "items")) fail("items is required.", "INVALID_PUBLIC_ORDER");
  return validateItems(body.items);
}

function validateInput(type, body, validatedItems) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("Request body must be a JSON object.", "INVALID_REQUEST_BODY");
  const allowed = type === "room" ? BASE_FIELDS : TABLE_FIELDS;
  if (Object.keys(body).some(key => !allowed.has(key))) fail("Unsupported public order fields.", "UNSUPPORTED_PUBLIC_ORDER_FIELDS");
  for (const field of ["idempotency_key", "items"]) if (!Object.hasOwn(body, field)) fail(`${field} is required.`, "INVALID_PUBLIC_ORDER");
  if (typeof body.idempotency_key !== "string" || !UUID.test(body.idempotency_key)) fail("idempotency_key must be a UUID.", "INVALID_PUBLIC_ORDER_KEY");
  const input = { idempotency_key: body.idempotency_key, items: validatedItems, notes: nullableText(body.notes, "notes", 10000) };
  if (type === "dining_table") {
    for (const field of ["customer_name", "customer_phone"]) if (!Object.hasOwn(body, field)) fail(`${field} is required.`, "INVALID_PUBLIC_ORDER_CUSTOMER");
    if (typeof body.customer_name !== "string" || !body.customer_name.trim() || body.customer_name.length > 255 || typeof body.customer_phone !== "string" || !body.customer_phone.trim() || body.customer_phone.length > 20) {
      fail("Customer name and phone are invalid.", "INVALID_PUBLIC_ORDER_CUSTOMER");
    }
    input.customer_name = body.customer_name.trim();
    input.customer_phone = body.customer_phone.trim();
    input.customer_email = optionalCustomerEmail(body.customer_email);
  }
  return input;
}

function fingerprint(context, input, trackingCapabilityHash) {
  const normalized = {
    source: context.type === "room" ? "room_qr" : "dining_table_qr",
    target: context.type === "room" ? context.booking.id : context.tableId,
    ...(context.type === "dining_table" ? { customer_name: input.customer_name, customer_phone: input.customer_phone, customer_email: input.customer_email } : {}),
    notes: input.notes,
    tracking_capability_hash: trackingCapabilityHash,
    items: [...input.items].sort((a, b) => a.menu_item_id.localeCompare(b.menu_item_id)),
  };
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}

function serialize({ id: _id, idempotency_fingerprint: _fingerprint, order_item, dining_table, room_booking, ...order }) {
  return {
    ...order,
    subtotal: order.subtotal.toFixed(2), tax_amount: order.tax_amount.toFixed(2),
    discount_amount: order.discount_amount.toFixed(2), total_amount: order.total_amount.toFixed(2),
    target: order.source === "room_qr"
      ? { type: "room", room_number: room_booking.room.room_number }
      : { type: "dining_table", table_number: dining_table.table_number, dining_area: dining_table.dining_area.name },
    items: order_item.map(({ unit_price, subtotal, ...item }) => ({ ...item, unit_price: unit_price.toFixed(2), subtotal: subtotal.toFixed(2) })),
    created_at: order.created_at.toISOString(),
  };
}

async function existingOrder(client, hotelId, key, expectedFingerprint) {
  const order = await client.orders.findUnique({ where: { hotel_id_idempotency_key: { hotel_id: hotelId, idempotency_key: key } }, select: selection });
  if (!order) return null;
  if (order.idempotency_fingerprint !== expectedFingerprint) fail("This order request key was used for different details.", "ORDER_KEY_CONFLICT", 409);
  return serialize(order);
}

async function buildItems(client, hotelId, entries) {
  const ids = entries.map(item => item.menu_item_id);
  const menuItems = await client.menu_item.findMany({
    where: {
      id: { in: ids }, hotel_id: hotelId, is_available: true,
      OR: [{ category_id: null }, { menu_category: { is: { hotel_id: hotelId, is_active: true } } }],
    },
    select: { id: true, name: true, price: true },
  });
  if (menuItems.length !== ids.length) fail("One or more available menu items were not found.", "PUBLIC_MENU_ITEM_NOT_FOUND", 404);
  const byId = new Map(menuItems.map(item => [item.id, item]));
  let total = 0n;
  const data = entries.map(entry => {
    const menuItem = byId.get(entry.menu_item_id);
    const unit = cents(menuItem.price);
    const subtotal = unit * BigInt(entry.quantity);
    total += subtotal;
    if (subtotal > PUBLIC_ORDER_LIMITS.maxOrderTotalCents || total > PUBLIC_ORDER_LIMITS.maxOrderTotalCents) {
      fail("The public order total exceeds the supported monetary limit.", "PUBLIC_ORDER_TOTAL_LIMIT_EXCEEDED");
    }
    return {
      id: randomUUID(), menu_item_id: menuItem.id, item_name: menuItem.name, quantity: entry.quantity,
      unit_price: money(unit), subtotal: money(subtotal), status: "pending",
      special_instructions: entry.special_instructions,
    };
  });
  return { data, subtotal: money(total) };
}

async function createInTransaction(qrToken, capability, trackingCapabilityHash, initialContext, input, expectedFingerprint) {
  return prisma.$transaction(async client => {
    await client.$queryRaw`SELECT id FROM hotel WHERE id = ${initialContext.hotelId}::uuid FOR UPDATE`;
    const context = await resolvePublicOrderContext(client, qrToken, capability);
    if (context.hotelId !== initialContext.hotelId || (context.type === "room" ? context.booking.id : context.tableId) !== (initialContext.type === "room" ? initialContext.booking.id : initialContext.tableId)) {
      fail("QR ordering context is unavailable.", "QR_CONTEXT_UNAVAILABLE", 409);
    }
    const replay = await existingOrder(client, context.hotelId, input.idempotency_key, expectedFingerprint);
    if (replay) return replay;
    if (context.type === "room" && await client.bill.findFirst({ where: { room_booking_id: context.booking.id, status: { not: "DRAFT" } }, select: { id: true } })) {
      fail("Room ordering is no longer available for this stay.", "ROOM_ORDERING_UNAVAILABLE", 409);
    }
    const built = await buildItems(client, context.hotelId, input.items);
    let customerId = context.type === "room" ? context.booking.customer_id : null;
    if (context.type === "dining_table") {
      const customer = await client.customer.upsert({
        where: { hotel_id_phone: { hotel_id: context.hotelId, phone: input.customer_phone } },
        update: {},
        create: { id: randomUUID(), hotel_id: context.hotelId, first_name: input.customer_name, phone: input.customer_phone, email: input.customer_email },
        select: { id: true },
      });
      customerId = customer.id;
    }
    const room = context.type === "room";
    const order = await client.orders.create({
      data: {
        id: randomUUID(), hotel_id: context.hotelId, customer_id: customerId,
        table_id: room ? null : context.tableId, room_booking_id: room ? context.booking.id : null,
        order_number: `ORD-${randomUUID()}`, source: room ? "room_qr" : "dining_table_qr", captain_id: null,
        customer_name: room ? context.booking.customer_name : input.customer_name,
        customer_phone: room ? context.booking.customer_phone : input.customer_phone,
        customer_email: room ? context.booking.customer_email : input.customer_email,
        status: "pending", subtotal: built.subtotal, tax_amount: "0.00", discount_amount: "0.00",
        total_amount: built.subtotal, payment_status: "pending", notes: input.notes,
        idempotency_key: input.idempotency_key, idempotency_fingerprint: expectedFingerprint,
        tracking_capability_hash: trackingCapabilityHash, tracking_capability_created_at: new Date(),
        order_item: { create: built.data },
      },
      select: selection,
    });
    if (!room) {
      await client.dining_table.updateMany({
        where: { id: context.tableId, hotel_id: context.hotelId, status: { in: ["active", "available"] } },
        data: { status: "occupied" },
      });
    }
    if (room) {
      await notifyActiveReceptionUsers(client, context.hotelId, {
        eventKey: `room-order-created:${order.id}`,
        type: "room_order", title: "New Room-Service Order",
        message: `New room-service order received for Room ${context.qr.room.room_number}.`,
      });
      await notifyActiveHotelRoleUsers(client, context.hotelId, ROLE_KEYS.KITCHEN, {
        eventKey: `kitchen-room-order-created:${order.id}`,
        type: "room_order", title: "New Room-Service Order",
        message: `Room-service order ${order.order_number} for Room ${context.qr.room.room_number} requires preparation.`,
      });
    } else await notifyActiveHotelRoleUsers(client, context.hotelId, ROLE_KEYS.CAPTAIN, {
      eventKey: `captain-table-order-created:${order.id}`,
      type: "restaurant_order",
      title: "New Table QR Order",
      message: `Table QR order ${order.order_number} for Table ${context.qr.dining_table.table_number} is awaiting Captain handoff.`,
    });
    await notifyActiveHotelRoleUsers(client, context.hotelId, ROLE_KEYS.MANAGER, {
      eventKey: `manager-order-created:${order.id}`,
      type: "manager_operational", title: "New Order",
      message: room
        ? `Room-service order ${order.order_number} was created for Room ${context.qr.room.room_number}.`
        : `Restaurant order ${order.order_number} was created.`,
    });
    return serialize(order);
  }, { timeout: 15000 });
}

export async function createPublicQrOrder(qrToken, capability, trackingCapability, body) {
  const validatedItems = validateResourceInput(body);
  const trackingCapabilityHash = hashOrderTrackingCapability(trackingCapability);
  const initialContext = await resolvePublicOrderContext(prisma, qrToken, capability);
  const input = validateInput(initialContext.type, body, validatedItems);
  const expectedFingerprint = fingerprint(initialContext, input, trackingCapabilityHash);
  const replay = await existingOrder(prisma, initialContext.hotelId, input.idempotency_key, expectedFingerprint);
  if (replay) return replay;
  try {
    return await createInTransaction(qrToken, capability, trackingCapabilityHash, initialContext, input, expectedFingerprint);
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const currentContext = await resolvePublicOrderContext(prisma, qrToken, capability);
    const existing = await existingOrder(prisma, currentContext.hotelId, input.idempotency_key, expectedFingerprint);
    if (existing) return existing;
    fail("The order tracking credential is already in use.", "TRACKING_CAPABILITY_CONFLICT", 409);
  }
}
