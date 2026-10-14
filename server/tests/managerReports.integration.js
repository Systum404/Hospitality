// Explicit local-only, rollback-only Manager Reports integration test.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { getManagerReport } from "../services/managerReportsService.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";

const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Manager Reports tests are local hms only");

const models = ["hotel", "users", "user_role", "room", "room_booking", "dining_area", "dining_table", "menu_category", "menu_item", "orders", "order_item", "bill", "bill_item", "payment"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const originalTransaction = prisma.$transaction.bind(prisma);
const saved = {};
const rollback = new Error("ROLLBACK_MANAGER_REPORTS_FIXTURES");
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

    const hotelId = randomUUID();
    const otherHotelId = randomUUID();
    await tx.hotel.createMany({ data: [
    { id: hotelId, name: "Manager Reports hotel", status: "ACTIVE", timezone: "Asia/Kolkata" },
    { id: otherHotelId, name: "Manager Reports other hotel", status: "ACTIVE", timezone: "America/New_York" },
    ].map(entitledHotelFixture) });
    const roles = Object.fromEntries(await Promise.all(["Manager", "Reception"].map(async name => [name, await tx.role.findUniqueOrThrow({ where: { name } })])));
    const actors = {};
    const tokens = {};
    for (const [key, role, tenant] of [["manager", "Manager", hotelId], ["otherManager", "Manager", otherHotelId], ["reception", "Reception", hotelId]]) {
      const userId = randomUUID();
      const userRoleId = randomUUID();
      await tx.users.create({ data: { id: userId, name: `${key} report actor`, email: `${userId}@manager-reports.invalid`, password_hash: "not-a-login-secret" } });
      await tx.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: roles[role].id, hotel_id: tenant } });
      actors[key] = { userId, userRoleId };
      tokens[key] = await createAuthenticationToken({ userId, userRoleId }, 600);
    }

    const area = await tx.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Reports Area", status: "active" } });
    const table = await tx.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelId, dining_area_id: area.id, table_number: "REPORT-1", capacity: 4, status: "available" } });
    const otherArea = await tx.dining_area.create({ data: { id: randomUUID(), hotel_id: otherHotelId, name: "Foreign Reports Area", status: "active" } });
    const otherTable = await tx.dining_table.create({ data: { id: randomUUID(), hotel_id: otherHotelId, dining_area_id: otherArea.id, table_number: "REPORT-FOREIGN", capacity: 4, status: "available" } });
    const room = await tx.room.create({ data: { id: randomUUID(), hotel_id: hotelId, room_number: "REPORT-ROOM", status: "active", capacity: 2, base_price: "100.00" } });
    const draftRoom = await tx.room.create({ data: { id: randomUUID(), hotel_id: hotelId, room_number: "REPORT-DRAFT", status: "active", capacity: 2, base_price: "100.00" } });
    const booking = await tx.room_booking.create({ data: {
      id: randomUUID(), hotel_id: hotelId, room_id: room.id, booking_number: `REPORT-BK-${randomUUID()}`,
      customer_name: "Report Guest", customer_phone: "100", booking_from: new Date("2026-03-17T00:00:00.000Z"), booking_to: new Date("2026-03-20T00:00:00.000Z"),
      status: "checked-out", room_rate: "100.00", total_amount: "300.00", paid_amount: "0.00", payment_status: "pending",
    } });
    const draftBooking = await tx.room_booking.create({ data: {
      id: randomUUID(), hotel_id: hotelId, room_id: draftRoom.id, booking_number: `REPORT-DRAFT-${randomUUID()}`,
      customer_name: "Draft Guest", customer_phone: "101", booking_from: new Date("2026-03-17T00:00:00.000Z"), booking_to: new Date("2026-03-20T00:00:00.000Z"),
      status: "checked-out", room_rate: "100.00", total_amount: "300.00", paid_amount: "0.00", payment_status: "pending",
    } });
    const category = await tx.menu_category.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Report Category", display_order: 1 } });
    const mappedItem = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelId, category_id: category.id, name: "Historical Report Item", price: "100.00" } });
    const uncategorizedItem = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Uncategorized Report Item", price: "25.00" } });
    const otherItem = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: otherHotelId, name: "Foreign Report Item", price: "999.00" } });

    // The local test adapter writes JS Date wall-clock fields into PostgreSQL's configured session timezone.
    const todayAt = new Date("2026-03-18T10:00:00.000Z");
    const yesterdayAt = new Date("2026-03-17T10:00:00.000Z");
    const localDayStart = new Date("2026-03-18T00:00:00.000Z");
    const tomorrowAt = new Date("2026-03-19T00:00:00.000Z");
    let serial = 0;
    const addOrder = ({ tenant = hotelId, source, status, at, item = mappedItem, quantity = 1, extraItem = false }) => tx.orders.create({ data: {
      id: randomUUID(), hotel_id: tenant, table_id: source === "room_qr" ? null : table.id, room_booking_id: source === "room_qr" ? booking.id : null,
      order_number: `REPORT-ORDER-${++serial}-${randomUUID().slice(0, 8)}`, source, captain_id: source === "captain" ? actors.manager.userId : null,
      customer_name: "Private Report Guest", customer_phone: "9999999999", customer_email: "private@example.invalid",
      status, subtotal: `${quantity * 100 + (extraItem ? 25 : 0)}.00`, total_amount: `${quantity * 100 + (extraItem ? 25 : 0)}.00`, payment_status: "pending", created_at: at,
      order_item: { create: [
        { id: randomUUID(), menu_item_id: item.id, item_name: item.name, quantity, unit_price: "100.00", subtotal: `${quantity * 100}.00`, status },
        ...(extraItem ? [{ id: randomUUID(), menu_item_id: uncategorizedItem.id, item_name: "Persisted uncategorized snapshot", quantity: 1, unit_price: "25.00", subtotal: "25.00", status }] : []),
      ] },
    } });
    const roomOrder = await addOrder({ source: "room_qr", status: "completed", at: todayAt, quantity: 2 });
    const captainOrder = await addOrder({ source: "captain", status: "pending", at: todayAt });
    const restaurantCompleted = await addOrder({ source: "dining_table_qr", status: "completed", at: todayAt, quantity: 3, extraItem: true });
    await addOrder({ source: "captain", status: "pending", at: localDayStart });
    await addOrder({ source: "room_qr", status: "completed", at: yesterdayAt });
    const yesterdayCaptainOrder = await addOrder({ source: "captain", status: "completed", at: yesterdayAt });
    await addOrder({ source: "captain", status: "pending", at: tomorrowAt });
    await tx.orders.create({ data: { id: randomUUID(), hotel_id: hotelId, order_number: `REPORT-ADMIN-${randomUUID().slice(0, 8)}`, source: "admin", customer_name: "Excluded", customer_phone: "1", status: "completed", subtotal: "1000.00", total_amount: "1000.00", payment_status: "pending", created_at: todayAt, order_item: { create: { id: randomUUID(), menu_item_id: mappedItem.id, item_name: mappedItem.name, quantity: 10, unit_price: "100.00", subtotal: "1000.00", status: "completed" } } } });
    await tx.orders.create({ data: { id: randomUUID(), hotel_id: otherHotelId, order_number: `REPORT-FOREIGN-${randomUUID().slice(0, 8)}`, source: "captain", customer_name: "Foreign", customer_phone: "2", status: "completed", subtotal: "999.00", total_amount: "999.00", payment_status: "pending", created_at: todayAt, order_item: { create: { id: randomUUID(), menu_item_id: otherItem.id, item_name: otherItem.name, quantity: 1, unit_price: "999.00", subtotal: "999.00", status: "completed" } } } });
    const createOtherBoundaryOrder = async suffix => tx.orders.create({ data: {
      id: randomUUID(), hotel_id: otherHotelId, table_id: otherTable.id, order_number: `REPORT-NY-${suffix}-${randomUUID().slice(0, 8)}`,
      source: "captain", captain_id: actors.otherManager.userId, customer_name: "Timezone Guest", customer_phone: "3",
      status: "pending", subtotal: "10.00", total_amount: "10.00", payment_status: "pending",
    } });
    const otherStartOrder = await createOtherBoundaryOrder("START");
    const otherEndOrder = await createOtherBoundaryOrder("END");
    await tx.$executeRaw`UPDATE orders SET created_at = timezone('America/New_York', '2026-03-18'::date::timestamp) WHERE id = ${otherStartOrder.id}::uuid`;
    await tx.$executeRaw`UPDATE orders SET created_at = timezone('America/New_York', '2026-03-19'::date::timestamp) WHERE id = ${otherEndOrder.id}::uuid`;

    const addBill = async ({ type, orderId = null, bookingId = null, total, status, at }) => {
      let bill = await tx.bill.create({ data: {
        id: randomUUID(), hotel_id: hotelId, type, order_id: orderId, room_booking_id: bookingId,
        source_reference: `REPORT-SOURCE-${randomUUID()}`, hotel_snapshot: {}, guest_snapshot: { name: "Snapshot Guest" },
        subtotal: total, taxable_subtotal: total, total_amount: total, amount_paid: "0.00", balance_due: total, status: "DRAFT", created_by: actors.manager.userId, created_at: at,
        items: { create: { id: randomUUID(), position: 1, description: "Report charge", quantity: 1, unit_price: total, subtotal: total, total_amount: total } },
      } });
      if (status === "DRAFT") return bill;
      if (status === "VOID") return tx.bill.update({ where: { id: bill.id }, data: { status: "VOID", voided_by: actors.manager.userId, voided_at: at } });
      return tx.bill.update({ where: { id: bill.id }, data: { status: "FINALIZED", finalized_by: actors.manager.userId, finalized_at: at } });
    };
    const roomBill = await addBill({ type: "ROOM", bookingId: booking.id, total: "500.00", status: "FINALIZED", at: todayAt });
    const captainBill = await addBill({ type: "CAPTAIN", orderId: restaurantCompleted.id, total: "300.00", status: "FINALIZED", at: todayAt });
    await addBill({ type: "CAPTAIN", orderId: captainOrder.id, total: "999.00", status: "VOID", at: todayAt });
    await addBill({ type: "ROOM", bookingId: draftBooking.id, total: "100.00", status: "DRAFT", at: todayAt });
    const yesterdayBill = await addBill({ type: "CAPTAIN", orderId: yesterdayCaptainOrder.id, total: "100.00", status: "FINALIZED", at: yesterdayAt });
    const pay = (billId, amount, at) => tx.payment.create({ data: { id: randomUUID(), hotel_id: hotelId, bill_id: billId, amount, method: "Cash", idempotency_key: randomUUID(), created_at: at, created_by: actors.manager.userId } });
    await pay(roomBill.id, "200.00", todayAt);
    await pay(roomBill.id, "100.00", todayAt);
    await pay(captainBill.id, "50.00", todayAt);
    await pay(yesterdayBill.id, "100.00", yesterdayAt);

    const now = new Date("2026-03-18T12:00:00.000Z");
    const report = await getManagerReport(hotelId, "today", now);
    check(report.meta.timezone === "Asia/Kolkata" && report.meta.from === "2026-03-18" && report.meta.to === "2026-03-18", "today uses the hotel-local calendar date");
    check(report.summary.collections === "350.00", "recorded multiple payments drive collections");
    check(
      report.summary.orders === 4 && report.orderBreakdown.roomService === 1 && report.orderBreakdown.restaurant === 3,
      "only Manager-relevant sources are counted and split correctly",
    );
    check(report.summary.activeOrders === 2 && report.summary.completedOrders === 2, "active and completed order statuses follow the established contract");
    check(report.summary.averageBill === "400.00", "average bill uses finalized and partially paid non-void bills only");
    check(report.summary.outstanding === "550.00", "outstanding includes current non-void bill balances");
    check(report.billingBreakdown.room.count === 2 && report.billingBreakdown.restaurant.count === 1, "ROOM and CAPTAIN billing are reported separately");
    check(report.topItems[0].name === mappedItem.name && report.topItems[0].quantity === 5 && report.topItems[0].subtotal === "500.00", "completed order items use persisted names and aggregate quantity/subtotal");
    check(report.categories.length === 1 && report.categories[0].name === category.name && report.categories[0].percentage === 100, "category distribution uses resolvable persisted relationships");
    check(report.meta.categoryCoverage.categorizedQuantity === 5 && report.meta.categoryCoverage.unresolvedQuantity === 1, "unresolved historical categories are omitted safely and disclosed");
    check(
      report.trend.length === 24 && report.trend.find(bucket => bucket.label === "10:00")?.collections === "350.00",
      "today returns explicit zero-filled hourly buckets",
    );
    check(report.trend.find(bucket => bucket.label === "00:00")?.orders === 1, "hotel-local midnight is included in the first hourly bucket");
    check(report.summary.comparisons.collections === 250 && report.summary.comparisons.orders === 100, "today comparisons use yesterday and avoid arbitrary trends");
    check(!JSON.stringify(report).includes("private@example.invalid") && !JSON.stringify(report).includes("9999999999"), "customer PII is not exposed");

    const yesterday = await getManagerReport(hotelId, "yesterday", now);
    check(yesterday.meta.from === "2026-03-17" && yesterday.summary.orders === 2 && yesterday.trend.length === 24, "yesterday uses the previous hotel-local day with hourly buckets");
    const week = await getManagerReport(hotelId, "week", now);
    check(week.meta.from === "2026-03-16" && week.meta.to === "2026-03-22" && week.trend.length === 7, "week uses Monday through Sunday with daily buckets");
    const month = await getManagerReport(hotelId, "month", now);
    check(month.meta.from === "2026-03-01" && month.meta.to === "2026-03-31" && month.trend.length === 31, "month uses the full calendar month with daily buckets");
    const year = await getManagerReport(hotelId, "year", now);
    check(year.meta.from === "2026-01-01" && year.meta.to === "2026-12-31" && year.trend.length === 12, "year uses January through December with monthly buckets");
    const newYork = await getManagerReport(otherHotelId, "today", now);
    check(newYork.meta.timezone === "America/New_York" && newYork.summary.orders === 2, "a different hotel timezone includes its local start boundary and excludes the next local midnight");
    check(newYork.trend.find(bucket => bucket.label === "00:00")?.orders === 2, "hourly buckets use each hotel's own IANA timezone");
    const empty = await getManagerReport(hotelId, "today", new Date("2025-02-10T12:00:00.000Z"));
    check(empty.summary.collections === "0.00" && empty.summary.orders === 0 && empty.summary.averageBill === "0.00" && empty.topItems.length === 0 && empty.categories.length === 0, "empty periods return safe zeros and empty analytics");
    check(JSON.stringify(empty.summary.comparisons).includes("null") || Object.values(empty.summary.comparisons).every(value => Number.isFinite(value)), "comparisons never contain NaN or Infinity");

    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async ({ tenant = hotelId, token = tokens.manager, range = "today", expected = 200 } = {}) => {
      const response = await fetch(`${origin}/api/hotels/${tenant}/manager/reports?range=${range}`, { headers: token ? { Cookie: `aazira_auth=${token}` } : {} });
      const body = await response.json();
      assert.equal(response.status, expected, JSON.stringify(body));
      return body;
    };
    const apiReport = await request();
    check(apiReport.status === "success" && apiReport.report.meta.range === "today", "authenticated Manager can read the own-hotel report endpoint");
    check((await request({ token: null, expected: 401 })).error.code === "UNAUTHENTICATED", "authentication is required");
    check((await request({ token: tokens.reception, expected: 403 })).error.code === "FORBIDDEN", "non-Manager roles are rejected");
    check((await request({ tenant: otherHotelId, expected: 403 })).error.code === "HOTEL_SCOPE_MISMATCH", "cross-hotel report access is rejected");
    check((await request({ tenant: "not-a-uuid", expected: 400 })).error.code === "INVALID_HOTEL_ID", "hotel UUID is validated before scope");
    check((await request({ range: "custom-sql", expected: 400 })).error.code === "INVALID_REPORT_RANGE", "range is allow-list validated");
    check(!JSON.stringify(apiReport).includes(roomOrder.id) && !JSON.stringify(apiReport).includes(actors.manager.userId), "internal order and user UUIDs are not exposed");

    throw rollback;
  }, { timeout: 120000 });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  for (const [name, value] of Object.entries(saved)) prisma[name] = value;
  prisma.$transaction = originalTransaction;
  if (server) await new Promise(resolve => server.close(resolve));
  try {
    assert.deepEqual(await counts(), before, "Manager Reports fixtures were not fully rolled back");
    console.log(JSON.stringify({ checks: results.length, countsBeforeAndAfter: before, cleanup: "All Manager Reports fixtures rolled back." }));
  } finally {
    await prisma.$disconnect();
  }
}

console.log(`Manager Reports integration tests passed: ${results.length}/${results.length}`);
for (const result of results) console.log(`- ${result}`);
