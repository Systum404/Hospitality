import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { HOTEL_STATUSES } from "../config/hotelLifecycle.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";

const adminSelection = {
  id: true, hotel_id: true, code: true, type: true, room_id: true, dining_table_id: true,
  is_active: true, created_at: true, updated_at: true,
  room: { select: { room_number: true, status: true } },
  dining_table: { select: { table_number: true, capacity: true, status: true, dining_area: { select: { name: true, status: true } } } },
};
const publicQrSelection = {
  hotel_id: true, code: true, type: true, room_id: true, dining_table_id: true, is_active: true,
  hotel: { select: { name: true, status: true, timezone: true } },
  room: { select: { room_number: true, status: true } },
  dining_table: { select: { table_number: true, capacity: true, status: true, dining_area: { select: { name: true, status: true, hotel_id: true } } } },
};
const TABLE_ORDERABLE_STATUSES = new Set(["active", "available", "occupied"]);
const fail = (message, code, statusCode) => { throw new AppError(message, { code, statusCode }); };
const token = () => randomBytes(32).toString("base64url");
const digest = value => createHash("sha256").update(value, "utf8").digest("hex");
const serializeAdmin = qr => ({ ...qr, created_at: qr.created_at.toISOString(), updated_at: qr.updated_at.toISOString() });

async function requireHotel(client, hotelId) {
  if (!await client.hotel.findUnique({ where: { id: hotelId }, select: { id: true } })) fail("Hotel not found.", "HOTEL_NOT_FOUND", 404);
}

async function requireQr(client, hotelId, qrId) {
  const qr = await client.qr_code.findFirst({ where: { id: qrId, hotel_id: hotelId }, select: adminSelection });
  if (!qr) fail("QR code not found.", "QR_CODE_NOT_FOUND", 404);
  return qr;
}

function uniqueError(error) {
  if (error?.code === "P2002") fail("A QR code already exists for this target.", "QR_TARGET_ALREADY_EXISTS", 409);
  throw error;
}

export async function listQrCodes(hotelId) {
  await requireHotel(prisma, hotelId);
  return (await prisma.qr_code.findMany({ where: { hotel_id: hotelId }, orderBy: [{ type: "asc" }, { created_at: "asc" }], select: adminSelection })).map(serializeAdmin);
}

export async function getQrCode(hotelId, qrId) {
  await requireHotel(prisma, hotelId);
  return serializeAdmin(await requireQr(prisma, hotelId, qrId));
}

export async function createQrCode(hotelId, input) {
  await requireHotel(prisma, hotelId);
  if (input.type === "room") {
    if (!await prisma.room.findFirst({ where: { id: input.room_id, hotel_id: hotelId }, select: { id: true } })) fail("Room not found for this hotel.", "QR_TARGET_NOT_FOUND", 404);
  } else if (!await prisma.dining_table.findFirst({ where: { id: input.dining_table_id, hotel_id: hotelId, dining_area: { is: { hotel_id: hotelId } } }, select: { id: true } })) {
    fail("Dining table not found for this hotel.", "QR_TARGET_NOT_FOUND", 404);
  }
  try {
    const qr = await prisma.qr_code.create({ data: { id: randomUUID(), hotel_id: hotelId, code: token(), type: input.type, room_id: input.room_id || null, dining_table_id: input.dining_table_id || null }, select: adminSelection });
    return serializeAdmin(qr);
  } catch (error) { return uniqueError(error); }
}

export async function setQrCodeActive(hotelId, qrId, isActive) {
  await requireHotel(prisma, hotelId);
  await requireQr(prisma, hotelId, qrId);
  const result = await prisma.qr_code.updateMany({ where: { id: qrId, hotel_id: hotelId }, data: { is_active: isActive, updated_at: new Date() } });
  if (result.count !== 1) fail("QR code not found.", "QR_CODE_NOT_FOUND", 404);
  return serializeAdmin(await requireQr(prisma, hotelId, qrId));
}

export async function rotateQrCode(hotelId, qrId) {
  await requireHotel(prisma, hotelId);
  await requireQr(prisma, hotelId, qrId);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await prisma.qr_code.updateMany({ where: { id: qrId, hotel_id: hotelId }, data: { code: token(), updated_at: new Date() } });
      return serializeAdmin(await requireQr(prisma, hotelId, qrId));
    } catch (error) { if (error?.code !== "P2002" || attempt === 2) throw error; }
  }
}

export async function issueRoomBookingCapability(hotelId, bookingId) {
  await requireHotel(prisma, hotelId);
  const booking = await prisma.room_booking.findFirst({
    where: { id: bookingId, hotel_id: hotelId },
    select: { id: true, status: true, checked_out_at: true, room: { select: { status: true, qr_code: { select: { type: true, hotel_id: true, is_active: true } } } } },
  });
  if (!booking) fail("Room booking not found.", "ROOM_BOOKING_NOT_FOUND", 404);
  if (booking.status !== "checked-in" || booking.checked_out_at || booking.room.status !== "active") fail("This booking is not eligible for room QR ordering.", "ROOM_BOOKING_NOT_QR_ELIGIBLE", 409);
  if (!booking.room.qr_code || booking.room.qr_code.type !== "room" || booking.room.qr_code.hotel_id !== hotelId || !booking.room.qr_code.is_active) fail("An active Room QR is required before issuing a booking capability.", "ROOM_QR_NOT_ACTIVE", 409);
  for (let attempt = 0; attempt < 3; attempt++) {
    const capability = token(), createdAt = new Date();
    try {
      const updated = await prisma.room_booking.updateMany({ where: { id: bookingId, hotel_id: hotelId, status: "checked-in", checked_out_at: null }, data: { ordering_capability_hash: digest(capability), ordering_capability_created_at: createdAt } });
      if (updated.count !== 1) fail("This booking is not eligible for room QR ordering.", "ROOM_BOOKING_NOT_QR_ELIGIBLE", 409);
      return { capability, created_at: createdAt.toISOString() };
    } catch (error) { if (error?.code !== "P2002" || attempt === 2) throw error; }
  }
}

