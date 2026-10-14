import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";

const ACTIVE_CAPTAIN_ORDER_STATUSES = ["pending", "preparing", "ready"];

const iso = value => value.toISOString();

export async function getReceptionTableStatus(hotelId) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { id: true } });
  if (!hotel) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });

  const tables = await prisma.dining_table.findMany({
    where: {
      hotel_id: hotelId,
      dining_area: { is: { hotel_id: hotelId } },
    },
    orderBy: [
      { dining_area: { name: "asc" } },
      { table_number: "asc" },
    ],
    select: {
      id: true,
      table_number: true,
      capacity: true,
      created_at: true,
      updated_at: true,
      dining_area: { select: { id: true, name: true } },
      orders: {
        where: {
          hotel_id: hotelId,
          source: { in: ["captain", "dining_table_qr"] },
          status: { in: ACTIVE_CAPTAIN_ORDER_STATUSES },
        },
        orderBy: { created_at: "desc" },
        take: 1,
        select: { id: true, order_number: true, status: true, created_at: true },
      },
    },
  });

  return tables.map(({ dining_area: area, orders, created_at, updated_at, table_number, ...table }) => ({
    ...table,
    tableNumber: table_number,
    area,
    effectiveStatus: orders.length ? "occupied" : "available",
    activeOrder: orders.length ? {
      id: orders[0].id,
      orderNumber: orders[0].order_number,
      status: orders[0].status,
      createdAt: iso(orders[0].created_at),
    } : null,
    createdAt: iso(created_at),
    updatedAt: iso(updated_at),
  }));
}
