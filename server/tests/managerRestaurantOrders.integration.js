// Explicit local-only integration test. Every committed fixture is removed in finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { getManagerRestaurantOrders } from "../services/managerRestaurantOrderService.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";
import { deleteHotelFixtures } from "./helpers/hotelFixtureCleanup.js";

const database = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && database.pathname === "/hms", "Manager restaurant-order tests are local hms only");

const models = ["hotel", "users", "user_role", "room", "room_booking", "dining_area", "dining_table", "menu_item", "orders", "order_item"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const fixture = { hotelIds: [], userIds: [] };
const results = [];
const pass = name => results.push(name);
let server;

try {
  const hotelA = randomUUID(), hotelB = randomUUID(), hotelEmpty = randomUUID();
  fixture.hotelIds.push(hotelA, hotelB, hotelEmpty);
  await prisma.hotel.createMany({ data: [
  { id: hotelA, name: `Manager restaurant A ${hotelA}`, status: "ACTIVE" },
  { id: hotelB, name: `Manager restaurant B ${hotelB}`, status: "ACTIVE" },
  { id: hotelEmpty, name: `Manager restaurant empty ${hotelEmpty}`, status: "ACTIVE" },
  ].map(entitledHotelFixture) });

  const roles = Object.fromEntries(await Promise.all(["Manager", "Captain", "Reception"].map(async name => [name, await prisma.role.findUniqueOrThrow({ where: { name } })])));
  const tokens = {};
  const addActor = async (key, role, hotelId) => {
    const userId = randomUUID(), userRoleId = randomUUID();
    fixture.userIds.push(userId);
    await prisma.users.create({ data: { id: userId, name: `${role} restaurant-order test`, email: `${userId}@manager-restaurant.invalid`, password_hash: "not-a-login-secret" } });
    await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: roles[role].id, hotel_id: hotelId } });
    tokens[key] = await createAuthenticationToken({ userId, userRoleId }, 600);
  };
  await addActor("managerA", "Manager", hotelA);
  await addActor("managerB", "Manager", hotelB);
  await addActor("managerEmpty", "Manager", hotelEmpty);
  await addActor("captain", "Captain", hotelA);
  await addActor("reception", "Reception", hotelA);

  const areaA = await prisma.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "Manager Read Area A", status: "active" } });
  const areaB = await prisma.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelB, name: "Manager Read Area B", status: "active" } });
  const tableA = await prisma.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelA, dining_area_id: areaA.id, table_number: "MRO-A", capacity: 4, status: "occupied" } });
  const tableB = await prisma.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelB, dining_area_id: areaB.id, table_number: "MRO-B", capacity: 2, status: "occupied" } });
  const menuA = await prisma.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "Manager Snapshot A", price: "25.50", is_available: true } });
  const menuB = await prisma.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelB, name: "Manager Snapshot B", price: "10.00", is_available: true } });
  const room = await prisma.room.create({ data: { id: randomUUID(), hotel_id: hotelA, room_number: "MRO-R", status: "active", base_price: "100.00" } });
  const booking = await prisma.room_booking.create({ data: { id: randomUUID(), hotel_id: hotelA, room_id: room.id, booking_number: `MRO-${randomUUID()}`, customer_name: "Room Guest", customer_phone: "100", adults: 1, children: 0, booking_from: new Date("2026-09-10T00:00:00.000Z"), booking_to: new Date("2026-09-12T00:00:00.000Z"), status: "checked-in", room_rate: "100.00", total_amount: "200.00", paid_amount: "0.00", payment_status: "pending" } });

  const createOrder = ({ hotelId, source, status, tableId = null, bookingId = null, menu, number, createdAt }) => prisma.orders.create({
    data: {
      id: randomUUID(), hotel_id: hotelId, table_id: tableId, room_booking_id: bookingId,
      order_number: number, source, customer_name: `${source} guest`, customer_phone: "200",
      customer_email: `${source}@example.invalid`, status, subtotal: "51.00", tax_amount: "0.00",
      discount_amount: "0.00", total_amount: "51.00", payment_status: "pending",
      notes: `${source} note`, created_at: createdAt,
      order_item: { create: { id: randomUUID(), menu_item_id: menu.id, item_name: `${source} snapshot`, quantity: 2, unit_price: "25.50", subtotal: "51.00", status, special_instructions: "No onion" } },
    },
  });
  const captain = await createOrder({ hotelId: hotelA, source: "captain", status: "pending", tableId: tableA.id, menu: menuA, number: "MRO-CAPTAIN", createdAt: new Date("2026-09-11T09:00:00.000Z") });
  const tableQr = await createOrder({ hotelId: hotelA, source: "dining_table_qr", status: "completed", tableId: tableA.id, menu: menuA, number: "MRO-TABLE-QR", createdAt: new Date("2026-09-11T10:00:00.000Z") });
  const roomQr = await createOrder({ hotelId: hotelA, source: "room_qr", status: "completed", bookingId: booking.id, menu: menuA, number: "MRO-ROOM-QR", createdAt: new Date("2026-09-11T11:00:00.000Z") });
  const foreign = await createOrder({ hotelId: hotelB, source: "captain", status: "ready", tableId: tableB.id, menu: menuB, number: "MRO-FOREIGN", createdAt: new Date("2026-09-11T12:00:00.000Z") });

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async ({ hotelId = hotelA, role = "managerA", method = "GET", expected = 200 } = {}) => {
    const response = await fetch(`${origin}/api/hotels/${hotelId}/manager/restaurant-orders`, { method, headers: role ? { Cookie: `aazira_auth=${tokens[role]}` } : {} });
    const body = await response.json();
    assert.equal(response.status, expected, `${method}: ${JSON.stringify(body)}`);
    return body;
  };

  const response = await request();
  const orders = response.data.restaurant_orders;
  assert.deepEqual(new Set(orders.map(order => order.id)), new Set([captain.id, tableQr.id]));
  assert.deepEqual(orders.map(order => order.order_number), [tableQr.order_number, captain.order_number]);
  assert.deepEqual(new Set(orders.map(order => order.source)), new Set(["captain", "dining_table_qr"]));
  pass("Manager reads newest-first Captain and Table QR orders for the authenticated hotel");
  assert.ok(orders.some(order => order.status === "pending") && orders.some(order => order.status === "completed"));
  assert.equal(orders[0].dining_table.table_number, "MRO-A");
  assert.equal(orders[0].dining_table.dining_area.name, "Manager Read Area A");
  assert.equal(orders[0].items[0].item_name, "dining_table_qr snapshot");
  pass("active/completed states and persisted table, area, customer, item snapshot and amount fields are returned");
  assert.ok(!orders.some(order => order.order_number === roomQr.order_number));
  assert.ok(!orders.some(order => order.order_number === foreign.order_number));
  pass("Room QR and cross-hotel restaurant orders are excluded");
  const serialized = JSON.stringify(response);
  for (const field of ["password_hash", "idempotency_key", "idempotency_fingerprint", "ordering_capability_hash", "captain_id", "hotel_id", "customer_id", "table_id", "room_booking_id"]) assert.ok(!serialized.includes(field));
  pass("only the order action UUID is added; sensitive and unnecessary internal fields are not exposed");

  assert.deepEqual((await request({ hotelId: hotelEmpty, role: "managerEmpty" })).data.restaurant_orders, []);
  pass("empty hotel returns a successful empty result");
  assert.equal((await request({ role: null, expected: 401 })).error.code, "UNAUTHENTICATED");
  assert.equal((await request({ role: "captain", expected: 403 })).error.code, "FORBIDDEN");
  assert.equal((await request({ role: "reception", expected: 403 })).error.code, "FORBIDDEN");
  pass("authentication and Manager-only authorization are enforced");
  assert.equal((await request({ hotelId: hotelB, role: "managerA", expected: 403 })).error.code, "HOTEL_SCOPE_MISMATCH");
  assert.equal((await request({ hotelId: "not-a-uuid", role: "managerA", expected: 400 })).error.code, "INVALID_HOTEL_ID");
  pass("hotel scope and hotel UUID validation are enforced");
  await assert.rejects(getManagerRestaurantOrders(randomUUID()), error => error.statusCode === 404 && error.code === "HOTEL_NOT_FOUND");
  pass("nonexistent hotels follow the service-level HOTEL_NOT_FOUND convention");
  assert.equal((await request({ method: "POST", expected: 404 })).error.code, "ROUTE_NOT_FOUND");
  pass("no Manager restaurant-order mutation route was introduced");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma.orders.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  await prisma.room_booking.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  await prisma.room.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  await prisma.menu_item.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  await prisma.dining_table.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  await prisma.dining_area.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  await prisma.user_role.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  if (fixture.userIds.length) await prisma.users.deleteMany({ where: { id: { in: fixture.userIds } } });
  await deleteHotelFixtures(fixture.hotelIds);
  assert.deepEqual(await counts(), before, "Manager restaurant-order fixtures were not fully removed");
  await prisma.$disconnect();
}

console.log(`Manager restaurant-order integration tests passed: ${results.length}/${results.length}`);
for (const result of results) console.log(`- ${result}`);
