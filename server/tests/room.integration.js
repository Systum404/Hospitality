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

const models = ["hotel", "users", "user_role", "room", "room_booking", "qr_code"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async (name) => [name, await prisma[name].count()])));
const fixture = { hotelIds: [], userIds: [] };
const before = await counts();
const existingRooms = await prisma.room.findMany({ orderBy: { id: "asc" } });
const existingBookings = await prisma.room_booking.findMany({ orderBy: { id: "asc" } });
const existingQrCodes = await prisma.qr_code.findMany({ orderBy: { id: "asc" } });
const results = [];
const pass = (name) => results.push(name);
let server;

try {
  const hotelA = randomUUID();
  const hotelB = randomUUID();
  fixture.hotelIds.push(hotelA, hotelB);
  await prisma.hotel.createMany({
    data: [
    { id: hotelA, name: `Room test A ${hotelA}`, status: "ACTIVE" },
    { id: hotelB, name: `Room test B ${hotelB}`, status: "ACTIVE" },
    ].map(entitledHotelFixture),
  });

  const roles = Object.fromEntries(await Promise.all(
    ["Admin", "Manager", "Reception"].map(async (name) => [name, await prisma.role.findUniqueOrThrow({ where: { name } })]),
  ));
  const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
  const tokens = {};
  const addUser = async (role, hotelId) => {
    const userId = randomUUID();
    const userRoleId = randomUUID();
    fixture.userIds.push(userId);
    await prisma.users.create({
      data: { id: userId, name: `${role} room test`, email: `${userId}@room-test.invalid`, password_hash: passwordHash },
    });
    await prisma.user_role.create({
      data: { id: userRoleId, user_id: userId, role_id: roles[role].id, hotel_id: hotelId },
    });
    tokens[`${role}:${hotelId}`] = await createAuthenticationToken({ userId, userRoleId }, 600);
  };
  await addUser("Admin", hotelA);
  await addUser("Admin", hotelB);
  await addUser("Manager", hotelA);
  await addUser("Reception", hotelA);

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, hotelId, path, { body, role = "Admin", tokenHotel = hotelId, expected = 200 } = {}) => {
    const token = role ? tokens[`${role}:${tokenHotel}`] : null;
    const response = await fetch(`${origin}/api/hotels/${hotelId}${path}`, {
      method,
      headers: {
        ...(token ? { Cookie: `aazira_auth=${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
    return payload;
  };
  const roomInput = (roomNumber, floorNumber) => ({ room_number: roomNumber, status: "active", floor_number: floorNumber });

  const startingCount = await prisma.room.count({ where: { hotel_id: hotelA } });
  for (const floorNumber of [32768, -32769]) {
    const payload = await request("POST", hotelA, "/rooms", {
      body: roomInput(`Rejected ${floorNumber}`, floorNumber),
      expected: 400,
    });
    assert.equal(payload.error.code, "INVALID_ROOM");
  }
  assert.equal(await prisma.room.count({ where: { hotel_id: hotelA } }), startingCount);
  pass("out-of-range floor numbers on create return 400 INVALID_ROOM and create no rows");

  const createdRooms = [];
  for (const floorNumber of [-32768, -32767, 0, 1, 10, 32766, 32767]) {
    const payload = await request("POST", hotelA, "/rooms", {
      body: roomInput(`RF-${floorNumber}-${randomUUID().slice(0, 8)}`, floorNumber),
      role: floorNumber === 10 ? "Manager" : "Admin",
      expected: 201,
    });
    assert.equal(payload.data.room.floor_number, floorNumber);
    createdRooms.push(payload.data.room);
  }
  pass("SMALLINT boundaries and normal floor values remain accepted for Admin and Manager");

  const patchTarget = createdRooms.find((room) => room.floor_number === 0);
  for (const floorNumber of [32768, -32769]) {
    const payload = await request("PATCH", hotelA, `/rooms/${patchTarget.id}`, {
      body: { floor_number: floorNumber },
      expected: 400,
    });
    assert.equal(payload.error.code, "INVALID_ROOM");
    assert.equal((await prisma.room.findUniqueOrThrow({ where: { id: patchTarget.id } })).floor_number, 0);
  }
  pass("out-of-range floor numbers on update return 400 and preserve the stored floor");

  for (const floorNumber of [1, 10, 0]) {
    const payload = await request("PATCH", hotelA, `/rooms/${patchTarget.id}`, { body: { floor_number: floorNumber } });
    assert.equal(payload.data.room.floor_number, floorNumber);
  }
  pass("normal floor-number updates remain accepted and persist");

  const beforeRejectedCapacity = await prisma.room.count({ where: { hotel_id: hotelA } });
  for (const capacity of [2147483648, -2147483649]) {
    const payload = await request("POST", hotelA, "/rooms", {
      body: { room_number: `RC-${capacity}`, status: "active", capacity },
      expected: 400,
    });
    assert.equal(payload.error.code, "INVALID_ROOM");
  }
  assert.equal(await prisma.room.count({ where: { hotel_id: hotelA } }), beforeRejectedCapacity);
  pass("out-of-range capacity values on create return 400 INVALID_ROOM and create no rows");

  for (const [capacity, role] of [[2147483647, "Admin"], [-2147483648, "Manager"]]) {
    const payload = await request("POST", hotelA, "/rooms", {
      body: { room_number: `RC-${capacity}-${randomUUID().slice(0, 8)}`, status: "active", capacity },
      role,
      expected: 201,
    });
    assert.equal(payload.data.room.capacity, capacity);
    createdRooms.push(payload.data.room);
  }
  pass("PostgreSQL INTEGER capacity boundaries remain accepted for Admin and Manager");

  const originalCapacity = (await prisma.room.findUniqueOrThrow({ where: { id: patchTarget.id } })).capacity;
  for (const capacity of [2147483648, -2147483649]) {
    const payload = await request("PATCH", hotelA, `/rooms/${patchTarget.id}`, {
      body: { capacity },
      expected: 400,
    });
    assert.equal(payload.error.code, "INVALID_ROOM");
    assert.equal((await prisma.room.findUniqueOrThrow({ where: { id: patchTarget.id } })).capacity, originalCapacity);
  }
  pass("out-of-range capacity values on update return 400 and preserve the stored capacity");

  for (const capacity of [1, 2, 4]) {
    const payload = await request("PATCH", hotelA, `/rooms/${patchTarget.id}`, { body: { capacity } });
    assert.equal(payload.data.room.capacity, capacity);
  }
  pass("normal capacity updates remain accepted and persist");

  const createCapacityRoom = async (capacity, label) => {
    const room = (await request("POST", hotelA, "/rooms", {
      body: { room_number: `CAP-${label}-${randomUUID().slice(0, 8)}`, status: "active", capacity },
      expected: 201,
    })).data.room;
    createdRooms.push(room);
    return room;
  };
  const createBooking = async (room, status, adults, children, from, to) => prisma.room_booking.create({
    data: {
      id: randomUUID(), hotel_id: hotelA, room_id: room.id, booking_number: `BK-CAP-${randomUUID()}`,
      customer_name: "Room capacity test", customer_phone: "0000000000", adults, children,
      booking_from: new Date(`${from}T00:00:00.000Z`), booking_to: new Date(`${to}T00:00:00.000Z`), status,
      room_rate: "100.00", total_amount: "100.00", paid_amount: "0.00", payment_status: "pending",
      ...(status === "checked-in" ? { checked_in_at: new Date() } : {}),
      ...(status === "checked-out" ? { checked_in_at: new Date(), checked_out_at: new Date() } : {}),
    },
  });

  for (const [status, offset] of [["reserved", 1], ["confirmed", 5], ["checked-in", 9]]) {
    const room = await createCapacityRoom(4, status);
    const booking = await createBooking(room, status, 3, 1, `2098-01-${String(offset).padStart(2, "0")}`, `2098-01-${String(offset + 1).padStart(2, "0")}`);
    const beforeBooking = await prisma.room_booking.findUniqueOrThrow({ where: { id: booking.id } });
    const payload = await request("PATCH", hotelA, `/rooms/${room.id}`, { body: { capacity: 1 }, expected: 409 });
    assert.equal(payload.error.code, "ROOM_CAPACITY_BELOW_ACTIVE_BOOKING");
    assert.equal((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).capacity, 4);
    assert.deepEqual(await prisma.room_booking.findUniqueOrThrow({ where: { id: booking.id } }), beforeBooking);
  }
  pass("reserved, confirmed, and checked-in bookings block reductions below occupancy without mutation");

  const multipleRoom = await createCapacityRoom(5, "multiple");
  await createBooking(multipleRoom, "reserved", 2, 0, "2098-02-01", "2098-02-02");
  await createBooking(multipleRoom, "confirmed", 3, 1, "2098-02-03", "2098-02-04");
  const belowMaximum = await request("PATCH", hotelA, `/rooms/${multipleRoom.id}`, { body: { capacity: 3 }, expected: 409 });
  assert.equal(belowMaximum.error.code, "ROOM_CAPACITY_BELOW_ACTIVE_BOOKING");
  const equalMaximum = await request("PATCH", hotelA, `/rooms/${multipleRoom.id}`, { body: { capacity: 4 }, role: "Manager" });
  assert.equal(equalMaximum.data.room.capacity, 4);
  pass("maximum active occupancy controls reduction and an equal-capacity Manager update succeeds");

  const increaseRoom = await createCapacityRoom(4, "increase");
  await createBooking(increaseRoom, "reserved", 3, 1, "2098-03-01", "2098-03-02");
  assert.equal((await request("PATCH", hotelA, `/rooms/${increaseRoom.id}`, { body: { capacity: 5 } })).data.room.capacity, 5);
  assert.equal((await request("PATCH", hotelA, `/rooms/${increaseRoom.id}`, { body: { description: "Unrelated update preserved" } })).data.room.description, "Unrelated update preserved");
  pass("capacity increases and unrelated Room updates retain existing behavior");

  const emptyRoom = await createCapacityRoom(4, "empty");
  assert.equal((await request("PATCH", hotelA, `/rooms/${emptyRoom.id}`, { body: { capacity: 1 } })).data.room.capacity, 1);
  const terminalRoom = await createCapacityRoom(4, "terminal");
  await createBooking(terminalRoom, "cancelled", 3, 1, "2098-04-01", "2098-04-02");
  await createBooking(terminalRoom, "checked-out", 3, 1, "2098-04-03", "2098-04-04");
  assert.equal((await request("PATCH", hotelA, `/rooms/${terminalRoom.id}`, { body: { capacity: 1 } })).data.room.capacity, 1);
  pass("empty rooms and rooms with only cancelled or checked-out bookings may be reduced");

  await request("PATCH", hotelA, `/rooms/${increaseRoom.id}`, { body: { capacity: 6 }, role: "Reception", expected: 403 });
  await request("PATCH", hotelB, `/rooms/${increaseRoom.id}`, { body: { capacity: 6 }, tokenHotel: hotelA, expected: 403 });
  const invalidRoom = await request("PATCH", hotelA, "/rooms/not-a-uuid", { body: { capacity: 6 }, expected: 400 });
  assert.equal(invalidRoom.error.code, "INVALID_ROOM_ID");
  pass("capacity updates preserve Reception rejection, hotel scope, and UUID validation");

  const raceRoom = await createCapacityRoom(4, "race");
  const raceBookingId = randomUUID();
  const connection = new Client({ connectionString: environment.databaseUrl });
  await connection.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT id FROM hotel WHERE id = $1 FOR UPDATE", [hotelA]);
    await connection.query(
      "INSERT INTO room_booking (id, hotel_id, room_id, booking_number, customer_name, customer_phone, adults, children, booking_from, booking_to, status, room_rate, total_amount, paid_amount, payment_status) VALUES ($1,$2,$3,$4,$5,$6,3,1,$7,$8,'reserved',100,100,0,'pending')",
      [raceBookingId, hotelA, raceRoom.id, `BK-RACE-${randomUUID()}`, "Race booking", "0000000000", "2098-05-01", "2098-05-02"],
    );
    const racingUpdate = request("PATCH", hotelA, `/rooms/${raceRoom.id}`, { body: { capacity: 1 }, expected: 409 });
    const state = await Promise.race([racingUpdate.then(() => "completed"), new Promise(resolve => setTimeout(() => resolve("blocked"), 100))]);
    assert.equal(state, "blocked");
    await connection.query("COMMIT");
    const payload = await racingUpdate;
    assert.equal(payload.error.code, "ROOM_CAPACITY_BELOW_ACTIVE_BOOKING");
  } finally {
    await connection.query("ROLLBACK").catch(() => {});
    await connection.end();
  }
  assert.equal((await prisma.room.findUniqueOrThrow({ where: { id: raceRoom.id } })).capacity, 4);
  assert.equal((await prisma.room_booking.findUniqueOrThrow({ where: { id: raceBookingId } })).adults, 3);
  pass("concurrent committed booking mutation cannot race past the capacity guard");

  const singleBookingRoom = await createCapacityRoom(2, "delete-single-booking");
  const singleBooking = await createBooking(singleBookingRoom, "cancelled", 1, 0, "2098-06-01", "2098-06-02");
  const singleBookingDelete = await request("DELETE", hotelA, `/rooms/${singleBookingRoom.id}`, { role: "Manager", expected: 409 });
  assert.equal(singleBookingDelete.error.code, "ROOM_HAS_BOOKINGS");
  assert.ok(await prisma.room.findUnique({ where: { id: singleBookingRoom.id } }));
  assert.equal((await prisma.room_booking.findUniqueOrThrow({ where: { id: singleBooking.id } })).room_id, singleBookingRoom.id);
  pass("a single booking blocks Manager Room deletion and preserves the Room and booking link");

  const multipleBookingRoom = await createCapacityRoom(2, "delete-multiple-bookings");
  const multipleBookings = [
    await createBooking(multipleBookingRoom, "reserved", 1, 0, "2098-06-03", "2098-06-04"),
    await createBooking(multipleBookingRoom, "checked-out", 1, 0, "2098-06-05", "2098-06-06"),
  ];
  const multipleBookingDelete = await request("DELETE", hotelA, `/rooms/${multipleBookingRoom.id}`, { expected: 409 });
  assert.equal(multipleBookingDelete.error.code, "ROOM_HAS_BOOKINGS");
  assert.equal(await prisma.room_booking.count({ where: { id: { in: multipleBookings.map(({ id }) => id) }, room_id: multipleBookingRoom.id } }), 2);
  pass("multiple bookings of different lifecycle states block Admin Room deletion");

  const qrRoom = await createCapacityRoom(2, "delete-qr");
  const qrCode = await prisma.qr_code.create({
    data: { id: randomUUID(), hotel_id: hotelA, code: `ROOM-DELETE-${randomUUID()}`, type: "room", room_id: qrRoom.id },
  });
  const qrDelete = await request("DELETE", hotelA, `/rooms/${qrRoom.id}`, { expected: 409 });
  assert.equal(qrDelete.error.code, "ROOM_HAS_QR_CODE");
  assert.ok(await prisma.room.findUnique({ where: { id: qrRoom.id } }));
  assert.equal((await prisma.qr_code.findUniqueOrThrow({ where: { id: qrCode.id } })).room_id, qrRoom.id);
  pass("an existing Room QR dependency retains the established ROOM_HAS_QR_CODE behavior");

  const bookingAndQrRoom = await createCapacityRoom(2, "delete-booking-and-qr");
  await createBooking(bookingAndQrRoom, "cancelled", 1, 0, "2098-06-07", "2098-06-08");
  await prisma.qr_code.create({
    data: { id: randomUUID(), hotel_id: hotelA, code: `ROOM-DELETE-${randomUUID()}`, type: "room", room_id: bookingAndQrRoom.id },
  });
  const bookingAndQrDelete = await request("DELETE", hotelA, `/rooms/${bookingAndQrRoom.id}`, { expected: 409 });
  assert.equal(bookingAndQrDelete.error.code, "ROOM_HAS_BOOKINGS");
  pass("booking dependency retains precedence when a Room also has a QR code");

  const managerEmptyRoom = await createCapacityRoom(2, "delete-manager-empty");
  const managerDeleted = await request("DELETE", hotelA, `/rooms/${managerEmptyRoom.id}`, { role: "Manager" });
  assert.equal(managerDeleted.data.room.id, managerEmptyRoom.id);
  assert.equal(await prisma.room.findUnique({ where: { id: managerEmptyRoom.id } }), null);
  const adminEmptyRoom = await createCapacityRoom(2, "delete-admin-empty");
  const adminDeleted = await request("DELETE", hotelA, `/rooms/${adminEmptyRoom.id}`);
  assert.equal(adminDeleted.data.room.id, adminEmptyRoom.id);
  assert.equal(await prisma.room.findUnique({ where: { id: adminEmptyRoom.id } }), null);
  pass("unreferenced Rooms remain deletable by Manager and Admin");

  const protectedDeleteRoom = await createCapacityRoom(2, "delete-protection");
  await request("DELETE", hotelA, `/rooms/${protectedDeleteRoom.id}`, { role: "Reception", expected: 403 });
  await request("DELETE", hotelB, `/rooms/${protectedDeleteRoom.id}`, { tokenHotel: hotelA, expected: 403 });
  const invalidDelete = await request("DELETE", hotelA, "/rooms/not-a-uuid", { expected: 400 });
  assert.equal(invalidDelete.error.code, "INVALID_ROOM_ID");
  await request("DELETE", hotelA, `/rooms/${protectedDeleteRoom.id}`, { role: null, expected: 401 });
  assert.ok(await prisma.room.findUnique({ where: { id: protectedDeleteRoom.id } }));
  pass("Room deletion preserves Reception rejection, hotel scope, UUID validation, and authentication");

  const deleteRaceRoom = await createCapacityRoom(2, "delete-race");
  const deleteRaceBookingId = randomUUID();
  const deleteConnection = new Client({ connectionString: environment.databaseUrl });
  await deleteConnection.connect();
  try {
    await deleteConnection.query("BEGIN");
    await deleteConnection.query("SELECT id FROM hotel WHERE id = $1 FOR UPDATE", [hotelA]);
    await deleteConnection.query(
      "INSERT INTO room_booking (id, hotel_id, room_id, booking_number, customer_name, customer_phone, adults, children, booking_from, booking_to, status, room_rate, total_amount, paid_amount, payment_status) VALUES ($1,$2,$3,$4,$5,$6,1,0,$7,$8,'reserved',100,100,0,'pending')",
      [deleteRaceBookingId, hotelA, deleteRaceRoom.id, `BK-DR-${randomUUID()}`, "Delete race booking", "0000000000", "2098-07-01", "2098-07-02"],
    );
    const racingDelete = request("DELETE", hotelA, `/rooms/${deleteRaceRoom.id}`, { expected: 409 });
    const state = await Promise.race([racingDelete.then(() => "completed"), new Promise(resolve => setTimeout(() => resolve("blocked"), 100))]);
    assert.equal(state, "blocked");
    await deleteConnection.query("COMMIT");
    const payload = await racingDelete;
    assert.equal(payload.error.code, "ROOM_HAS_BOOKINGS");
  } finally {
    await deleteConnection.query("ROLLBACK").catch(() => {});
    await deleteConnection.end();
  }
  assert.ok(await prisma.room.findUnique({ where: { id: deleteRaceRoom.id } }));
  assert.equal((await prisma.room_booking.findUniqueOrThrow({ where: { id: deleteRaceBookingId } })).room_id, deleteRaceRoom.id);
  pass("concurrent committed booking creation is observed before Room deletion and returns controlled 409");

  await request("GET", hotelB, "/rooms", { tokenHotel: hotelA, expected: 403 });
  await request("POST", hotelA, "/rooms", {
    body: roomInput("Unauthorized room", 1),
    role: "Reception",
    expected: 403,
  });
  await request("POST", hotelA, "/rooms", {
    body: roomInput("Unauthenticated room", 1),
    role: null,
    expected: 401,
  });
  assert.equal(await prisma.room.count({ where: { hotel_id: hotelB } }), 0);
  pass("authentication, Admin/Manager authorization, and hotel scope remain enforced");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixture.hotelIds.length) {
    await prisma.qr_code.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.room_booking.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.room.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.user_role.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  }
  if (fixture.userIds.length) await prisma.users.deleteMany({ where: { id: { in: fixture.userIds } } });
  await deleteHotelFixtures(fixture.hotelIds);
  assert.deepEqual(await counts(), before, "Temporary Room fixtures were not completely removed");
  assert.deepEqual(await prisma.room.findMany({ orderBy: { id: "asc" } }), existingRooms, "Existing Room data changed");
  assert.deepEqual(await prisma.room_booking.findMany({ orderBy: { id: "asc" } }), existingBookings, "Existing Room Booking data changed");
  assert.deepEqual(await prisma.qr_code.findMany({ orderBy: { id: "asc" } }), existingQrCodes, "Existing QR Code data changed");
  await prisma.$disconnect();
}

console.log(`Room integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
