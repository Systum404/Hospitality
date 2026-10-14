import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { hotelAttendanceDateKey } from "./receptionAttendanceService.js";
import { getHotelDayBounds } from "./receptionDashboardService.js";

const orderSources = ["room_qr", "captain", "dining_table_qr"];
const restaurantSources = ["captain", "dining_table_qr"];
const activeStatuses = ["pending", "preparing", "ready"];
const money = value => value == null ? "0.00" : Number(value).toFixed(2);
const iso = value => value?.toISOString() ?? null;

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

async function localPeriodBounds(timezone, localDate) {
  const year = Number(localDate.slice(0, 4));
  const month = Number(localDate.slice(5, 7));
  const monthStart = monthKey(year, month);
  const nextMonth = month === 12 ? monthKey(year + 1, 1) : monthKey(year, month + 1);
  const previousMonth = month === 1 ? monthKey(year - 1, 12) : monthKey(year, month - 1);
  const yearStart = monthKey(year, 1);
  const nextYear = monthKey(year + 1, 1);
  const rows = await prisma.$queryRaw`
    SELECT
      timezone(${timezone}::text, ${previousMonth}::date::timestamp) AS previous_month_start,
      timezone(${timezone}::text, ${monthStart}::date::timestamp) AS month_start,
      timezone(${timezone}::text, ${nextMonth}::date::timestamp) AS next_month_start,
      timezone(${timezone}::text, ${yearStart}::date::timestamp) AS year_start,
      timezone(${timezone}::text, ${nextYear}::date::timestamp) AS next_year_start
  `;
  return { ...rows[0], year };
}

