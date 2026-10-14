// Explicit local-only, rollback-only Manager Dashboard integration test.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { getManagerDashboard } from "../services/managerDashboardService.js";
import { getHotelDayBounds } from "../services/receptionDashboardService.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";

const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Manager Dashboard tests are local hms only");

const models = ["hotel", "users", "user_role", "attendance", "room", "room_booking", "dining_area", "dining_table", "inventory", "menu_item", "orders", "order_item", "bill", "payment"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const originalTransaction = prisma.$transaction.bind(prisma);
const saved = {};
const rollback = new Error("ROLLBACK_MANAGER_DASHBOARD_FIXTURES");
const results = [];
const check = (condition, message) => { assert.ok(condition, message); results.push(message); };
let server;

try {
  await originalTransaction(async tx => {
    for (const name of [...models, "$queryRaw"]) { saved[name] = prisma[name]; prisma[name] = tx[name]; }
    prisma.$transaction = work => work(tx);

    const hotelId = randomUUID(), otherHotelId = randomUUID();
    await tx.hotel.createMany({ data: [
    { id: hotelId, name: "Manager Dashboard hotel", status: "ACTIVE", timezone: "America/New_York" },
    { id: otherHotelId, name: "Manager Dashboard isolation hotel", status: "ACTIVE", timezone: "Pacific/Auckland" },
    ].map(entitledHotelFixture) });

    const roleRows = Object.fromEntries(await Promise.all(["Manager", "Reception", "Captain", "Kitchen"].map(async name => [name, await tx.role.findUniqueOrThrow({ where: { name } })])));
    const tokens = {};
    const actors = {};
    const addActor = async (key, role, tenant = hotelId, isActive = true) => {
      const userId = randomUUID(), userRoleId = randomUUID();
      await tx.users.create({ data: { id: userId, name: `${key} dashboard actor`, email: `${userId}@manager-dashboard.invalid`, password_hash: "not-a-login-secret", is_active: isActive } });
      await tx.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: roleRows[role].id, hotel_id: tenant } });
      actors[key] = { userId, userRoleId };
      if (isActive) tokens[key] = await createAuthenticationToken({ userId, userRoleId }, 600);
      return actors[key];
    };
    await addActor("manager", "Manager");
    await addActor("managerOther", "Manager", otherHotelId);
    await addActor("reception", "Reception");
    await addActor("captain", "Captain");
    await addActor("kitchen", "Kitchen");
    await addActor("inactive", "Kitchen", hotelId, false);

    const now = new Date();
    const { dayStart, nextDay, bookingDayStart } = await getHotelDayBounds(hotelId, now);
    const at = offset => new Date(dayStart.getTime() + offset);
    const bookingAt = offset => new Date(bookingDayStart.getTime() + offset * 86400000);

    const area = await tx.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Dashboard Area", status: "active" } });
    const tables = await Promise.all(["MD-1", "MD-2", "MD-3"].map(table_number => tx.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelId, dining_area_id: area.id, table_number, capacity: 4, status: "available" } })));
    const otherArea = await tx.dining_area.create({ data: { id: randomUUID(), hotel_id: otherHotelId, name: "Other Area", status: "active" } });
    const otherTable = await tx.dining_table.create({ data: { id: randomUUID(), hotel_id: otherHotelId, dining_area_id: otherArea.id, table_number: "OTHER", capacity: 4, status: "occupied" } });

    const rooms = await Promise.all(Array.from({ length: 5 }, (_, index) => tx.room.create({ data: { id: randomUUID(), hotel_id: hotelId, room_number: `MD-R${index + 1}`, status: index === 4 ? "inactive" : "active", capacity: 4, base_price: "100.00" } })));
    let bookingSerial = 0;
    const addBooking = data => tx.room_booking.create({ data: {
      id: randomUUID(), hotel_id: hotelId, room_id: data.room_id, booking_number: `MD-BK-${++bookingSerial}`,
      customer_name: data.customer_name || `Guest ${bookingSerial}`, customer_phone: "100", adults: data.adults ?? 1, children: data.children ?? 0,
      booking_from: data.booking_from, booking_to: data.booking_to, status: data.status,
      room_rate: "100.00", total_amount: "100.00", paid_amount: "0.00", payment_status: "pending",
    } });
    const checkedIn = await addBooking({ room_id: rooms[0].id, status: "checked-in", adults: 2, children: 1, booking_from: bookingAt(-1), booking_to: bookingAt(1) });
    await addBooking({ room_id: rooms[1].id, status: "confirmed", booking_from: bookingAt(0), booking_to: bookingAt(1) });
    const checkedOut = await addBooking({ room_id: rooms[2].id, status: "checked-out", booking_from: bookingAt(-2), booking_to: bookingAt(0) });
    await addBooking({ room_id: rooms[3].id, status: "cancelled", booking_from: bookingAt(0), booking_to: bookingAt(1) });

    await tx.inventory.createMany({ data: [
      { id: randomUUID(), hotel_id: hotelId, name: "At minimum", quantity: "5.00", minimum_quantity: "5.00", unit: "kg" },
      { id: randomUUID(), hotel_id: hotelId, name: "Below minimum", quantity: "1.00", minimum_quantity: "2.00", unit: "ltr" },
      { id: randomUUID(), hotel_id: hotelId, name: "Healthy stock", quantity: "8.00", minimum_quantity: "2.00", unit: "pcs" },
      { id: randomUUID(), hotel_id: otherHotelId, name: "Foreign low", quantity: "0.00", minimum_quantity: "10.00", unit: "kg" },
    ] });

    const menu = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Dashboard item", price: "10.00" } });
    const otherMenu = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: otherHotelId, name: "Foreign item", price: "10.00" } });
    let orderSerial = 0;
    const addOrder = ({ tenant = hotelId, source, status, tableId = null, bookingId = null, quantity = 1, createdAt = now, item = menu }) => tx.orders.create({ data: {
      id: randomUUID(), hotel_id: tenant, table_id: tableId, room_booking_id: bookingId,
      order_number: `MD-ORDER-${++orderSerial}`, source, customer_name: `${source} guest`, customer_phone: "200",
      status, subtotal: `${quantity * 10}.00`, total_amount: `${quantity * 10}.00`, payment_status: "pending", created_at: createdAt,
      order_item: { create: { id: randomUUID(), menu_item_id: item.id, item_name: item.name, quantity, unit_price: "10.00", subtotal: `${quantity * 10}.00`, status } },
    } });
    const roomActive = await addOrder({ source: "room_qr", status: "pending", bookingId: checkedIn.id, createdAt: at(5000) });
    const captainActive = await addOrder({ source: "captain", status: "preparing", tableId: tables[0].id, createdAt: at(6000) });
    const qrActive = await addOrder({ source: "dining_table_qr", status: "ready", tableId: tables[1].id, createdAt: at(7000) });
    const captainComplete = await addOrder({ source: "captain", status: "completed", tableId: tables[0].id, quantity: 3, createdAt: at(8000) });
    await addOrder({ source: "room_qr", status: "completed", bookingId: checkedIn.id, quantity: 2, createdAt: at(9000) });
    await addOrder({ source: "admin", status: "pending", createdAt: at(10000) });
    await addOrder({ tenant: otherHotelId, source: "captain", status: "pending", tableId: otherTable.id, item: otherMenu, createdAt: at(11000) });

    const makeBill = async data => {
      let bill = await tx.bill.create({ data: {
        id: randomUUID(), hotel_id: data.tenant ?? hotelId, type: data.type, room_booking_id: data.roomBookingId ?? null,
        order_id: data.orderId ?? null, source_reference: `MD-SOURCE-${randomUUID()}`, hotel_snapshot: {}, guest_snapshot: { name: data.guest ?? "Dashboard Guest" },
         subtotal: data.total, taxable_subtotal: data.total, total_amount: data.total, amount_paid: "0.00", balance_due: data.total,
         status: "DRAFT", created_by: actors.manager.userId,
         items: { create: {
           id: randomUUID(), position: 1, description: `${data.type} dashboard charge`, quantity: 1,
           unit_price: data.total, subtotal: data.total, total_amount: data.total,
         } },
       } });
      if (data.status === "DRAFT") return bill;
      if (data.status === "VOID") return tx.bill.update({ where: { id: bill.id }, data: { status: "VOID", voided_by: actors.manager.userId, voided_at: now } });
      bill = await tx.bill.update({ where: { id: bill.id }, data: { status: "FINALIZED", finalized_by: actors.manager.userId, finalized_at: now } });
      return bill;
    };
    const roomBill = await makeBill({ type: "ROOM", roomBookingId: checkedOut.id, total: "100.00", balance: "60.00", status: "FINALIZED" });
    const captainBill = await makeBill({ type: "CAPTAIN", orderId: captainComplete.id, total: "30.00", paid: "10.00", balance: "20.00", status: "PARTIALLY_PAID" });
    const voidOrder = await addOrder({ source: "captain", status: "completed", tableId: tables[2].id, createdAt: at(12000) });
    const voidBill = await makeBill({ type: "CAPTAIN", orderId: voidOrder.id, total: "40.00", balance: "40.00", status: "VOID" });
    const draftOrder = await addOrder({ source: "captain", status: "completed", tableId: tables[2].id, createdAt: at(13000) });
    await makeBill({ type: "CAPTAIN", orderId: draftOrder.id, total: "50.00", balance: "50.00", status: "DRAFT" });
    const addPayment = (billId, amount, created_at, tenant = hotelId) => tx.payment.create({ data: { id: randomUUID(), hotel_id: tenant, bill_id: billId, amount, method: "Cash", status: "RECORDED", idempotency_key: randomUUID(), created_at, created_by: actors.manager.userId } });
    await addPayment(roomBill.id, "40.00", at(1));
    await addPayment(captainBill.id, "10.00", at(2));
    await addPayment(roomBill.id, "5.00", at(-1));

    const attendanceDate = bookingDayStart;
    await tx.attendance.createMany({ data: [
      { id: randomUUID(), hotel_id: hotelId, user_id: actors.manager.userId, user_role_id: actors.manager.userRoleId, attendance_date: attendanceDate, status: "present", recorded_by: actors.manager.userId },
      { id: randomUUID(), hotel_id: hotelId, user_id: actors.reception.userId, user_role_id: actors.reception.userRoleId, attendance_date: attendanceDate, status: "absent", recorded_by: actors.manager.userId },
      { id: randomUUID(), hotel_id: hotelId, user_id: actors.inactive.userId, user_role_id: actors.inactive.userRoleId, attendance_date: attendanceDate, status: "present", recorded_by: actors.manager.userId },
    ] });

    const data = await getManagerDashboard(hotelId, now);
    check(data.meta.timezone === "America/New_York" && data.meta.localDate === attendanceDate.toISOString().slice(0, 10), "stored hotel timezone and local date returned");
    check(data.metrics.todayCollections === "50.00", "today collections sum persisted room and restaurant payments");
    check(!data.pendingPayments.some(bill => bill.invoiceNumber === voidBill.invoice_number), "VOID bills are excluded from payable dashboard data");
    check(data.metrics.todayCollections !== "55.00", "payment before hotel-local day boundary excluded");
    check(data.metrics.totalOrders === 7, "room, Captain, and Table QR orders included while admin source excluded");
    check(data.metrics.activeOrders === 3, "only pending, preparing, and ready orders are active");
    check(data.metrics.occupiedTables === 2 && data.metrics.totalTables === 3, "table occupancy derives from distinct active restaurant orders and current table count");
    check(data.metrics.presentStaff === 1 && data.metrics.totalStaff === 4, "attendance counts present active hotel users and leaves absent/unmarked staff uncounted");
    check(data.metrics.lowStockCount === 2 && data.lowStockAlerts.length === 2, "quantity at or below minimum is low stock");
    check(!data.lowStockAlerts.some(item => item.name === "Foreign low"), "foreign inventory excluded");
    check(data.recentOrders.length === 5 && data.recentOrders[0].orderNumber === draftOrder.order_number, "recent orders are persisted and newest first");
    check(new Set(data.recentOrders.map(order => order.source)).has("room_qr"), "recent orders include room service");
    check(!JSON.stringify(data).includes(roomActive.id) && !JSON.stringify(data).includes(captainActive.id) && !JSON.stringify(data).includes(qrActive.id), "internal order UUIDs are not exposed");
    check(data.topSellingItems[0].itemName === menu.name && data.topSellingItems[0].quantity === 7, "top items aggregate completed order-item quantities only");
    check(data.pendingPayments.length === 2 && data.pendingPayments.reduce((sum, bill) => sum + Number(bill.balanceDue), 0) === 75, "finalized and partially paid outstanding bills returned");
    check(!data.pendingPayments.some(bill => [voidBill.invoice_number].includes(bill.invoiceNumber)), "VOID and draft bills excluded from pending payments");
    check(data.roomOperations.totalActiveRooms === 4 && data.roomOperations.occupiedRooms === 1 && data.roomOperations.availableRooms === 2, "room occupancy and availability follow established booking semantics");
    check(data.roomOperations.todayArrivals === 1 && data.roomOperations.confirmedArrivals === 1 && data.roomOperations.todayDepartures === 1, "booking date-only arrival and departure metrics are correct");
    check(data.roomOperations.currentGuestCount === 3, "current checked-in guest count sums adults and children");
    check(!JSON.stringify(data).includes(otherHotelId), "cross-hotel records are absent from the DTO");

    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async ({ tenant = hotelId, token = tokens.manager, expected = 200 } = {}) => {
      const response = await fetch(`${origin}/api/hotels/${tenant}/manager/dashboard`, { headers: token ? { Cookie: `aazira_auth=${token}` } : {} });
      const body = await response.json();
      assert.equal(response.status, expected, JSON.stringify(body));
      return body;
    };
    const response = await request();
    check(response.status === "success" && response.data.metrics.totalOrders === data.metrics.totalOrders, "authenticated Manager endpoint returns the dashboard DTO");
    check((await request({ token: null, expected: 401 })).error.code === "UNAUTHENTICATED", "authentication is required");
    check((await request({ token: tokens.reception, expected: 403 })).error.code === "FORBIDDEN", "non-Manager role is rejected");
    check((await request({ tenant: otherHotelId, expected: 403 })).error.code === "HOTEL_SCOPE_MISMATCH", "URL hotel mismatch is rejected");
    check((await request({ tenant: "not-a-uuid", expected: 400 })).error.code === "INVALID_HOTEL_ID", "hotel UUID is validated before scope");
    await assert.rejects(getManagerDashboard(randomUUID(), now), error => error.code === "HOTEL_NOT_FOUND" && error.statusCode === 404);
    results.push("nonexistent hotel follows HOTEL_NOT_FOUND service convention");
    check(!JSON.stringify(response).includes("password_hash") && !JSON.stringify(response).includes("idempotency_key"), "sensitive authentication and idempotency fields are not exposed");

    throw rollback;
  }, { timeout: 120000 });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  for (const [name, value] of Object.entries(saved)) prisma[name] = value;
  prisma.$transaction = originalTransaction;
  if (server) await new Promise(resolve => server.close(resolve));
  try {
    assert.deepEqual(await counts(), before, "Manager Dashboard fixtures were not fully rolled back");
    console.log(JSON.stringify({ checks: results.length, countsBeforeAndAfter: before, cleanup: "All Manager Dashboard fixtures rolled back." }));
  } finally {
    await prisma.$disconnect();
  }
}

console.log(`Manager Dashboard integration tests passed: ${results.length}/${results.length}`);
for (const result of results) console.log(`- ${result}`);
