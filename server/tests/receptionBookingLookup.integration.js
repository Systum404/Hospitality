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

const trackedModels = ["hotel", "users", "user_role", "room", "room_booking", "bill", "bill_item", "payment"];
const counts = async () => Object.fromEntries(await Promise.all(trackedModels.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const protectedInvoiceBefore = await prisma.bill.findUnique({ where: { invoice_number: "INV-000000000021" }, include: { payments: { orderBy: { created_at: "asc" } } } });
const hotelId = randomUUID();
const otherHotelId = randomUUID();
const userIds = [];
const results = [];
const pass = name => results.push(name);
let server;

function localDate(offset = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  const date = new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`);
  return new Date(date.getTime() + offset * 86400000);
}

try {
  await prisma.hotel.createMany({ data: [
      { id: hotelId, name: `Guest check-in test ${hotelId}`, status: "ACTIVE", timezone: "Asia/Kolkata" },
      { id: otherHotelId, name: `Guest check-in isolation ${otherHotelId}`, status: "ACTIVE", timezone: "Asia/Kolkata" },
  ].map(entitledHotelFixture) });

  const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
  const tokens = {};
  for (const roleName of ["Reception", "Manager", "Captain", "Kitchen"]) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    const userId = randomUUID();
    const userRoleId = randomUUID();
    userIds.push(userId);
    await prisma.users.create({ data: { id: userId, email: `${userId}@guest-check-in-test.invalid`, name: "Check-in test", password_hash: passwordHash } });
    await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: role.id, hotel_id: hotelId } });
    tokens[roleName] = await createAuthenticationToken({ userId, userRoleId }, 600);
  }

  const room = async (ownerHotelId, number, status = "active", capacity = 2) => prisma.room.create({ data: { id: randomUUID(), hotel_id: ownerHotelId, room_number: number, status, capacity, base_price: "2500.00" } });
  const rooms = {
    reserved: await room(hotelId, "GCI-RES"),
    confirmed: await room(hotelId, "GCI-CON"),
    checkedIn: await room(hotelId, "GCI-IN"),
    checkedOut: await room(hotelId, "GCI-OUT"),
    cancelled: await room(hotelId, "GCI-CAN"),
    early: await room(hotelId, "GCI-EARLY"),
    inactive: await room(hotelId, "GCI-INACTIVE", "inactive"),
    capacity: await room(hotelId, "GCI-CAP", "active", 1),
    other: await room(otherHotelId, "GCI-OTHER"),
  };

  const makeBooking = ({ ownerHotelId = hotelId, roomId, status, from = localDate(0), to = localDate(2), adults = 1, checkedInAt = null, checkedOutAt = null }) => prisma.room_booking.create({ data: {
    id: randomUUID(), hotel_id: ownerHotelId, room_id: roomId, booking_number: `BK-${randomUUID()}`,
    customer_name: `Lookup Guest ${status}`, customer_phone: "9000000000", customer_email: "guest@lookup.invalid",
    adults, children: 0, booking_from: from, booking_to: to, status, room_rate: "2500.00", total_amount: "5000.00",
    paid_amount: "0.00", payment_status: "pending", notes: "Reception note", special_requests: "Quiet room",
    checked_in_at: checkedInAt, checked_out_at: checkedOutAt,
  } });

  const bookings = {
    reserved: await makeBooking({ roomId: rooms.reserved.id, status: "reserved" }),
    confirmed: await makeBooking({ roomId: rooms.confirmed.id, status: "confirmed" }),
    checkedIn: await makeBooking({ roomId: rooms.checkedIn.id, status: "checked-in", checkedInAt: new Date() }),
    checkedOut: await makeBooking({ roomId: rooms.checkedOut.id, status: "checked-out", from: localDate(-3), to: localDate(-1), checkedInAt: localDate(-3), checkedOutAt: localDate(-1) }),
    cancelled: await makeBooking({ roomId: rooms.cancelled.id, status: "cancelled" }),
    early: await makeBooking({ roomId: rooms.early.id, status: "confirmed", from: localDate(10), to: localDate(12) }),
    inactive: await makeBooking({ roomId: rooms.inactive.id, status: "confirmed" }),
    capacity: await makeBooking({ roomId: rooms.capacity.id, status: "confirmed", adults: 2 }),
    other: await makeBooking({ ownerHotelId: otherHotelId, roomId: rooms.other.id, status: "confirmed" }),
  };

  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async ({ method = "POST", path = "/reception/booking-lookup", body, role = "Reception", tenant = hotelId }) => {
    const response = await fetch(`${origin}/api/hotels/${tenant}${path}`, {
      method,
      headers: { ...(role ? { Cookie: `aazira_auth=${tokens[role] || "invalid"}` } : {}), "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const lookup = (bookingNumber, role = "Reception", tenant = hotelId) => request({ body: { bookingNumber }, role, tenant });
  const updateStatus = (bookingId, status) => request({ method: "PATCH", path: `/room-bookings/${bookingId}/status`, body: { status } });

  const valid = await lookup(bookings.confirmed.booking_number);
  assert.equal(valid.status, 200);
  assert.equal(valid.body.data.booking.bookingNumber, bookings.confirmed.booking_number);
  assert.equal(valid.body.data.booking.roomNumber, rooms.confirmed.room_number);
  assert.equal(valid.body.data.booking.totalOccupants, 1);
  assert.ok(!JSON.stringify(valid.body).includes("password_hash"));
  pass("valid booking lookup returns the safe Reception projection");

  assert.equal((await lookup(`BK-${randomUUID()}`)).status, 404); pass("nonexistent booking returns 404");
  assert.equal((await lookup("not-a-booking-reference")).status, 400); pass("malformed booking reference returns 400");
  assert.equal((await lookup(bookings.other.booking_number)).status, 404); pass("cross-hotel booking behaves as not found");
  assert.equal((await lookup(bookings.confirmed.booking_number, "Reception")).status, 200); pass("Reception is authorized");
  assert.equal((await lookup(bookings.confirmed.booking_number, "Manager")).status, 403); pass("Manager is denied");
  assert.equal((await lookup(bookings.confirmed.booking_number, "Captain")).status, 403); pass("Captain is denied");
  assert.equal((await lookup(bookings.confirmed.booking_number, "Kitchen")).status, 403); pass("Kitchen is denied");
  assert.equal((await lookup(bookings.confirmed.booking_number, null)).status, 401); pass("unauthenticated lookup is denied");
  assert.equal((await lookup(bookings.confirmed.booking_number, "Reception", otherHotelId)).status, 403); pass("cross-hotel URL scope is denied");

  for (const status of ["reserved", "confirmed", "checkedIn", "checkedOut", "cancelled"]) {
    const response = await lookup(bookings[status].booking_number);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.booking.status, status.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`));
    pass(`${status} booking lookup preserves status`);
  }

  const historicalRate = bookings.confirmed.room_rate.toFixed(2);
  const checkedIn = await updateStatus(bookings.confirmed.id, "checked-in");
  assert.equal(checkedIn.status, 200);
  assert.equal(checkedIn.body.data.room_booking.status, "checked-in");
  assert.ok(checkedIn.body.data.room_booking.checked_in_at);
  pass("confirmed booking check-in succeeds");

  const repeated = await updateStatus(bookings.confirmed.id, "checked-in");
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.data.room_booking.checked_in_at, checkedIn.body.data.room_booking.checked_in_at);
  pass("repeated check-in preserves checked_in_at");

  const early = await updateStatus(bookings.early.id, "checked-in");
  assert.equal(early.status, 409); assert.equal(early.body.error.code, "BOOKING_CHECK_IN_WINDOW_INVALID"); pass("early check-in is rejected");
  const inactive = await updateStatus(bookings.inactive.id, "checked-in");
  assert.equal(inactive.status, 409); assert.equal(inactive.body.error.code, "ROOM_NOT_ACTIVE"); pass("inactive room check-in is rejected");
  const capacity = await updateStatus(bookings.capacity.id, "checked-in");
  assert.equal(capacity.status, 400); assert.equal(capacity.body.error.code, "ROOM_CAPACITY_EXCEEDED"); pass("capacity is revalidated at check-in");

  const conflicting = await request({ method: "POST", path: "/room-bookings", body: { room_id: rooms.confirmed.id, customer_name: "Conflict Guest", customer_phone: "9000000001", adults: 1, children: 0, booking_from: localDate(1).toISOString().slice(0,10), booking_to: localDate(3).toISOString().slice(0,10), status: "reserved" } });
  assert.equal(conflicting.status, 409); assert.equal(conflicting.body.error.code, "ROOM_OPERATIONALLY_OCCUPIED"); pass("competing booking is rejected while the room remains operationally occupied");

  const persisted = await prisma.room_booking.findUniqueOrThrow({ where: { id: bookings.confirmed.id } });
  assert.equal(persisted.room_rate.toFixed(2), historicalRate); pass("historical room rate remains unchanged");
  assert.deepEqual(await prisma.bill.findUnique({ where: { invoice_number: "INV-000000000021" }, include: { payments: { orderBy: { created_at: "asc" } } } }), protectedInvoiceBefore); pass("existing billing and payment records remain unchanged");

  const refreshed = await lookup(bookings.confirmed.booking_number);
  assert.equal(refreshed.body.data.booking.status, "checked-in");
  assert.equal(refreshed.body.data.booking.checkedInAt, checkedIn.body.data.room_booking.checked_in_at);
  pass("lookup refresh returns persisted checked-in state");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma.users.deleteMany({ where: { id: { in: userIds } } });
  await deleteHotelFixtures([hotelId, otherHotelId]);
  const after = await counts();
  assert.deepEqual(after, before);
  assert.deepEqual(await prisma.bill.findUnique({ where: { invoice_number: "INV-000000000021" }, include: { payments: { orderBy: { created_at: "asc" } } } }), protectedInvoiceBefore);
  console.log(JSON.stringify({ checks: results.length, results, countsBeforeAndAfter: after, cleanup: "All Guest Check-In fixtures removed.", protectedFinancialRecords: "unchanged" }));
  await prisma.$disconnect();
}
