import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { hotelAttendanceDateKey } from "./receptionAttendanceService.js";
import { getHotelDayBounds } from "./receptionDashboardService.js";

const managerOrderSources = ["room_qr", "captain", "dining_table_qr"];
const restaurantOrderSources = ["captain", "dining_table_qr"];
const activeOrderStatuses = ["pending", "preparing", "ready"];
const payableBillStatuses = ["FINALIZED", "PARTIALLY_PAID"];

const decimal = value => value?.toFixed(2) ?? "0.00";
const iso = value => value?.toISOString() ?? null;

export async function getManagerDashboard(hotelId, now = new Date()) {
  const hotel = await prisma.hotel.findUnique({
    where: { id: hotelId },
    select: { id: true, timezone: true },
  });
  if (!hotel) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });

  const { timezone, dayStart, nextDay, bookingDayStart, nextBookingDay } = await getHotelDayBounds(hotelId, now);
  const attendanceDate = new Date(`${hotelAttendanceDateKey(now, timezone)}T00:00:00.000Z`);
  const scopedOrders = { hotel_id: hotelId, source: { in: managerOrderSources } };

  const [
    todayCollections,
    totalOrders,
    activeOrders,
    totalTables,
    occupiedTableRows,
    eligibleStaff,
    presentToday,
    inventoryRows,
    recentOrders,
    topItems,
    pendingPayments,
    totalActiveRooms,
    occupiedRoomRows,
    availableRooms,
    todayArrivals,
    todayDepartures,
    confirmedArrivals,
    currentGuests,
  ] = await Promise.all([
    prisma.payment.aggregate({
      where: {
        hotel_id: hotelId,
        status: "RECORDED",
        created_at: { gte: dayStart, lt: nextDay },
        bill: { is: { hotel_id: hotelId, type: { in: ["ROOM", "CAPTAIN"] }, status: { not: "VOID" } } },
      },
      _sum: { amount: true },
    }),
    prisma.orders.count({ where: scopedOrders }),
    prisma.orders.count({ where: { ...scopedOrders, status: { in: activeOrderStatuses } } }),
    prisma.dining_table.count({ where: { hotel_id: hotelId } }),
    prisma.orders.findMany({
      where: {
        hotel_id: hotelId,
        source: { in: restaurantOrderSources },
        status: { in: activeOrderStatuses },
        table_id: { not: null },
        dining_table: { is: { hotel_id: hotelId } },
      },
      distinct: ["table_id"],
      select: { table_id: true },
    }),
    prisma.user_role.findMany({
      where: { hotel_id: hotelId, users: { is_active: true } },
      distinct: ["user_id"],
      select: { user_id: true },
    }),
    prisma.attendance.count({
      where: {
        hotel_id: hotelId,
        attendance_date: attendanceDate,
        status: "present",
        user: { is: { is_active: true, user_role: { some: { hotel_id: hotelId } } } },
      },
    }),
    prisma.inventory.findMany({
      where: { hotel_id: hotelId },
      orderBy: [{ updated_at: "desc" }, { name: "asc" }],
      select: { name: true, quantity: true, minimum_quantity: true, unit: true },
    }),
    prisma.orders.findMany({
      where: scopedOrders,
      orderBy: [{ created_at: "desc" }, { order_number: "asc" }],
      take: 5,
      select: {
        order_number: true,
        source: true,
        customer_name: true,
        status: true,
        total_amount: true,
        created_at: true,
        dining_table: { select: { table_number: true, dining_area: { select: { name: true } } } },
        room_booking: { select: { room: { select: { room_number: true } } } },
        _count: { select: { order_item: true } },
      },
    }),
    prisma.order_item.groupBy({
      by: ["menu_item_id", "item_name"],
      where: { orders: { hotel_id: hotelId, source: { in: managerOrderSources }, status: "completed" } },
      _sum: { quantity: true, subtotal: true },
      orderBy: [{ _sum: { quantity: "desc" } }, { item_name: "asc" }],
      take: 4,
    }),
    prisma.bill.findMany({
      where: {
        hotel_id: hotelId,
        type: { in: ["ROOM", "CAPTAIN"] },
        status: { in: payableBillStatuses },
        balance_due: { gt: 0 },
      },
      orderBy: [{ created_at: "desc" }, { invoice_number: "asc" }],
      take: 5,
      select: {
        invoice_number: true,
        type: true,
        source_reference: true,
        guest_snapshot: true,
        balance_due: true,
        status: true,
        created_at: true,
      },
    }),
    prisma.room.count({ where: { hotel_id: hotelId, status: "active" } }),
    prisma.room_booking.findMany({
      where: { hotel_id: hotelId, status: "checked-in", room: { is: { hotel_id: hotelId } } },
      distinct: ["room_id"],
      select: { room_id: true },
    }),
    prisma.room.count({
      where: {
        hotel_id: hotelId,
        status: "active",
        room_booking: {
          none: {
            hotel_id: hotelId,
            OR: [
              { status: "checked-in" },
              { status: { in: ["reserved", "confirmed"] }, booking_from: { lte: bookingDayStart }, booking_to: { gt: bookingDayStart } },
            ],
          },
        },
      },
    }),
    prisma.room_booking.count({
      where: { hotel_id: hotelId, status: { not: "cancelled" }, booking_from: { gte: bookingDayStart, lt: nextBookingDay } },
    }),
    prisma.room_booking.count({
      where: { hotel_id: hotelId, status: { not: "cancelled" }, booking_to: { gte: bookingDayStart, lt: nextBookingDay } },
    }),
    prisma.room_booking.count({
      where: { hotel_id: hotelId, status: "confirmed", booking_from: { gte: bookingDayStart, lt: nextBookingDay } },
    }),
    prisma.room_booking.aggregate({
      where: { hotel_id: hotelId, status: "checked-in", room: { is: { hotel_id: hotelId } } },
      _sum: { adults: true, children: true },
    }),
  ]);

  const lowStockAlerts = inventoryRows
    .filter(item => item.quantity.lessThanOrEqualTo(item.minimum_quantity))
    .map(item => ({
      name: item.name,
      quantity: decimal(item.quantity),
      minimumQuantity: decimal(item.minimum_quantity),
      unit: item.unit,
      status: "low",
    }));

  return {
    meta: { timezone, localDate: hotelAttendanceDateKey(now, timezone), generatedAt: now.toISOString() },
    metrics: {
      todayCollections: decimal(todayCollections._sum.amount),
      totalOrders,
      activeOrders,
      occupiedTables: occupiedTableRows.length,
      totalTables,
      presentStaff: presentToday,
      totalStaff: eligibleStaff.length,
      lowStockCount: lowStockAlerts.length,
    },
    roomOperations: {
      totalActiveRooms,
      occupiedRooms: occupiedRoomRows.length,
      availableRooms,
      todayArrivals,
      todayDepartures,
      confirmedArrivals,
      currentGuestCount: (currentGuests._sum.adults ?? 0) + (currentGuests._sum.children ?? 0),
    },
    lowStockAlerts,
    recentOrders: recentOrders.map(order => ({
      orderNumber: order.order_number,
      source: order.source,
      customerName: order.customer_name,
      location: order.dining_table
        ? `${order.dining_table.dining_area.name} · Table ${order.dining_table.table_number}`
        : order.room_booking
          ? `Room ${order.room_booking.room.room_number}`
          : null,
      itemCount: order._count.order_item,
      totalAmount: decimal(order.total_amount),
      status: order.status,
      createdAt: iso(order.created_at),
    })),
    topSellingItems: topItems.map((item, index) => ({
      rank: index + 1,
      itemName: item.item_name,
      quantity: item._sum.quantity ?? 0,
      itemTotal: decimal(item._sum.subtotal),
    })),
    pendingPayments: pendingPayments.map(bill => ({
      invoiceNumber: bill.invoice_number,
      type: bill.type,
      sourceReference: bill.source_reference,
      guestName: typeof bill.guest_snapshot === "object" && bill.guest_snapshot !== null ? bill.guest_snapshot.name ?? null : null,
      balanceDue: decimal(bill.balance_due),
      status: bill.status,
      createdAt: iso(bill.created_at),
    })),
  };
}
