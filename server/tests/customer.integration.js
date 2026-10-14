// Explicit local-only integration test. Fixtures are isolated and removed in finally.
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

const models = ["hotel", "users", "user_role", "customer", "room", "room_booking", "menu_item", "orders", "order_item", "bill", "bill_item", "payment"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const historicalState = async () => ({
  bookings: await prisma.room_booking.findMany({ where: { id: { notIn: fixture.bookingIds } }, orderBy: { id: "asc" } }),
  orders: await prisma.orders.findMany({ where: { id: { notIn: fixture.orderIds } }, orderBy: { id: "asc" } }),
  bills: await prisma.bill.findMany({ orderBy: { id: "asc" }, include: { items: { orderBy: { position: "asc" } }, payments: { orderBy: { id: "asc" } } } }),
});
const fixture = { hotelIds: [], userIds: [], bookingIds: [], orderIds: [] };
const before = await counts();
const historicalBefore = await historicalState();
const results = [];
const pass = name => results.push(name);
const foreignKeyRejected = error => error?.code === "P2003" || error?.code === "P2039" || error?.meta?.driverAdapterError?.cause?.code === "23001";
let server;

function dates() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  const start = new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`);
  return [start, new Date(start.getTime() + 86400000), new Date(start.getTime() + 172800000)].map(value => value.toISOString().slice(0, 10));
}

try {
  const hotelA = randomUUID(), hotelB = randomUUID();
  fixture.hotelIds.push(hotelA, hotelB);
  await prisma.hotel.createMany({ data: [
    { id: hotelA, name: `Customer test A ${hotelA}`, status: "ACTIVE", timezone: "Asia/Kolkata" },
    { id: hotelB, name: `Customer test B ${hotelB}`, status: "ACTIVE", timezone: "America/New_York" },
  ].map(entitledHotelFixture) });

  const roles = Object.fromEntries(await Promise.all(["Reception", "Manager", "Admin", "Captain"].map(async name => [name, await prisma.role.findUniqueOrThrow({ where: { name } })])));
  const password_hash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
  const tokens = {};
  const addUser = async (role, hotelId, label) => {
    const userId = randomUUID(), userRoleId = randomUUID();
    fixture.userIds.push(userId);
    await prisma.users.create({ data: { id: userId, name: label, email: `${userId}@customer-test.invalid`, password_hash } });
    await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: roles[role].id, hotel_id: hotelId } });
    tokens[`${role}:${hotelId}`] = await createAuthenticationToken({ userId, userRoleId }, 600);
  };
  await addUser("Reception", hotelA, "Reception A");
  await addUser("Manager", hotelA, "Manager A");
  await addUser("Admin", hotelA, "Admin A");
  await addUser("Captain", hotelA, "Captain A");
  await addUser("Reception", hotelB, "Reception B");

  const roomA1 = randomUUID(), roomA2 = randomUUID(), roomB = randomUUID(), menuItem = randomUUID();
  await prisma.room.createMany({ data: [
    { id: roomA1, hotel_id: hotelA, room_number: "CUSTOMER-A1", status: "active", capacity: 2, base_price: "100.00" },
    { id: roomA2, hotel_id: hotelA, room_number: "CUSTOMER-A2", status: "active", capacity: 2, base_price: "125.00" },
    { id: roomB, hotel_id: hotelB, room_number: "CUSTOMER-B1", status: "active", capacity: 2, base_price: "100.00" },
  ] });
  await prisma.menu_item.create({ data: { id: menuItem, hotel_id: hotelA, name: "Customer test meal", price: "25.00", is_available: true } });

  const liveOrigin = process.env.CUSTOMER_TEST_BASE_URL?.replace(/\/$/, "");
  if (!liveOrigin) {
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
  }
  const origin = liveOrigin || `http://127.0.0.1:${server.address().port}`;
  const request = async (method, hotelId, path, { body, role = "Reception", tokenHotel = hotelId, expected = 200 } = {}) => {
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
  const [today, tomorrow, dayAfter] = dates();
  const bookingInput = (room_id, customer_name, hotel = hotelA) => ({ room_id, customer_name, customer_phone: "+910000000001", customer_email: "first.snapshot@customer-test.invalid", adults: 1, children: 0, booking_from: today, booking_to: hotel === hotelA ? dayAfter : tomorrow, status: "confirmed" });

  const longName = `Guest ${"X".repeat(144)}`;
  const firstResponse = await request("POST", hotelA, "/room-bookings", { body: bookingInput(roomA1, longName), expected: 201 });
  const firstBooking = firstResponse.data.room_booking;
  fixture.bookingIds.push(firstBooking.id);
  const storedFirst = await prisma.room_booking.findUniqueOrThrow({ where: { id: firstBooking.id } });
  const customerA = await prisma.customer.findUniqueOrThrow({ where: { id: storedFirst.customer_id } });
  assert.equal(customerA.hotel_id, hotelA);
  assert.equal(customerA.first_name, longName);
  assert.equal(storedFirst.customer_name, longName);
  assert.equal(storedFirst.customer_phone, "+910000000001");
  assert.equal(await prisma.users.count(), before.users + fixture.userIds.length);
  pass("booking creates a hotel-scoped customer without creating guest credentials and preserves its snapshot");

  const secondInput = bookingInput(roomA2, "Different Booking Snapshot");
  secondInput.customer_email = "second.snapshot@customer-test.invalid";
  const secondBooking = (await request("POST", hotelA, "/room-bookings", { body: secondInput, expected: 201 })).data.room_booking;
  fixture.bookingIds.push(secondBooking.id);
  const storedSecond = await prisma.room_booking.findUniqueOrThrow({ where: { id: secondBooking.id } });
  assert.equal(storedSecond.customer_id, customerA.id);
  assert.equal(storedSecond.customer_name, "Different Booking Snapshot");
  assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: customerA.id } })).first_name, longName);
  assert.equal(await prisma.customer.count({ where: { hotel_id: hotelA, phone: "+910000000001" } }), 1);
  pass("same-hotel phone reuses one profile without overwriting transactional snapshots");

  const otherBooking = (await request("POST", hotelB, "/room-bookings", { body: bookingInput(roomB, "Other Hotel Guest", hotelB), tokenHotel: hotelB, expected: 201 })).data.room_booking;
  fixture.bookingIds.push(otherBooking.id);
  const customerB = await prisma.customer.findUniqueOrThrow({ where: { id: (await prisma.room_booking.findUniqueOrThrow({ where: { id: otherBooking.id } })).customer_id } });
  assert.notEqual(customerB.id, customerA.id);
  assert.equal(customerB.hotel_id, hotelB);
  pass("identical phone numbers are not reused across hotels");

  for (const role of ["Reception", "Manager", "Admin"]) {
    const search = await request("GET", hotelA, `/customers?phone=${encodeURIComponent(customerA.phone)}`, { role });
    assert.deepEqual(search.data.customers.map(row => row.id), [customerA.id]);
    const detail = await request("GET", hotelA, `/customers/${customerA.id}`, { role });
    assert.equal(detail.data.customer.id, customerA.id);
    assert.ok(!Object.hasOwn(detail.data.customer, "password_hash"));
  }
  pass("Reception, Manager, and Admin can search and retrieve only the safe customer projection");
  await request("GET", hotelA, `/customers/${customerA.id}`, { role: "Captain", expected: 403 });
  await request("GET", hotelA, `/customers/${customerA.id}`, { role: null, expected: 401 });
  await request("GET", hotelB, `/customers/${customerB.id}`, { tokenHotel: hotelA, expected: 403 });
  await request("GET", hotelA, `/customers/${customerB.id}`, { expected: 404 });
  const unsupported = await request("POST", hotelA, "/room-bookings", { body: { ...bookingInput(roomA2, "Attach attempt"), customer_id: customerB.id }, expected: 400 });
  assert.equal(unsupported.error.code, "UNSUPPORTED_ROOM_BOOKING_FIELDS");
  pass("unauthenticated, unauthorized, URL cross-hotel, foreign customer, and client attachment attempts are rejected");

  await assert.rejects(
    prisma.room_booking.update({ where: { id: firstBooking.id }, data: { customer_id: customerB.id } }),
    foreignKeyRejected,
  );
  pass("database composite foreign key rejects a cross-hotel booking/customer relationship");

  await request("PATCH", hotelA, `/room-bookings/${firstBooking.id}/status`, { body: { status: "checked-in" } });
  const roomOrder = (await request("POST", hotelA, "/room-orders", { role: "Manager", body: { room_booking_id: firstBooking.id, items: [{ menu_item_id: menuItem, quantity: 2, special_instructions: "Snapshot note" }], status: "pending", payment_status: "pending", notes: "Customer linkage test" }, expected: 201 })).data.room_order;
  fixture.orderIds.push(roomOrder.id);
  const storedOrder = await prisma.orders.findUniqueOrThrow({ where: { id: roomOrder.id } });
  assert.equal(storedOrder.customer_id, customerA.id);
  assert.equal(storedOrder.customer_name, longName);
  assert.equal(storedOrder.customer_phone, customerA.phone);
  assert.equal(storedOrder.customer_email, "first.snapshot@customer-test.invalid");
  await assert.rejects(
    prisma.orders.update({ where: { id: roomOrder.id }, data: { customer_id: customerB.id } }),
    foreignKeyRejected,
  );
  pass("room-service order inherits the trusted booking customer and snapshot while database scope rejects cross-hotel linkage");

  await prisma.customer.update({ where: { id: customerA.id }, data: { first_name: "Updated Profile", email: "updated.profile@customer-test.invalid" } });
  const unchangedBooking = await prisma.room_booking.findUniqueOrThrow({ where: { id: firstBooking.id } });
  const unchangedOrder = await prisma.orders.findUniqueOrThrow({ where: { id: roomOrder.id } });
  assert.equal(unchangedBooking.customer_name, longName);
  assert.equal(unchangedBooking.customer_email, "first.snapshot@customer-test.invalid");
  assert.equal(unchangedOrder.customer_name, longName);
  assert.equal(unchangedOrder.customer_email, "first.snapshot@customer-test.invalid");
  assert.deepEqual((await historicalState()).bills, historicalBefore.bills);
  pass("customer profile changes cannot rewrite booking, order, or finalized bill snapshots");

  await assert.rejects(prisma.customer.delete({ where: { id: customerA.id } }), foreignKeyRejected);
  const unused = await prisma.customer.create({ data: { id: randomUUID(), hotel_id: hotelA, first_name: "Unused", phone: "+910000000099" } });
  await prisma.customer.delete({ where: { id: unused.id } });
  pass("referenced customer deletion is restricted while an unused profile can be removed");

  const existingNullBookings = historicalBefore.bookings.filter(row => row.customer_id === null).map(row => row.id);
  assert.deepEqual((await prisma.room_booking.findMany({ where: { id: { in: existingNullBookings } }, orderBy: { id: "asc" }, select: { id: true, customer_id: true } })).map(row => row.id), existingNullBookings);
  pass("pre-existing snapshot-only bookings remain unlinked and valid");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (fixture.hotelIds.length) {
    await prisma.order_item.deleteMany({ where: { orders: { hotel_id: { in: fixture.hotelIds } } } });
    await prisma.orders.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.room_booking.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.customer.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.menu_item.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.room.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.notification.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.user_role.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  }
  if (fixture.userIds.length) await prisma.users.deleteMany({ where: { id: { in: fixture.userIds } } });
  await deleteHotelFixtures(fixture.hotelIds);
  assert.deepEqual(await counts(), before, "Temporary customer fixtures were not completely removed");
  assert.deepEqual(await historicalState(), historicalBefore, "Historical booking/order/billing records changed");
  await prisma.$disconnect();
}

console.log(`Customer integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