export async function getAdminDashboard(hotelId, now = new Date()) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { code: true, id: true, name: true, timezone: true } });
  if (!hotel) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });

  const { timezone, dayStart, nextDay } = await getHotelDayBounds(hotelId, now);
  const localDate = hotelAttendanceDateKey(now, timezone);
  const attendanceDate = new Date(`${localDate}T00:00:00.000Z`);
  const periods = await localPeriodBounds(timezone, localDate);
  const scopedOrders = { hotel_id: hotelId, source: { in: orderSources } };

  const [
    currentMonthCollections,
    previousMonthCollections,
    monthlyRows,
    totalOrders,
    activeOrders,
    preparingOrders,
    staffRows,
    presentStaff,
    totalTables,
    occupiedTableRows,
    menuItems,
    menuCategories,
    activeVendors,
    inactiveVendors,
    vendors,
    roomBookings,
    totalActiveRooms,
    occupiedRoomRows,
    ordersToday,
    recentOrders,
    inventoryRows,
  ] = await Promise.all([
    prisma.payment.aggregate({
      where: { hotel_id: hotelId, status: "RECORDED", created_at: { gte: periods.month_start, lt: periods.next_month_start }, bill: { is: { hotel_id: hotelId, type: { in: ["ROOM", "CAPTAIN"] }, status: { not: "VOID" } } } },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { hotel_id: hotelId, status: "RECORDED", created_at: { gte: periods.previous_month_start, lt: periods.month_start }, bill: { is: { hotel_id: hotelId, type: { in: ["ROOM", "CAPTAIN"] }, status: { not: "VOID" } } } },
      _sum: { amount: true },
    }),
    prisma.payment.findMany({
      where: { hotel_id: hotelId, status: "RECORDED", created_at: { gte: periods.year_start, lt: periods.next_year_start }, bill: { is: { hotel_id: hotelId, type: { in: ["ROOM", "CAPTAIN"] }, status: { not: "VOID" } } } },
      select: { amount: true, created_at: true },
    }),
    prisma.orders.count({ where: scopedOrders }),
    prisma.orders.count({ where: { ...scopedOrders, status: { in: activeStatuses } } }),
    prisma.orders.count({ where: { ...scopedOrders, status: "preparing" } }),
    prisma.user_role.findMany({ where: { hotel_id: hotelId, users: { is_active: true } }, distinct: ["user_id"], select: { user_id: true } }),
    prisma.attendance.count({ where: { hotel_id: hotelId, attendance_date: attendanceDate, status: "present", user: { is: { is_active: true, user_role: { some: { hotel_id: hotelId } } } } } }),
    prisma.dining_table.count({ where: { hotel_id: hotelId } }),
    prisma.orders.findMany({
      where: { hotel_id: hotelId, source: { in: restaurantSources }, status: { in: activeStatuses }, table_id: { not: null }, dining_table: { is: { hotel_id: hotelId } } },
      distinct: ["table_id"],
      select: { table_id: true },
    }),
    prisma.menu_item.count({ where: { hotel_id: hotelId } }),
    prisma.menu_category.count({ where: { hotel_id: hotelId } }),
    prisma.vendor.count({ where: { hotel_id: hotelId, is_active: true } }),
    prisma.vendor.count({ where: { hotel_id: hotelId, is_active: false } }),
    prisma.vendor.findMany({
      where: { hotel_id: hotelId, is_active: true },
      orderBy: [{ updated_at: "desc" }, { name: "asc" }],
      take: 5,
      select: { name: true, contact_person: true, phone: true, email: true, _count: { select: { inventory: true } } },
    }),
    prisma.room_booking.findMany({
      where: { hotel_id: hotelId },
      orderBy: [{ created_at: "desc" }, { booking_number: "asc" }],
      take: 5,
      select: { booking_number: true, customer_name: true, booking_from: true, booking_to: true, status: true, room: { select: { room_number: true, room_type: true } } },
    }),
    prisma.room.count({ where: { hotel_id: hotelId, status: "active" } }),
    prisma.room_booking.findMany({ where: { hotel_id: hotelId, status: "checked-in", room: { is: { hotel_id: hotelId, status: "active" } } }, distinct: ["room_id"], select: { room_id: true } }),
    prisma.orders.count({ where: { ...scopedOrders, created_at: { gte: dayStart, lt: nextDay } } }),
    prisma.orders.findMany({
      where: scopedOrders,
      orderBy: [{ created_at: "desc" }, { order_number: "asc" }],
      take: 5,
      select: {
        order_number: true, source: true, status: true, total_amount: true, created_at: true,
        dining_table: { select: { table_number: true, dining_area: { select: { name: true } } } },
        room_booking: { select: { room: { select: { room_number: true } } } },
        _count: { select: { order_item: true } },
      },
    }),
    prisma.inventory.findMany({ where: { hotel_id: hotelId }, orderBy: [{ name: "asc" }], select: { name: true, quantity: true, minimum_quantity: true, unit: true } }),
  ]);

  const lowStockAlerts = inventoryRows.filter(item => item.quantity.lessThanOrEqualTo(item.minimum_quantity)).map(item => ({
    type: "low_stock",
    title: "Low Stock Alert",
    description: `${item.name}: ${money(item.quantity)} ${item.unit || "units"} remaining (minimum ${money(item.minimum_quantity)})`,
    itemName: item.name,
  }));
  const monthValues = new Map();
  for (const payment of monthlyRows) {
    const month = Number(new Intl.DateTimeFormat("en-US", { month: "numeric", timeZone: timezone }).format(payment.created_at));
    monthValues.set(month, (monthValues.get(month) || 0) + Number(payment.amount));
  }
  const occupiedRooms = occupiedRoomRows.length;

  return {
    hotel: { code: hotel.code, name: hotel.name },
    meta: { timezone, localDate, generatedAt: now.toISOString(), revenueYear: periods.year },
    metrics: {
      monthCollections: money(currentMonthCollections._sum.amount),
      previousMonthCollections: money(previousMonthCollections._sum.amount),
      totalOrders,
      activeOrders,
      preparingOrders,
      totalStaff: staffRows.length,
      presentStaff,
      totalTables,
      occupiedTables: occupiedTableRows.length,
      menuItems,
      menuCategories,
      activeVendors,
      inactiveVendors,
    },
    recentOrders: recentOrders.map(order => ({
      orderNumber: order.order_number,
      source: order.source,
      tableNumber: order.dining_table?.table_number ?? (order.room_booking ? `Room ${order.room_booking.room.room_number}` : "—"),
      areaName: order.dining_table?.dining_area.name ?? (order.room_booking ? "Room Service" : "—"),
      itemCount: order._count.order_item,
      totalAmount: money(order.total_amount),
      status: order.status,
      createdAt: iso(order.created_at),
    })),
    vendors: vendors.map(vendor => ({
      reference: null,
      name: vendor.name,
      contact: vendor.contact_person || vendor.phone || vendor.email || "—",
      inventoryItemCount: vendor._count.inventory,
      category: null,
      amount: null,
    })),
    roomBookings: roomBookings.map(booking => ({
      bookingNumber: booking.booking_number,
      roomNumber: booking.room.room_number,
      guestName: booking.customer_name,
      roomType: booking.room.room_type || "—",
      checkIn: booking.booking_from.toISOString().slice(0, 10),
      checkOut: booking.booking_to.toISOString().slice(0, 10),
      status: booking.status,
    })),
    staffActivity: [],
    revenueOverview: {
      year: periods.year,
      labels: Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(periods.year, index, 1)))),
      values: Array.from({ length: 12 }, (_, index) => monthValues.get(index + 1) || 0),
      totalCollections: money(monthlyRows.reduce((sum, payment) => sum + Number(payment.amount), 0)),
    },
    operationalSnapshot: {
      totalActiveRooms,
      occupiedRooms,
      availableRooms: Math.max(0, totalActiveRooms - occupiedRooms),
      occupancyPercent: totalActiveRooms ? Math.round((occupiedRooms / totalActiveRooms) * 100) : 0,
      ordersToday,
      activeOrders,
      presentStaff,
      totalStaff: staffRows.length,
      lowStockCount: lowStockAlerts.length,
      pendingApprovals: null,
    },
    alerts: lowStockAlerts,
  };
}
