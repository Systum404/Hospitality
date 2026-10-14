// Explicit local-only, rollback-only Hotel Admin Reports integration test.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { app } from "../app.js";
import { ASSIGNMENT_STATUSES } from "../config/roles.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";

const database = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && database.pathname === "/hms", "Hotel Admin Reports tests are local hms only");

const models = ["hotel", "users", "user_role", "room", "room_booking", "dining_area", "dining_table", "menu_category", "menu_item", "orders", "order_item", "bill", "bill_item", "payment"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const originalTransaction = prisma.$transaction.bind(prisma);
const saved = {};
const rollback = new Error("ROLLBACK_ADMIN_REPORTS_FIXTURES");
const results = [];
const check = (condition, message) => { assert.ok(condition, message); results.push(message); };
let server;

try {
  await originalTransaction(async tx => {
    for (const name of [...models, "$queryRaw"]) {
      saved[name] = prisma[name];
      prisma[name] = typeof tx[name] === "function" ? tx[name].bind(tx) : tx[name];
    }
    prisma.$transaction = work => work(tx);

    const hotelId = randomUUID(), emptyHotelId = randomUUID(), inactiveHotelId = randomUUID();
    await tx.hotel.createMany({ data: [
      { id: hotelId, name: "Admin Reports Hotel", code: "HTL-990201", status: "ACTIVE", timezone: "Asia/Kolkata" },
      { id: emptyHotelId, name: "Empty Admin Reports Hotel", code: "HTL-990202", status: "ACTIVE", timezone: "America/New_York" },
      { id: inactiveHotelId, name: "Inactive Admin Reports Hotel", code: "HTL-990203", status: "ACTIVE", timezone: "Asia/Kolkata" },
    ].map(entitledHotelFixture) });
    const roles = Object.fromEntries(await Promise.all(["Admin", "Manager", "Reception", "Captain", "Kitchen", "Super Admin"].map(async name => [name, await tx.role.findUniqueOrThrow({ where: { name } })])));
    const actors = {}, tokens = {};
    const addActor = async (key, roleName, tenant, { userActive = true, assignmentStatus = ASSIGNMENT_STATUSES.ACTIVE } = {}) => {
      const userId = randomUUID(), userRoleId = randomUUID();
      await tx.users.create({ data: { id: userId, name: `${key} report actor`, email: `${userId}@admin-reports.invalid`, password_hash: "not-a-login-secret", is_active: userActive } });
      const role = roles[roleName];
      await tx.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: role.id, role_scope: role.scope, hotel_id: role.scope === "COMPANY" ? null : tenant, status: assignmentStatus } });
      actors[key] = { userId, userRoleId };
      tokens[key] = await createAuthenticationToken({ userId, userRoleId }, 600);
    };
    await addActor("admin", "Admin", hotelId);
    await addActor("otherAdmin", "Admin", emptyHotelId);
    await addActor("inactiveHotelAdmin", "Admin", inactiveHotelId);
    await addActor("inactiveIdentity", "Admin", hotelId, { userActive: false });
    await addActor("inactiveAssignment", "Admin", hotelId, { assignmentStatus: ASSIGNMENT_STATUSES.INACTIVE });
    for (const [key, role] of [["manager", "Manager"], ["reception", "Reception"], ["captain", "Captain"], ["kitchen", "Kitchen"], ["superAdmin", "Super Admin"]]) await addActor(key, role, hotelId);
    await tx.hotel.update({ where: { id: inactiveHotelId }, data: { status: "INACTIVE" } });

    const area = await tx.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Admin Reports Area", status: "active" } });
    const table = await tx.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelId, dining_area_id: area.id, table_number: "AR-1", capacity: 4, status: "available" } });
    const category = await tx.menu_category.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Admin Reports Category", display_order: 1 } });
    const item = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelId, category_id: category.id, name: "Admin Reports Item", price: "50.00" } });
    const room = await tx.room.create({ data: { id: randomUUID(), hotel_id: hotelId, room_number: "AR-101", status: "active", capacity: 2, base_price: "100.00" } });
    const booking = await tx.room_booking.create({ data: { id: randomUUID(), hotel_id: hotelId, room_id: room.id, booking_number: `AR-BK-${randomUUID()}`, customer_name: "Admin Reports Guest", customer_phone: "100", booking_from: new Date("2026-09-26T00:00:00Z"), booking_to: new Date("2026-09-28T00:00:00Z"), status: "checked-in", room_rate: "100.00", total_amount: "200.00", paid_amount: "0.00", payment_status: "pending" } });
    const now = new Date();
    const addOrder = async ({ source, status, quantity, bookingId = null }) => tx.orders.create({ data: {
      id: randomUUID(), hotel_id: hotelId, table_id: bookingId ? null : table.id, room_booking_id: bookingId,
      order_number: `AR-ORD-${randomUUID().slice(0, 8)}`, source, captain_id: source === "captain" ? actors.captain.userId : null,
      customer_name: "Report Customer", customer_phone: "200", status, subtotal: String(quantity * 50), total_amount: String(quantity * 50), payment_status: "pending", created_at: now,
      order_item: { create: { id: randomUUID(), menu_item_id: item.id, item_name: item.name, quantity, unit_price: "50.00", subtotal: String(quantity * 50), status } },
    } });
    const roomOrder = await addOrder({ source: "room_qr", status: "completed", quantity: 2, bookingId: booking.id });
    await addOrder({ source: "captain", status: "pending", quantity: 1 });
    const restaurantOrder = await addOrder({ source: "dining_table_qr", status: "completed", quantity: 1 });

    const addFinalizedBill = async ({ type, total, orderId = null, bookingId = null }) => {
      const bill = await tx.bill.create({ data: { id: randomUUID(), hotel_id: hotelId, type, order_id: orderId, room_booking_id: bookingId, source_reference: `AR-SOURCE-${randomUUID()}`, hotel_snapshot: {}, guest_snapshot: { name: "Report Guest" }, subtotal: total, taxable_subtotal: total, total_amount: total, amount_paid: "0.00", balance_due: total, status: "DRAFT", created_by: actors.admin.userId, created_at: now, items: { create: { id: randomUUID(), position: 1, description: "Report charge", quantity: 1, unit_price: total, subtotal: total, total_amount: total } } } });
      return tx.bill.update({ where: { id: bill.id }, data: { status: "FINALIZED", finalized_by: actors.admin.userId, finalized_at: now } });
    };
    const roomBill = await addFinalizedBill({ type: "ROOM", total: "200.00", bookingId: booking.id });
    const restaurantBill = await addFinalizedBill({ type: "CAPTAIN", total: "100.00", orderId: restaurantOrder.id });
    await tx.payment.createMany({ data: [
      { id: randomUUID(), hotel_id: hotelId, bill_id: roomBill.id, amount: "80.00", method: "Cash", idempotency_key: randomUUID(), created_at: now, created_by: actors.admin.userId },
      { id: randomUUID(), hotel_id: hotelId, bill_id: restaurantBill.id, amount: "20.00", method: "UPI", idempotency_key: randomUUID(), created_at: now, created_by: actors.admin.userId },
    ] });

    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async ({ tenant = hotelId, token = tokens.admin, range = "today", expected = 200 } = {}) => {
      const response = await fetch(`${origin}/api/hotels/${tenant}/admin/reports?range=${range}`, { headers: token ? { Cookie: `aazira_auth=${token}` } : {} });
      const body = await response.json();
      assert.equal(response.status, expected, JSON.stringify(body));
      return body;
    };

    const payload = await request();
    const report = payload.report;
    check(payload.status === "success" && report.meta.range === "today", "Hotel Admin can access the own-hotel report");
    check(report.meta.timezone === "Asia/Kolkata", "report uses the assigned hotel's IANA timezone");
    check(report.summary.collections === "100.00", "collections use recorded persisted payments");
    check(report.summary.orders === 3, "orders use the established operational sources");
    check(report.summary.averageBill === "150.00", "average bill uses the established finalized bill population");
    check(report.summary.outstanding === "200.00", "outstanding uses positive non-void balances");
    check(report.summary.activeOrders === 1 && report.summary.completedOrders === 2, "order lifecycle breakdown is correct");
    check(report.orderBreakdown.roomService === 1 && report.orderBreakdown.restaurant === 2, "order source breakdown is correct");
    check(report.billingBreakdown.room.count === 1 && report.billingBreakdown.room.total === "200.00", "room billing breakdown is correct");
    check(report.billingBreakdown.restaurant.count === 1 && report.billingBreakdown.restaurant.total === "100.00", "restaurant billing breakdown is correct");
    check(report.trend.some(bucket => bucket.collections === "100.00" && bucket.orders === 3), "timezone-aware trend contains the persisted period activity");
    check(report.topItems[0].name === item.name && report.topItems[0].quantity === 3 && report.topItems[0].subtotal === "150.00", "top items use completed persisted order items");
    check(report.categories.length === 1 && report.categories[0].name === category.name && report.categories[0].percentage === 100, "category distribution uses the established calculation");
    check((await request({ range: "week" })).report.meta.range === "week", "established date ranges are accepted");
    const empty = await request({ tenant: emptyHotelId, token: tokens.otherAdmin });
    check(empty.report.summary.collections === "0.00" && empty.report.summary.orders === 0 && empty.report.topItems.length === 0, "empty hotels return safe zero and empty results");
    check((await request({ token: null, expected: 401 })).error.code === "UNAUTHENTICATED", "authentication is required");
    for (const role of ["manager", "reception", "captain", "kitchen", "superAdmin"]) check((await request({ token: tokens[role], expected: 403 })).error.code === (role === "superAdmin" ? "HOTEL_SCOPE_REQUIRED" : "FORBIDDEN"), `${role} cannot access Hotel Admin reports`);
    check((await request({ tenant: emptyHotelId, expected: 403 })).error.code === "HOTEL_SCOPE_MISMATCH", "cross-hotel URL access is rejected");
    check((await request({ tenant: "not-a-uuid", expected: 400 })).error.code === "INVALID_HOTEL_ID", "hotel UUID is validated before scope");
    check((await request({ range: "custom", expected: 400 })).error.code === "INVALID_REPORT_RANGE", "range is allow-list validated");
    check((await request({ token: tokens.inactiveIdentity, expected: 401 })).error.code === "UNAUTHENTICATED", "inactive identity is rejected");
    check((await request({ token: tokens.inactiveAssignment, expected: 401 })).error.code === "UNAUTHENTICATED", "inactive assignment is rejected");
    check((await request({ tenant: inactiveHotelId, token: tokens.inactiveHotelAdmin, expected: 403 })).error.code === "HOTEL_INACTIVE", "inactive hotel is rejected");
    check(!JSON.stringify(report).includes(actors.admin.userId) && !JSON.stringify(report).includes(roomOrder.id) && !JSON.stringify(report).includes("password"), "report does not expose internal actor/order IDs or credential fields");

    throw rollback;
  }, { timeout: 120000 });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  for (const [name, value] of Object.entries(saved)) prisma[name] = value;
  prisma.$transaction = originalTransaction;
  if (server) await new Promise(resolve => server.close(resolve));
  try {
    assert.deepEqual(await counts(), before, "Hotel Admin Reports fixtures were not fully rolled back");
    console.log(JSON.stringify({ checks: results.length, countsBeforeAndAfter: before, cleanup: "All Hotel Admin Reports fixtures rolled back." }));
  } finally {
    await prisma.$disconnect();
  }
}

console.log(`Hotel Admin Reports integration tests passed: ${results.length}/${results.length}`);
for (const result of results) console.log(`- ${result}`);
