// Explicit local-only, rollback-only Admin Dashboard integration test.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { getAdminDashboard } from "../services/adminDashboardService.js";
import { getHotelDayBounds } from "../services/receptionDashboardService.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";

const database = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && database.pathname === "/hms", "Admin Dashboard tests are local hms only");
const models = ["hotel", "users", "user_role", "attendance", "room", "room_booking", "dining_area", "dining_table", "inventory", "vendor", "menu_category", "menu_item", "orders", "order_item", "bill", "payment"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async model => [model, await prisma[model].count()])));
const before = await counts();
const originalTransaction = prisma.$transaction.bind(prisma);
const saved = {}, rollback = new Error("ROLLBACK_ADMIN_DASHBOARD_FIXTURES"), results = [];
const check = (condition, message) => { assert.ok(condition, message); results.push(message); };
let server;

try {
  await originalTransaction(async tx => {
    for (const model of [...models, "$queryRaw"]) { saved[model] = prisma[model]; prisma[model] = tx[model]; }
    prisma.$transaction = work => work(tx);
    const hotelId = randomUUID(), otherHotelId = randomUUID();
    await tx.hotel.createMany({ data: [
      { id: hotelId, code: "HTL-990101", name: "Admin Dashboard Hotel", status: "ACTIVE", timezone: "Asia/Kolkata" },
      { id: otherHotelId, code: "HTL-990102", name: "Admin Dashboard Other", status: "ACTIVE", timezone: "America/New_York" },
    ].map(entitledHotelFixture) });
    const roles = Object.fromEntries(await Promise.all(["Admin", "Manager", "Reception"].map(async name => [name, await tx.role.findUniqueOrThrow({ where: { name } })])));
    const tokens = {}, actors = {};
    const addActor = async (key, role, tenant = hotelId, active = true) => {
      const userId = randomUUID(), userRoleId = randomUUID();
      await tx.users.create({ data: { id: userId, name: `${key} fixture`, email: `${userId}@admin-dashboard.invalid`, password_hash: "not-a-login-secret", is_active: active } });
      await tx.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: roles[role].id, hotel_id: tenant } });
      actors[key] = { userId, userRoleId };
      if (active) tokens[key] = await createAuthenticationToken({ userId, userRoleId }, 600);
    };
    await addActor("admin", "Admin"); await addActor("manager", "Manager"); await addActor("reception", "Reception");
    await addActor("inactive", "Reception", hotelId, false); await addActor("otherAdmin", "Admin", otherHotelId);

    const now = new Date("2026-05-15T08:30:00.000Z");
    const { dayStart } = await getHotelDayBounds(hotelId, now);
    const currentTime = new Date(dayStart.getTime() + 3600000);
    const attendanceDate = new Date("2026-05-15T00:00:00.000Z");
    const area = await tx.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Admin Area", status: "active" } });
    const tables = await Promise.all(["AD-1", "AD-2"].map(table_number => tx.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelId, dining_area_id: area.id, table_number, capacity: 4, status: "available" } })));
    const category = await tx.menu_category.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Admin Category", is_active: true } });
    const item = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelId, category_id: category.id, name: "Admin Item", price: "10.00" } });
    const vendor = await tx.vendor.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Admin Vendor", contact_person: "Vendor Contact", is_active: true } });
    await tx.vendor.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Inactive Vendor", is_active: false } });
    await tx.inventory.createMany({ data: [
      { id: randomUUID(), hotel_id: hotelId, supplier_id: vendor.id, name: "Critical Stock", quantity: "1.00", minimum_quantity: "2.00", unit: "kg" },
      { id: randomUUID(), hotel_id: hotelId, supplier_id: vendor.id, name: "Healthy Stock", quantity: "5.00", minimum_quantity: "2.00", unit: "kg" },
    ] });
    const room = await tx.room.create({ data: { id: randomUUID(), hotel_id: hotelId, room_number: "AD-101", room_type: "Deluxe", status: "active", capacity: 2, base_price: "100.00" } });
    await tx.room.create({ data: { id: randomUUID(), hotel_id: hotelId, room_number: "AD-102", status: "active", capacity: 2, base_price: "80.00" } });
    const booking = await tx.room_booking.create({ data: { id: randomUUID(), hotel_id: hotelId, room_id: room.id, booking_number: "AD-BK-001", customer_name: "Admin Guest", customer_phone: "100", adults: 1, children: 0, booking_from: new Date("2026-05-14T00:00:00Z"), booking_to: new Date("2026-05-16T00:00:00Z"), status: "checked-in", room_rate: "100.00", total_amount: "200.00", paid_amount: "0.00", payment_status: "pending" } });
    await tx.attendance.createMany({ data: [
      { id: randomUUID(), hotel_id: hotelId, user_id: actors.admin.userId, user_role_id: actors.admin.userRoleId, attendance_date: attendanceDate, status: "present", recorded_by: actors.admin.userId },
      { id: randomUUID(), hotel_id: hotelId, user_id: actors.inactive.userId, user_role_id: actors.inactive.userRoleId, attendance_date: attendanceDate, status: "present", recorded_by: actors.admin.userId },
    ] });
    const addOrder = ({ number, source, status, tableId = null, bookingId = null, offset }) => tx.orders.create({ data: {
      id: randomUUID(), hotel_id: hotelId, table_id: tableId, room_booking_id: bookingId, order_number: number, source, customer_name: "Dashboard Guest", customer_phone: "200", status, subtotal: "10.00", total_amount: "10.00", payment_status: "pending", created_at: new Date(currentTime.getTime() + offset),
      order_item: { create: { id: randomUUID(), menu_item_id: item.id, item_name: item.name, quantity: 1, unit_price: "10.00", subtotal: "10.00", status } },
    } });
    const completed = await addOrder({ number: "AD-ORD-001", source: "captain", status: "completed", tableId: tables[0].id, offset: 0 });
    await addOrder({ number: "AD-ORD-002", source: "dining_table_qr", status: "preparing", tableId: tables[1].id, offset: 1000 });
    await addOrder({ number: "AD-ORD-003", source: "room_qr", status: "pending", bookingId: booking.id, offset: 2000 });
    await addOrder({ number: "AD-ORD-IGNORED", source: "admin", status: "pending", offset: 3000 });
    let bill = await tx.bill.create({ data: { id: randomUUID(), hotel_id: hotelId, type: "CAPTAIN", order_id: completed.id, source_reference: completed.order_number, hotel_snapshot: {}, guest_snapshot: { name: "Admin Guest" }, subtotal: "150.00", taxable_subtotal: "150.00", total_amount: "150.00", amount_paid: "0.00", balance_due: "150.00", status: "DRAFT", created_by: actors.admin.userId, items: { create: { id: randomUUID(), position: 1, description: "Admin dashboard charge", quantity: 1, unit_price: "150.00", subtotal: "150.00", total_amount: "150.00" } } } });
    bill = await tx.bill.update({ where: { id: bill.id }, data: { status: "FINALIZED", finalized_by: actors.admin.userId, finalized_at: currentTime } });
    await tx.payment.create({ data: { id: randomUUID(), hotel_id: hotelId, bill_id: bill.id, amount: "50.00", method: "Cash", status: "RECORDED", idempotency_key: randomUUID(), created_at: new Date("2026-04-15T08:30:00Z"), created_by: actors.admin.userId } });
    await tx.payment.create({ data: { id: randomUUID(), hotel_id: hotelId, bill_id: bill.id, amount: "100.00", method: "Cash", status: "RECORDED", idempotency_key: randomUUID(), created_at: currentTime, created_by: actors.admin.userId } });

    const data = await getAdminDashboard(hotelId, now);
    check(data.hotel.name === "Admin Dashboard Hotel" && data.hotel.code === "HTL-990101", "assigned hotel identity remains available in the dashboard response");
    check(data.meta.timezone === "Asia/Kolkata" && data.meta.localDate === "2026-05-15", "hotel timezone drives dashboard date");
    check(data.metrics.monthCollections === "100.00" && data.metrics.previousMonthCollections === "50.00", "monthly recorded collections are correct");
    check(data.revenueOverview.values.length === 12 && data.revenueOverview.values[3] === 50 && data.revenueOverview.values[4] === 100, "calendar-year chart has twelve local-month buckets");
    check(data.revenueOverview.totalCollections === "150.00", "annual collections match persisted payments");
    check(data.metrics.totalOrders === 3 && data.metrics.activeOrders === 2 && data.metrics.preparingOrders === 1, "approved sources and active order statuses are correct");
    check(data.metrics.totalStaff === 3 && data.metrics.presentStaff === 1, "active hotel staff and present attendance are correct");
    check(data.metrics.totalTables === 2 && data.metrics.occupiedTables === 1, "table occupancy derives from active restaurant orders");
    check(data.metrics.menuItems === 1 && data.metrics.menuCategories === 1, "menu counts are hotel-scoped");
    check(data.metrics.activeVendors === 1 && data.metrics.inactiveVendors === 1, "vendor status totals are real");
    check(data.vendors[0].inventoryItemCount === 2, "vendor inventory relationship count is real");
    check(data.vendors[0].category === null && data.vendors[0].amount === null && data.vendors[0].reference === null, "unsupported vendor fields are not fabricated");
    check(data.roomBookings[0].bookingNumber === "AD-BK-001" && data.roomBookings[0].status === "checked-in", "booking snapshot includes real lifecycle status");
    check(data.operationalSnapshot.occupiedRooms === 1 && data.operationalSnapshot.availableRooms === 1 && data.operationalSnapshot.occupancyPercent === 50, "occupancy uses distinct checked-in active rooms");
    check(data.operationalSnapshot.ordersToday === 3, "hotel-local orders today excludes unsupported sources");
    check(data.operationalSnapshot.lowStockCount === 1 && data.alerts.length === 1, "alerts derive only from real low stock");
    check(data.recentOrders[0].orderNumber === "AD-ORD-003" && data.recentOrders[1].orderNumber === "AD-ORD-002", "recent orders are newest first");
    check(data.recentOrders.every(order => !Object.hasOwn(order, "id")), "internal order UUIDs are not exposed");
    check(data.staffActivity.length === 0 && data.operationalSnapshot.pendingApprovals === null, "unsupported sections return honest empty values");
    check(!JSON.stringify(data).includes("password_hash") && !JSON.stringify(data).includes("customer_phone"), "sensitive fields are not exposed");
    const emptyHotel = await getAdminDashboard(otherHotelId, now);
    check(emptyHotel.recentOrders.length === 0 && emptyHotel.vendors.length === 0 && emptyHotel.roomBookings.length === 0 && emptyHotel.alerts.length === 0, "empty hotel datasets remain empty without mock fallback rows");
    check(emptyHotel.revenueOverview.values.every(value => value === 0), "empty revenue periods return twelve zero buckets");
    check(!JSON.stringify(data).includes(otherHotelId), "cross-hotel identifiers are absent from the response DTO");

    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async ({ tenant = hotelId, token = tokens.admin, expected = 200 } = {}) => {
      const response = await fetch(`${origin}/api/hotels/${tenant}/admin/dashboard`, { headers: token ? { Cookie: `aazira_auth=${token}` } : {} });
      const body = await response.json(); assert.equal(response.status, expected, JSON.stringify(body)); return body;
    };
    check((await request()).data.metrics.totalOrders === 3, "authenticated Admin endpoint returns real hotel-scoped data");
    check((await request({ token: null, expected: 401 })).error.code === "UNAUTHENTICATED", "authentication is required");
    check((await request({ token: tokens.manager, expected: 403 })).error.code === "FORBIDDEN", "Manager is forbidden");
    check((await request({ token: tokens.reception, expected: 403 })).error.code === "FORBIDDEN", "Reception is forbidden");
    check((await request({ tenant: otherHotelId, expected: 403 })).error.code === "HOTEL_SCOPE_MISMATCH", "cross-hotel URL is rejected");
    check((await request({ tenant: "not-a-uuid", expected: 400 })).error.code === "INVALID_HOTEL_ID", "hotel UUID is validated");
    await assert.rejects(getAdminDashboard(randomUUID(), now), error => error.code === "HOTEL_NOT_FOUND" && error.statusCode === 404);
    results.push("nonexistent hotel follows HOTEL_NOT_FOUND convention");
    throw rollback;
  }, { timeout: 120000 });
} catch (error) { if (error !== rollback) throw error; }
finally {
  for (const [model, value] of Object.entries(saved)) prisma[model] = value;
  prisma.$transaction = originalTransaction;
  if (server) await new Promise(resolve => server.close(resolve));
  try { assert.deepEqual(await counts(), before, "Admin Dashboard fixtures were not fully rolled back"); }
  finally { await prisma.$disconnect(); }
}
console.log(`Admin Dashboard integration tests passed: ${results.length}/${results.length}`);
for (const result of results) console.log(`- ${result}`);
