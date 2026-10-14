// Explicit local-only integration test. Every temporary record is removed in finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";
import { deleteHotelFixtures } from "./helpers/hotelFixtureCleanup.js";

const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Local hms only");
const trackedModels = ["hotel", "users", "user_role", "dining_area", "dining_table", "orders", "order_item", "menu_item", "bill", "room_booking", "payment"];
const counts = async () => Object.fromEntries(await Promise.all(trackedModels.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const protectedInvoiceBefore = await prisma.bill.findUnique({ where: { invoice_number: "INV-000000000021" }, include: { payments: { orderBy: { created_at: "asc" } } } });
const hotelId = randomUUID();
const otherHotelId = randomUUID();
const userIds = [];
const results = [];
const pass = name => results.push(name);
let server;

try {
  await prisma.hotel.createMany({ data: [
  { id: hotelId, name: `Reception table test ${hotelId}`, status: "ACTIVE" },
  { id: otherHotelId, name: `Reception table isolation ${otherHotelId}`, status: "ACTIVE" },
  ].map(entitledHotelFixture) });
  const tokens = {};
  const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
  for (const roleName of ["Reception", "Admin", "Manager", "Captain", "Kitchen"]) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    const userId = randomUUID();
    const userRoleId = randomUUID();
    userIds.push(userId);
    await prisma.users.create({ data: { id: userId, email: `${userId}@table-status-test.invalid`, name: "Table status test", password_hash: passwordHash } });
    await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: role.id, hotel_id: hotelId } });
    tokens[roleName] = await createAuthenticationToken({ userId, userRoleId }, 600);
  }

  const area = await prisma.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Operational Floor", status: "active" } });
  const otherArea = await prisma.dining_area.create({ data: { id: randomUUID(), hotel_id: otherHotelId, name: "Other Hotel Floor", status: "active" } });
  const table = (number, status = "available") => prisma.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelId, dining_area_id: area.id, table_number: number, capacity: 4, status } });
  const tables = {
    none: await table("RT-NONE", "occupied"),
    pending: await table("RT-PENDING"),
    preparing: await table("RT-PREPARING", "reserved"),
    ready: await table("RT-READY"),
    completed: await table("RT-COMPLETED", "occupied"),
    roomService: await table("RT-ROOM", "occupied"),
    secondNone: await table("RT-SECOND"),
  };
  const otherTable = await prisma.dining_table.create({ data: { id: randomUUID(), hotel_id: otherHotelId, dining_area_id: otherArea.id, table_number: "RT-OTHER", capacity: 4, status: "available" } });
  const menuItem = await prisma.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Table status test item", price: "10.00" } });
  const otherMenuItem = await prisma.menu_item.create({ data: { id: randomUUID(), hotel_id: otherHotelId, name: "Other table test item", price: "10.00" } });
  const createOrder = async (ownerHotelId, tableId, source, status, itemId) => prisma.orders.create({ data: {
    id: randomUUID(), hotel_id: ownerHotelId, table_id: tableId, order_number: `RT-${randomUUID()}`, source,
    customer_name: "Private Test Guest", customer_phone: "9000000000", status, subtotal: "10.00", total_amount: "10.00", payment_status: "pending",
    completed_at: status === "completed" ? new Date() : null,
    order_item: { create: { id: randomUUID(), menu_item_id: itemId, item_name: "Table-status fixture item", quantity: 1, unit_price: "10.00", subtotal: "10.00", status } },
  } });
  const orders = {
    pending: await createOrder(hotelId, tables.pending.id, "captain", "pending", menuItem.id),
    preparing: await createOrder(hotelId, tables.preparing.id, "captain", "preparing", menuItem.id),
    ready: await createOrder(hotelId, tables.ready.id, "captain", "ready", menuItem.id),
    completed: await createOrder(hotelId, tables.completed.id, "captain", "completed", menuItem.id),
    roomService: await createOrder(hotelId, tables.roomService.id, "admin", "pending", menuItem.id),
    other: await createOrder(otherHotelId, otherTable.id, "captain", "pending", otherMenuItem.id),
  };
  const tableSnapshot = JSON.stringify(await prisma.dining_table.findMany({ where: { hotel_id: { in: [hotelId, otherHotelId] } }, orderBy: { id: "asc" } }));
  const orderSnapshot = JSON.stringify(await prisma.orders.findMany({ where: { id: { in: Object.values(orders).map(order => order.id) } }, orderBy: { id: "asc" } }));

  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (role = "Reception", tenant = hotelId) => {
    const response = await fetch(`${origin}/api/hotels/${tenant}/reception/table-status`, { headers: role ? { Cookie: `aazira_auth=${tokens[role] || "invalid"}` } : {} });
    return { status: response.status, body: await response.json() };
  };

  assert.equal((await request(null)).status, 401); pass("unauthenticated request denied");
  const reception = await request();
  assert.equal(reception.status, 200); pass("Reception request succeeds");
  assert.equal((await request("Admin")).status, 403); pass("Admin denied by Reception-only endpoint");
  assert.equal((await request("Manager")).status, 403); pass("Manager denied by Reception-only endpoint");
  assert.equal((await request("Captain")).status, 403); pass("Captain denied by Reception-only endpoint");
  assert.equal((await request("Kitchen")).status, 403); pass("Kitchen denied by Reception-only endpoint");
  assert.equal((await request("Reception", otherHotelId)).status, 403); pass("cross-hotel URL denied");

  const rows = reception.body.data.tables;
  const byNumber = new Map(rows.map(row => [row.tableNumber, row]));
  assert.equal(rows.length, 7); pass("only authenticated-hotel tables returned");
  assert.ok(!JSON.stringify(reception.body).includes("RT-OTHER") && !JSON.stringify(reception.body).includes(orders.other.id)); pass("other-hotel table and active order do not leak");
  assert.equal(byNumber.get("RT-NONE").effectiveStatus, "available"); pass("table without active Captain order is available despite stale persisted status");
  assert.equal(byNumber.get("RT-PENDING").effectiveStatus, "occupied"); pass("pending Captain order occupies table");
  assert.equal(byNumber.get("RT-PREPARING").effectiveStatus, "occupied"); pass("preparing Captain order occupies table");
  assert.equal(byNumber.get("RT-READY").effectiveStatus, "occupied"); pass("ready Captain order occupies table");
  assert.equal(byNumber.get("RT-COMPLETED").effectiveStatus, "available"); pass("completed Captain order is historical and does not occupy table");
  assert.equal(byNumber.get("RT-ROOM").effectiveStatus, "available"); pass("non-restaurant source does not occupy dining table");
  assert.equal(byNumber.get("RT-SECOND").effectiveStatus, "available"); pass("independent table without order remains available");
  assert.equal(rows.filter(row => row.effectiveStatus === "occupied").length, 3); pass("multiple active orders map independently to their tables");
  assert.equal(byNumber.get("RT-PENDING").activeOrder.status, "pending");
  assert.equal(byNumber.get("RT-PENDING").activeOrder.id, orders.pending.id); pass("occupied table includes authoritative active order metadata");
  assert.equal(byNumber.get("RT-COMPLETED").activeOrder, null); pass("historical order metadata is not exposed as active");
  assert.ok(rows.every(row => row.area.id === area.id && row.area.name === area.name)); pass("area identity comes from PostgreSQL relationship");
  assert.ok(!Object.hasOwn(byNumber.get("RT-PENDING").activeOrder, "customer_name") && !JSON.stringify(reception.body).includes("Private Test Guest")); pass("unnecessary customer information is not exposed");
  assert.ok(rows.every(row => ["available", "occupied"].includes(row.effectiveStatus))); pass("no unsupported reserved state is fabricated");

  assert.equal(JSON.stringify(await prisma.dining_table.findMany({ where: { hotel_id: { in: [hotelId, otherHotelId] } }, orderBy: { id: "asc" } })), tableSnapshot); pass("endpoint leaves dining-table records unchanged");
  assert.equal(JSON.stringify(await prisma.orders.findMany({ where: { id: { in: Object.values(orders).map(order => order.id) } }, orderBy: { id: "asc" } })), orderSnapshot); pass("endpoint leaves orders and statuses unchanged");
  assert.deepEqual(await prisma.bill.findUnique({ where: { invoice_number: "INV-000000000021" }, include: { payments: { orderBy: { created_at: "asc" } } } }), protectedInvoiceBefore); pass("billing, payment, and booking records remain unchanged");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma.orders.deleteMany({ where: { hotel_id: { in: [hotelId, otherHotelId] } } });
  await prisma.users.deleteMany({ where: { id: { in: userIds } } });
  await deleteHotelFixtures([hotelId, otherHotelId]);
  const after = await counts();
  assert.deepEqual(after, before);
  assert.deepEqual(await prisma.bill.findUnique({ where: { invoice_number: "INV-000000000021" }, include: { payments: { orderBy: { created_at: "asc" } } } }), protectedInvoiceBefore);
  console.log(JSON.stringify({ checks: results.length, results, countsBeforeAndAfter: after, cleanup: "All Reception Table Status fixtures removed.", protectedFinancialRecords: "unchanged" }));
  await prisma.$disconnect();
}
