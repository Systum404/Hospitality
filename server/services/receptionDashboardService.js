import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { bookingDateKey, hotelBookingDateBounds } from "../utils/bookingDates.js";

const activeOrderStatuses = ["pending", "preparing", "ready"];
const pendingBillStatuses = ["FINALIZED", "PARTIALLY_PAID"];

const decimal = (value) => value?.toFixed(2) ?? "0.00";
const iso = (value) => value?.toISOString() ?? null;

export async function getHotelDayBounds(hotelId, now = new Date()) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { timezone: true } });
  if (!hotel) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
  try { new Intl.DateTimeFormat("en-US", { timeZone: hotel.timezone }).format(now); }
  catch { throw new AppError("The hotel's timezone configuration is invalid.", { code: "INVALID_HOTEL_TIMEZONE", statusCode: 500 }); }
  const rows = await prisma.$queryRaw`
    SELECT
      ((((${now}::timestamptz AT TIME ZONE ${hotel.timezone})::date)::timestamp) AT TIME ZONE ${hotel.timezone}) AS day_start,
      ((((${now}::timestamptz AT TIME ZONE ${hotel.timezone})::date + 1)::timestamp) AT TIME ZONE ${hotel.timezone}) AS next_day
  `;
  const bookingDay = hotelBookingDateBounds(now, hotel.timezone);
  return { timezone: hotel.timezone, dayStart: rows[0].day_start, nextDay: rows[0].next_day, bookingDayStart: bookingDay.start, nextBookingDay: bookingDay.next, now };
}