async function loadPublicQr(qrToken, client = prisma) {
  const qr = await client.qr_code.findUnique({ where: { code: qrToken }, select: publicQrSelection });
  if (!qr || !qr.is_active || qr.hotel.status !== HOTEL_STATUSES.ACTIVE) fail("QR code is unavailable.", "QR_NOT_AVAILABLE", 404);
  const roomValid = qr.type === "room" && qr.room_id && !qr.dining_table_id && qr.room;
  const tableValid = qr.type === "dining_table" && qr.dining_table_id && !qr.room_id && qr.dining_table && qr.dining_table.dining_area.hotel_id === qr.hotel_id;
  if (!roomValid && !tableValid) fail("QR code is unavailable.", "QR_NOT_AVAILABLE", 404);
  return qr;
}

async function eligibleBooking(qr, client = prisma) {
  const bookings = await client.room_booking.findMany({
    where: { hotel_id: qr.hotel_id, room_id: qr.room_id, status: "checked-in", checked_out_at: null },
    orderBy: { checked_in_at: "desc" },
    take: 2,
    select: {
      id: true, hotel_id: true, room_id: true, customer_id: true, customer_name: true,
      customer_phone: true, customer_email: true, status: true, checked_out_at: true,
      ordering_capability_hash: true,
    },
  });
  return bookings.length === 1 ? bookings[0] : null;
}

function tableEligible(qr) {
  return qr.dining_table.dining_area.status === "active" && TABLE_ORDERABLE_STATUSES.has(qr.dining_table.status);
}

function publicContext(qr, { authorized = false, booking = null } = {}) {
  if (qr.type === "room") return {
    qr: { type: "room" }, hotel: { name: qr.hotel.name, timezone: qr.hotel.timezone }, room: { number: qr.room.room_number },
    ordering: { eligible: qr.room.status === "active" && Boolean(booking?.ordering_capability_hash), capability_required: true, ...(authorized ? { authorized: true } : {}) },
  };
  return {
    qr: { type: "dining_table" }, hotel: { name: qr.hotel.name, timezone: qr.hotel.timezone }, dining_area: { name: qr.dining_table.dining_area.name },
    table: { number: qr.dining_table.table_number, capacity: qr.dining_table.capacity }, ordering: { eligible: tableEligible(qr), capability_required: false },
  };
}

export async function resolvePublicQr(qrToken) {
  const qr = await loadPublicQr(qrToken);
  if (qr.type === "room") {
    if (qr.room.status !== "active") fail("Ordering is unavailable for this room.", "QR_CONTEXT_UNAVAILABLE", 409);
    return publicContext(qr, { booking: await eligibleBooking(qr) });
  }
  if (!tableEligible(qr)) fail("Ordering is unavailable for this table.", "QR_CONTEXT_UNAVAILABLE", 409);
  return publicContext(qr);
}

export async function resolvePublicOrderContext(client, qrToken, capability) {
  const qr = await loadPublicQr(qrToken, client);
  if (qr.type === "dining_table") {
    if (!tableEligible(qr)) fail("Ordering is unavailable for this table.", "QR_CONTEXT_UNAVAILABLE", 409);
    return { type: "dining_table", hotelId: qr.hotel_id, tableId: qr.dining_table_id, qr };
  }
  if (qr.room.status !== "active" || typeof capability !== "string" || !/^[A-Za-z0-9_-]{32,100}$/.test(capability)) {
    fail("Room ordering authorization failed.", "INVALID_ROOM_CAPABILITY", 403);
  }
  const booking = await eligibleBooking(qr, client);
  const supplied = Buffer.from(digest(capability), "hex");
  const stored = booking?.ordering_capability_hash ? Buffer.from(booking.ordering_capability_hash, "hex") : Buffer.alloc(supplied.length);
  if (!booking?.ordering_capability_hash || stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) {
    fail("Room ordering authorization failed.", "INVALID_ROOM_CAPABILITY", 403);
  }
  return { type: "room", hotelId: qr.hotel_id, roomId: qr.room_id, booking, qr };
}

export async function verifyRoomCapability(qrToken, capability) {
  const context = await resolvePublicOrderContext(prisma, qrToken, capability);
  if (context.type !== "room") fail("Room ordering authorization failed.", "INVALID_ROOM_CAPABILITY", 403);
  return publicContext(context.qr, { authorized: true, booking: context.booking });
}

export async function getPublicMenu(qrToken, capability) {
  const qr = await loadPublicQr(qrToken);
  let context;
  if (qr.type === "room") context = await verifyRoomCapability(qrToken, capability);
  else {
    if (!tableEligible(qr)) fail("Ordering is unavailable for this table.", "QR_CONTEXT_UNAVAILABLE", 409);
    context = publicContext(qr);
  }
  const [categories, items] = await Promise.all([
    prisma.menu_category.findMany({ where: { hotel_id: qr.hotel_id, is_active: true }, orderBy: [{ display_order: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.menu_item.findMany({ where: { hotel_id: qr.hotel_id, is_available: true, OR: [{ category_id: null }, { menu_category: { is: { hotel_id: qr.hotel_id, is_active: true } } }] }, orderBy: { name: "asc" }, select: { id: true, category_id: true, name: true, description: true, price: true, image_url: true, is_veg: true, preparation_time: true } }),
  ]);
  return { context, menu: { categories, items: items.map(({ price, ...item }) => ({ ...item, price: price.toFixed(2) })) } };
}
