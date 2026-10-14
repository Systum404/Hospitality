import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";

const fields = { id: true, hotel_id: true, room_number: true, floor_number: true, capacity: true, room_type: true, status: true, base_price: true, description: true, created_at: true, updated_at: true };
const duplicate = (error) => error?.code === "P2002";
const serialize = ({ base_price, ...room }) => ({ ...room, base_price: base_price.toFixed(2) });

async function requireHotel(client, hotelId) {
  if (!await client.hotel.findUnique({ where: { id: hotelId }, select: { id: true } })) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
}
async function requireRoom(client, hotelId, roomId) {
  const room = await client.room.findFirst({ where: { id: roomId, hotel_id: hotelId }, select: fields });
  if (!room) throw new AppError("Room not found.", { code: "ROOM_NOT_FOUND", statusCode: 404 });
  return room;
}
async function lockHotel(client, hotelId) {
  const rows = await client.$queryRaw`SELECT id FROM hotel WHERE id = ${hotelId}::uuid FOR UPDATE`;
  if (!rows.length) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
}
async function ensureCapacitySupportsActiveBookings(client, hotelId, roomId, capacity) {
  const bookings = await client.room_booking.findMany({
    where: { hotel_id: hotelId, room_id: roomId, status: { in: ["reserved", "confirmed", "checked-in"] } },
    select: { adults: true, children: true },
  });
  const maximumOccupancy = bookings.reduce((maximum, booking) => Math.max(maximum, booking.adults + booking.children), 0);
  if (capacity < maximumOccupancy) {
    throw new AppError("Room capacity cannot be lower than an active booking's occupancy.", {
      code: "ROOM_CAPACITY_BELOW_ACTIVE_BOOKING",
      statusCode: 409,
    });
  }
}
function duplicateRoom(error) {
  if (duplicate(error)) return new AppError("A room with this room number already exists for this hotel.", { code: "DUPLICATE_ROOM_NUMBER", statusCode: 409 });
  return error;
}

export async function getRooms(hotelId) {
  await requireHotel(prisma, hotelId);
  return (await prisma.room.findMany({ where: { hotel_id: hotelId }, orderBy: { room_number: "asc" }, select: fields })).map(serialize);
}
export async function createRoom(hotelId, input) {
  await requireHotel(prisma, hotelId);
  try { return serialize(await prisma.room.create({ data: { id: randomUUID(), hotel_id: hotelId, ...input }, select: fields })); } catch (error) { throw duplicateRoom(error); }
}
export async function updateRoom(hotelId, roomId, input) {
  const update = async (client) => {
    await requireHotel(client, hotelId);
    const room = await requireRoom(client, hotelId, roomId);
    if (Object.hasOwn(input, "capacity") && input.capacity < room.capacity) {
      await ensureCapacitySupportsActiveBookings(client, hotelId, roomId, input.capacity);
    }
    try {
      const result = await client.room.updateMany({ where: { id: roomId, hotel_id: hotelId }, data: input });
      if (result.count !== 1) throw new AppError("Room not found.", { code: "ROOM_NOT_FOUND", statusCode: 404 });
    } catch (error) { throw duplicateRoom(error); }
    return serialize(await requireRoom(client, hotelId, roomId));
  };
  if (!Object.hasOwn(input, "capacity")) return update(prisma);
  return prisma.$transaction(async (client) => {
    await lockHotel(client, hotelId);
    return update(client);
  });
}
export async function updateRoomStatus(hotelId, roomId, status) {
  await requireHotel(prisma, hotelId);
  await requireRoom(prisma, hotelId, roomId);
  const result = await prisma.room.updateMany({ where: { id: roomId, hotel_id: hotelId }, data: { status } });
  if (result.count !== 1) throw new AppError("Room not found.", { code: "ROOM_NOT_FOUND", statusCode: 404 });
  return serialize(await requireRoom(prisma, hotelId, roomId));
}
export async function deleteRoom(hotelId, roomId) {
  return prisma.$transaction(async (client) => {
    await lockHotel(client, hotelId);
    const room = await client.room.findFirst({ where: { id: roomId, hotel_id: hotelId }, select: { ...fields, qr_code: { select: { id: true } }, _count: { select: { room_booking: true } } } });
    if (!room) throw new AppError("Room not found.", { code: "ROOM_NOT_FOUND", statusCode: 404 });
    if (room._count.room_booking) throw new AppError("Room cannot be deleted while bookings reference it.", { code: "ROOM_HAS_BOOKINGS", statusCode: 409 });
    if (room.qr_code) throw new AppError("Room cannot be deleted while a QR code references it.", { code: "ROOM_HAS_QR_CODE", statusCode: 409 });
    const { _count, qr_code, ...result } = room;
    await client.room.deleteMany({ where: { id: roomId, hotel_id: hotelId } });
    return serialize(result);
  });
}