export async function getReceptionDashboard(hotelId, now = new Date()) {
  const { timezone, dayStart, nextDay, bookingDayStart, nextBookingDay } = await getHotelDayBounds(hotelId, now);
  const bookingRoom = { select: { id: true, room_number: true, room_type: true } };
  const [
    totalActiveRooms, occupiedRows, availableRooms, todayCheckIns, todayCheckOuts,
    confirmedBookings, pendingPayments, todayCollections, currentGuests,
    arrivals, recentCheckIns, checkoutAlerts, activeRoomOrders,
  ] = await Promise.all([
    prisma.room.count({ where: { hotel_id: hotelId, status: "active" } }),
    prisma.room_booking.findMany({ where: { hotel_id: hotelId, status: "checked-in", room: { is: { hotel_id: hotelId } } }, distinct: ["room_id"], select: { room_id: true } }),
    prisma.room.count({ where: { hotel_id: hotelId, status: "active", room_booking: { none: { hotel_id: hotelId, OR: [{ status: "checked-in" }, { status: { in: ["reserved", "confirmed"] }, booking_from: { lte: bookingDayStart }, booking_to: { gt: bookingDayStart } }] } } } }),
    prisma.room_booking.count({ where: { hotel_id: hotelId, status: { not: "cancelled" }, checked_in_at: { gte: dayStart, lt: nextDay }, room: { is: { hotel_id: hotelId } } } }),
    prisma.room_booking.count({ where: { hotel_id: hotelId, checked_out_at: { gte: dayStart, lt: nextDay }, room: { is: { hotel_id: hotelId } } } }),
    prisma.room_booking.count({ where: { hotel_id: hotelId, status: "confirmed", booking_from: { gte: bookingDayStart, lt: nextBookingDay }, room: { is: { hotel_id: hotelId } } } }),
    prisma.bill.aggregate({ where: { hotel_id: hotelId, type: "ROOM", status: { in: pendingBillStatuses }, balance_due: { gt: 0 } }, _count: { _all: true }, _sum: { balance_due: true } }),
    prisma.payment.aggregate({ where: { hotel_id: hotelId, status: "RECORDED", created_at: { gte: dayStart, lt: nextDay }, bill: { is: { hotel_id: hotelId, type: "ROOM" } } }, _sum: { amount: true } }),
    prisma.room_booking.aggregate({ where: { hotel_id: hotelId, status: "checked-in", room: { is: { hotel_id: hotelId } } }, _sum: { adults: true, children: true } }),
    prisma.room_booking.findMany({ where: { hotel_id: hotelId, status: { in: ["reserved", "confirmed"] }, booking_from: { gte: bookingDayStart, lt: nextBookingDay }, room: { is: { hotel_id: hotelId } } }, orderBy: { booking_from: "asc" }, take: 8, select: { id: true, booking_number: true, customer_name: true, adults: true, children: true, booking_from: true, status: true, room: bookingRoom } }),
    prisma.room_booking.findMany({ where: { hotel_id: hotelId, status: { not: "cancelled" }, checked_in_at: { not: null }, room: { is: { hotel_id: hotelId } } }, orderBy: { checked_in_at: "desc" }, take: 5, select: { id: true, booking_number: true, customer_name: true, adults: true, children: true, checked_in_at: true, room: bookingRoom } }),
    prisma.room_booking.findMany({ where: { hotel_id: hotelId, status: "checked-in", booking_to: { lte: bookingDayStart }, room: { is: { hotel_id: hotelId } } }, orderBy: { booking_to: "asc" }, take: 8, select: { id: true, booking_number: true, customer_name: true, booking_to: true, room: bookingRoom, bill: { select: { balance_due: true, status: true } }, orders: { where: { hotel_id: hotelId, source: "room_qr", status: { in: activeOrderStatuses } }, select: { id: true } } } }),
    prisma.orders.findMany({
      where: {
        hotel_id: hotelId,
        source: "room_qr",
        status: { in: activeOrderStatuses },
        room_booking: { is: { hotel_id: hotelId, room: { is: { hotel_id: hotelId } } } },
      },
      orderBy: { created_at: "desc" },
      take: 8,
      select: { id: true, order_number: true, status: true, total_amount: true, created_at: true, room_booking: { select: { id: true, booking_number: true, customer_name: true, room: bookingRoom } }, _count: { select: { order_item: true } } },
    }),
  ]);

  return {
    meta: { timezone, generatedAt: now.toISOString() },
    summary: {
      totalActiveRooms,
      occupiedRooms: occupiedRows.length,
      availableRooms,
      todayCheckIns,
      todayCheckOuts,
      confirmedBookings,
      pendingPaymentAmount: decimal(pendingPayments._sum.balance_due),
      pendingPaymentCount: pendingPayments._count._all,
      todayCollections: decimal(todayCollections._sum.amount),
      currentGuestCount: (currentGuests._sum.adults ?? 0) + (currentGuests._sum.children ?? 0),
    },
    arrivals: arrivals.map(row => ({ id: row.id, bookingNumber: row.booking_number, guestName: row.customer_name, roomNumber: row.room.room_number, roomType: row.room.room_type, guests: row.adults + row.children, arrivalAt: bookingDateKey(row.booking_from), status: row.status })),
    recentCheckIns: recentCheckIns.map(row => ({ id: row.id, bookingNumber: row.booking_number, guestName: row.customer_name, roomNumber: row.room.room_number, roomType: row.room.room_type, guests: row.adults + row.children, checkedInAt: iso(row.checked_in_at) })),
    checkoutAlerts: checkoutAlerts.map(row => ({ id: row.id, bookingNumber: row.booking_number, guestName: row.customer_name, roomNumber: row.room.room_number, dueAt: bookingDateKey(row.booking_to), billBalance: row.bill ? decimal(row.bill.balance_due) : null, billStatus: row.bill?.status ?? null, activeRoomOrderCount: row.orders.length })),
    activeRoomOrders: activeRoomOrders.map(row => ({ id: row.id, orderNumber: row.order_number, bookingId: row.room_booking.id, bookingNumber: row.room_booking.booking_number, guestName: row.room_booking.customer_name, roomNumber: row.room_booking.room.room_number, itemCount: row._count.order_item, totalAmount: decimal(row.total_amount), status: row.status, createdAt: iso(row.created_at) })),
  };
}
