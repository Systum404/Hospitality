// Explicit local-only integration test. Fixtures are isolated and removed in finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { Client } from "pg";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";
import { deleteHotelFixtures } from "./helpers/hotelFixtureCleanup.js";

const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Local hms only");

const models = ["hotel", "users", "user_role", "room", "room_booking", "menu_item", "orders", "order_item", "notification"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async (name) => [name, await prisma[name].count()])));
const before = await counts();
const existing = {
  bookings: await prisma.room_booking.findMany({ orderBy: { id: "asc" } }),
  orders: await prisma.orders.findMany({ orderBy: { id: "asc" }, include: { order_item: { orderBy: { id: "asc" } } } }),
};
const fixture = { hotelIds: [], userIds: [] };
const results = [];
const pass = (name) => results.push(name);
let server;

try {
  const hotelA = randomUUID();
  const hotelB = randomUUID();
  fixture.hotelIds.push(hotelA, hotelB);
  await prisma.hotel.createMany({ data: [
    { id: hotelA, name: `Room order test A ${hotelA}`, status: "ACTIVE", timezone: "Asia/Kolkata" },
    { id: hotelB, name: `Room order test B ${hotelB}`, status: "ACTIVE", timezone: "UTC" },
  ].map(entitledHotelFixture) });

  const roles = Object.fromEntries(await Promise.all(["Manager", "Admin", "Kitchen"].map(async (name) => [name, await prisma.role.findUniqueOrThrow({ where: { name } })])));
  const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
  const tokens = {};
  const addUser = async (role, hotelId) => {
    const userId = randomUUID();
    const userRoleId = randomUUID();
    fixture.userIds.push(userId);
    await prisma.users.create({ data: { id: userId, name: `${role} room-order test`, email: `${userId}@room-order-test.invalid`, password_hash: passwordHash } });
    await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: roles[role].id, hotel_id: hotelId } });
    tokens[`${role}:${hotelId}`] = await createAuthenticationToken({ userId, userRoleId }, 600);
  };
  await addUser("Manager", hotelA);
  await addUser("Manager", hotelB);
  await addUser("Admin", hotelA);
  await addUser("Kitchen", hotelA);

  const makeBooking = async (hotelId, status, label) => {
    const roomId = randomUUID();
    const bookingId = randomUUID();
    await prisma.room.create({ data: { id: roomId, hotel_id: hotelId, room_number: `RO-${label}-${randomUUID().slice(0, 6)}`, status: "active", capacity: 2, base_price: "100.00" } });
    await prisma.room_booking.create({ data: {
      id: bookingId,
      hotel_id: hotelId,
      room_id: roomId,
      booking_number: `RO-${label}-${randomUUID().slice(0, 8)}`,
      customer_name: `${label} Guest`,
      customer_phone: `test-${randomUUID().slice(0, 12)}`,
      adults: 1,
      children: 0,
      booking_from: new Date("2026-09-09T00:00:00.000Z"),
      booking_to: new Date("2026-09-11T00:00:00.000Z"),
      status,
      room_rate: "100.00",
      total_amount: "200.00",
      paid_amount: "0.00",
      payment_status: "pending",
      checked_in_at: status === "checked-in" ? new Date() : null,
      checked_out_at: status === "checked-out" ? new Date() : null,
    } });
    return await prisma.room_booking.findUniqueOrThrow({ where: { id: bookingId } });
  };

  const source = await makeBooking(hotelA, "checked-in", "SOURCE");
  const eligible = await makeBooking(hotelA, "checked-in", "ELIGIBLE");
  const ineligible = Object.fromEntries(await Promise.all(["reserved", "confirmed", "checked-out", "cancelled"].map(async (status) => [status, await makeBooking(hotelA, status, status.toUpperCase())])));
  const foreign = await makeBooking(hotelB, "checked-in", "FOREIGN");
  const menuItemId = randomUUID();
  await prisma.menu_item.create({ data: { id: menuItemId, hotel_id: hotelA, name: "Room-order regression meal", price: "10.00", is_available: true } });

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, hotelId, path, { body, role = "Manager", tokenHotel = hotelId, expected = 200 } = {}) => {
    const token = role ? tokens[`${role}:${tokenHotel}`] : null;
    const response = await fetch(`${origin}/api/hotels/${hotelId}${path}`, {
      method,
      headers: { ...(token ? { Cookie: `aazira_auth=${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
    return payload;
  };

  const createBody = (roomBookingId) => ({
    room_booking_id: roomBookingId,
    items: [{ menu_item_id: menuItemId, quantity: 1 }],
    status: "pending",
    payment_status: "pending",
    notes: "Room-order reassignment regression",
  });
  const created = (await request("POST", hotelA, "/room-orders", { body: createBody(source.id), expected: 201 })).data.room_order;
  assert.equal(created.room_booking_id, source.id);
  pass("existing checked-in CREATE behavior remains successful");

  const replacementOrder = (await request("POST", hotelA, "/room-orders", { body: createBody(source.id), expected: 201 })).data.room_order;
  const replaceItems = async (quantity) => (await request("PATCH", hotelA, `/room-orders/${replacementOrder.id}`, { body: { items: [{ menu_item_id: menuItemId, quantity }] } })).data.room_order;
  let replacement = await replaceItems(2);
  assert.ok(replacement.items.every((item) => item.status === "pending"));
  await request("PATCH", hotelA, `/room-orders/${replacementOrder.id}/status`, { body: { status: "preparing" } });
  replacement = await replaceItems(3);
  assert.ok(replacement.items.every((item) => item.status === "preparing"));
  await request("PATCH", hotelA, `/room-orders/${replacementOrder.id}/status`, { body: { status: "ready" } });
  replacement = await replaceItems(4);
  assert.ok(replacement.items.every((item) => item.status === "ready"));
  pass("item replacement inherits the locked effective order status at pending, preparing, and ready");

  const runConcurrentStatusAndReplacement = async ({ managerFirst, quantity }) => {
    const order = (await request("POST", hotelA, "/room-orders", { body: createBody(source.id), expected: 201 })).data.room_order;
    const connection = new Client({ connectionString: environment.databaseUrl });
    await connection.connect();
    try {
      await connection.query("BEGIN");
      await connection.query("SELECT id FROM orders WHERE id = $1 FOR UPDATE", [order.id]);
      const kitchenUpdate = () => request("PATCH", hotelA, `/kitchen/orders/${order.id}/status`, { role: "Kitchen", body: { status: "preparing" } });
      const managerUpdate = () => request("PATCH", hotelA, `/room-orders/${order.id}`, { body: { items: [{ menu_item_id: menuItemId, quantity }] } });
      const first = managerFirst ? managerUpdate() : kitchenUpdate();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const second = managerFirst ? kitchenUpdate() : managerUpdate();
      const state = await Promise.race([Promise.all([first, second]).then(() => "completed"), new Promise((resolve) => setTimeout(() => resolve("blocked"), 100))]);
      assert.equal(state, "blocked");
      await connection.query("COMMIT");
      await Promise.all([first, second]);
    } finally {
      await connection.query("ROLLBACK").catch(() => {});
      await connection.end();
    }
    const persistedOrder = await prisma.orders.findUniqueOrThrow({ where: { id: order.id }, include: { order_item: true } });
    assert.equal(persistedOrder.status, "preparing");
    assert.equal(persistedOrder.order_item.length, 1);
    assert.equal(persistedOrder.order_item[0].quantity, quantity);
    assert.equal(persistedOrder.order_item[0].status, "preparing");
  };

  await runConcurrentStatusAndReplacement({ managerFirst: false, quantity: 5 });
  pass("Kitchen-first concurrent status and Manager replacement serialize to matching preparing state");
  await runConcurrentStatusAndReplacement({ managerFirst: true, quantity: 6 });
  pass("Manager-first concurrent replacement and Kitchen status serialize to matching preparing state");

  const rejectedCreate = await request("POST", hotelA, "/room-orders", { body: createBody(ineligible.reserved.id), expected: 409 });
  assert.equal(rejectedCreate.error.code, "ROOM_BOOKING_NOT_CHECKED_IN");
  pass("existing CREATE behavior still rejects a non-checked-in booking");

  const orderState = () => prisma.orders.findUniqueOrThrow({ where: { id: created.id }, include: { order_item: { orderBy: { id: "asc" } } } });
  const original = await orderState();
  for (const status of ["reserved", "confirmed", "checked-out", "cancelled"]) {
    const payload = await request("PATCH", hotelA, `/room-orders/${created.id}`, { body: { room_booking_id: ineligible[status].id }, expected: 409 });
    assert.equal(payload.error.code, "ROOM_BOOKING_NOT_CHECKED_IN");
    assert.deepEqual(await orderState(), original);
    pass(`checked-in to ${status} is rejected without mutating the order`);
  }

  const crossHotel = await request("PATCH", hotelA, `/room-orders/${created.id}`, { body: { room_booking_id: foreign.id }, expected: 404 });
  assert.equal(crossHotel.error.code, "ROOM_BOOKING_NOT_FOUND");
  assert.deepEqual(await orderState(), original);
  pass("cross-hotel replacement remains rejected without mutation");

  await request("PATCH", hotelB, `/room-orders/${created.id}`, { body: { room_booking_id: foreign.id }, tokenHotel: hotelA, expected: 403 });
  await request("PATCH", hotelA, `/room-orders/${created.id}`, { body: { room_booking_id: eligible.id }, role: "Admin", expected: 403 });
  await request("PATCH", hotelA, `/room-orders/${created.id}`, { body: { room_booking_id: eligible.id }, role: null, expected: 401 });
  assert.deepEqual(await orderState(), original);
  pass("authentication, Manager authorization, and URL hotel scope remain enforced");

  const updated = (await request("PATCH", hotelA, `/room-orders/${created.id}`, { body: { room_booking_id: eligible.id } })).data.room_order;
  assert.equal(updated.room_booking_id, eligible.id);
  assert.equal(updated.customer_name, eligible.customer_name);
  const persisted = await orderState();
  assert.equal(persisted.room_booking_id, eligible.id);
  assert.equal(persisted.customer_name, eligible.customer_name);
  assert.equal(persisted.status, original.status);
  pass("checked-in to checked-in reassignment remains successful and preserves unrelated order state");

  const statusPath = `/room-orders/${created.id}/status`;
  const assertStateUnchanged = async (snapshot, label) => {
    assert.deepEqual(await orderState(), snapshot);
    pass(label);
  };
  const statusUpdate = async (nextStatus, expected = 200) => request("PATCH", hotelA, statusPath, { body: { status: nextStatus }, expected });

  const samePendingBefore = await orderState();
  const samePending = (await statusUpdate("pending")).data.room_order;
  assert.equal(samePending.status, "pending");
  await assertStateUnchanged(samePendingBefore, "same pending status is idempotent");

  let rejected = await statusUpdate("ready", 409);
  assert.equal(rejected.error.code, "INVALID_ORDER_STATUS_TRANSITION");
  await assertStateUnchanged(samePendingBefore, "skipped pending to ready transition is rejected without mutation");

  let transitioned = (await statusUpdate("preparing")).data.room_order;
  assert.equal(transitioned.status, "preparing");
  assert.ok(transitioned.items.every((item) => item.status === "preparing"));
  pass("pending to preparing succeeds and synchronizes item status");

  const preparingState = await orderState();
  rejected = await statusUpdate("pending", 409);
  assert.equal(rejected.error.code, "INVALID_ORDER_STATUS_TRANSITION");
  await assertStateUnchanged(preparingState, "backward preparing to pending transition is rejected without mutation");
  rejected = await statusUpdate("completed", 409);
  assert.equal(rejected.error.code, "INVALID_ORDER_STATUS_TRANSITION");
  await assertStateUnchanged(preparingState, "skipped preparing to completed transition is rejected without mutation");

  transitioned = (await statusUpdate("ready")).data.room_order;
  assert.equal(transitioned.status, "ready");
  assert.ok(transitioned.items.every((item) => item.status === "ready"));
  pass("preparing to ready succeeds and synchronizes item status");

  const readyState = await orderState();
  for (const backward of ["pending", "preparing"]) {
    rejected = await statusUpdate(backward, 409);
    assert.equal(rejected.error.code, "INVALID_ORDER_STATUS_TRANSITION");
    await assertStateUnchanged(readyState, `backward ready to ${backward} transition is rejected without mutation`);
  }

  transitioned = (await statusUpdate("completed")).data.room_order;
  assert.equal(transitioned.status, "completed");
  assert.ok(transitioned.completed_at);
  assert.ok(transitioned.items.every((item) => item.status === "completed"));
  pass("ready to completed succeeds and synchronizes completion state");

  const completedState = await orderState();
  await statusUpdate("completed");
  await assertStateUnchanged(completedState, "same completed status is idempotent and preserves completed_at");

  for (const backward of ["pending", "preparing", "ready"]) {
    rejected = await statusUpdate(backward, 409);
    assert.equal(rejected.error.code, "INVALID_ORDER_STATUS_TRANSITION");
    await assertStateUnchanged(completedState, `completed to ${backward} is rejected and preserves the complete order state`);
  }

  await request("PATCH", hotelB, statusPath, { body: { status: "completed" }, tokenHotel: hotelA, expected: 403 });
  await request("PATCH", hotelA, statusPath, { body: { status: "completed" }, role: "Admin", expected: 403 });
  await request("PATCH", hotelA, statusPath, { body: { status: "completed" }, role: null, expected: 401 });
  await assertStateUnchanged(completedState, "status endpoint retains hotel scope, Manager authorization, and authentication");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixture.hotelIds.length) {
    await prisma.order_item.deleteMany({ where: { orders: { hotel_id: { in: fixture.hotelIds } } } });
    await prisma.orders.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.notification.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.room_booking.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.menu_item.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.room.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.user_role.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  }
  if (fixture.userIds.length) await prisma.users.deleteMany({ where: { id: { in: fixture.userIds } } });
  await deleteHotelFixtures(fixture.hotelIds);
  assert.deepEqual(await counts(), before, "Temporary Room Order fixtures were not completely removed");
  assert.deepEqual(await prisma.room_booking.findMany({ orderBy: { id: "asc" } }), existing.bookings, "Existing booking data changed");
  assert.deepEqual(await prisma.orders.findMany({ orderBy: { id: "asc" }, include: { order_item: { orderBy: { id: "asc" } } } }), existing.orders, "Existing order data changed");
  await prisma.$disconnect();
}

console.log(`Room Order integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
