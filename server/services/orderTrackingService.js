import { createHash } from "node:crypto";
import { HOTEL_STATUSES } from "../config/hotelLifecycle.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";

export const ORDER_TRACKING_CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TRACKABLE_SOURCES = new Set(["dining_table_qr", "room_qr"]);

const fail = (message, code, statusCode) => { throw new AppError(message, { code, statusCode }); };

export function validateOrderTrackingCapability(value) {
  if (typeof value !== "string" || !ORDER_TRACKING_CAPABILITY_PATTERN.test(value)) {
    fail("The order tracking credential is invalid.", "INVALID_TRACKING_CAPABILITY", 400);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) {
    fail("The order tracking credential is invalid.", "INVALID_TRACKING_CAPABILITY", 400);
  }
  return value;
}

export function hashOrderTrackingCapability(value) {
  return createHash("sha256").update(validateOrderTrackingCapability(value), "utf8").digest("hex");
}

function serialize(order) {
  const context = order.source === "room_qr"
    ? { type: "room", label: `Room ${order.room_booking.room.room_number}` }
    : { type: "dining_table", label: `${order.dining_table.dining_area.name} · Table ${order.dining_table.table_number}` };
  return {
    order_number: order.order_number,
    status: order.status,
    hotel: { name: order.hotel.name, timezone: order.hotel.timezone },
    context,
    items: order.order_item.map(item => ({
      name: item.item_name,
      quantity: item.quantity,
      special_instructions: item.special_instructions,
    })),
    notes: order.notes,
    created_at: order.created_at.toISOString(),
    completed_at: order.completed_at?.toISOString() || null,
  };
}

export async function getPublicOrderTracking(rawCapability) {
  const hash = hashOrderTrackingCapability(rawCapability);
  const order = await prisma.orders.findUnique({
    where: { tracking_capability_hash: hash },
    select: {
      order_number: true,
      source: true,
      status: true,
      notes: true,
      created_at: true,
      completed_at: true,
      hotel: { select: { name: true, status: true, timezone: true } },
      room_booking: { select: { room: { select: { room_number: true } } } },
      dining_table: { select: { table_number: true, dining_area: { select: { name: true } } } },
      order_item: {
        orderBy: { id: "asc" },
        select: { item_name: true, quantity: true, special_instructions: true },
      },
    },
  });
  if (!order || !TRACKABLE_SOURCES.has(order.source) || order.hotel.status !== HOTEL_STATUSES.ACTIVE) {
    fail("Order tracking is unavailable.", "TRACKING_NOT_AVAILABLE", 404);
  }
  if ((order.source === "room_qr" && !order.room_booking) || (order.source === "dining_table_qr" && !order.dining_table)) {
    fail("Order tracking is unavailable.", "TRACKING_NOT_AVAILABLE", 404);
  }
  return serialize(order);
}
