// Explicit local-only integration test. Fixtures are isolated and removed in finally.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";
import { deleteHotelFixtures } from "./helpers/hotelFixtureCleanup.js";

const database = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && database.pathname === "/hms", "QR integration tests are local hms only");

const trackedModels = ["hotel", "users", "user_role", "room", "room_booking", "dining_area", "dining_table", "menu_category", "menu_item", "qr_code", "orders", "order_item"];
const counts = async () => Object.fromEntries(await Promise.all(trackedModels.map(async model => [model, await prisma[model].count()])));
const before = await counts();
const fixture = { hotelIds: [], userIds: [] };
const results = [];
const pass = name => results.push(name);
const rejectedByDatabase = error => ["P2003", "P2004", "P2039"].includes(error?.code) || /constraint|violat/i.test(`${error?.message || ""} ${JSON.stringify(error?.meta || {})}`);
let server;

try {
  const hotelA = randomUUID(), hotelB = randomUUID(), inactiveHotel = randomUUID();
  fixture.hotelIds.push(hotelA, hotelB, inactiveHotel);
  await prisma.hotel.createMany({ data: [
    { id: hotelA, name: "QR Test Hotel A", status: "ACTIVE", timezone: "Asia/Kolkata" },
    { id: hotelB, name: "QR Test Hotel B", status: "ACTIVE", timezone: "America/New_York" },
    { id: inactiveHotel, name: "QR Inactive Hotel", status: "ACTIVE", timezone: "Asia/Kolkata" },
  ].map(entitledHotelFixture) });

  const roles = Object.fromEntries(await Promise.all(["Admin", "Manager", "Reception", "Captain"].map(async name => [name, await prisma.role.findUniqueOrThrow({ where: { name } })])));
  const tokens = {};
  const addUser = async (role, hotelId) => {
    const userId = randomUUID(), userRoleId = randomUUID();
    fixture.userIds.push(userId);
    await prisma.users.create({ data: { id: userId, name: `QR ${role}`, email: `${userId}@qr-test.invalid`, password_hash: "integration-test-not-a-login-secret" } });
    await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: roles[role].id, hotel_id: hotelId } });
    tokens[`${role}:${hotelId}`] = await createAuthenticationToken({ userId, userRoleId }, 900);
  };
  await addUser("Admin", hotelA);
  await addUser("Manager", hotelA);
  await addUser("Reception", hotelA);
  await addUser("Captain", hotelA);
  await addUser("Admin", hotelB);
  await addUser("Reception", inactiveHotel);
  await prisma.hotel.update({ where: { id: inactiveHotel }, data: { status: "INACTIVE" } });

  const areaA = randomUUID(), areaA2 = randomUUID(), inactiveAreaA = randomUUID(), areaB = randomUUID();
  const tableA = randomUUID(), tableA2 = randomUUID(), occupiedTableA = randomUUID(), inactiveTableA = randomUUID(), areaInactiveTableA = randomUUID(), tableB = randomUUID();
  await prisma.dining_area.createMany({ data: [
    { id: areaA, hotel_id: hotelA, name: "QR Area A", status: "active" },
    { id: areaA2, hotel_id: hotelA, name: "QR Area A2", status: "active" },
    { id: inactiveAreaA, hotel_id: hotelA, name: "QR Inactive Area A", status: "inactive" },
    { id: areaB, hotel_id: hotelB, name: "QR Area B", status: "active" },
  ] });
  await prisma.dining_table.createMany({ data: [
    { id: tableA, hotel_id: hotelA, dining_area_id: areaA, table_number: "QR-A1", capacity: 4, status: "available" },
    { id: tableA2, hotel_id: hotelA, dining_area_id: areaA2, table_number: "QR-A1", capacity: 4, status: "available" },
    { id: occupiedTableA, hotel_id: hotelA, dining_area_id: areaA, table_number: "QR-A2", capacity: 6, status: "occupied" },
    { id: inactiveTableA, hotel_id: hotelA, dining_area_id: areaA, table_number: "QR-A3", capacity: 2, status: "inactive" },
    { id: areaInactiveTableA, hotel_id: hotelA, dining_area_id: inactiveAreaA, table_number: "QR-A4", capacity: 2, status: "available" },
    { id: tableB, hotel_id: hotelB, dining_area_id: areaB, table_number: "QR-B1", capacity: 4, status: "available" },
  ] });

  const roomA1 = randomUUID(), roomA2 = randomUUID(), roomA3 = randomUUID(), inactiveRoomA = randomUUID(), roomB = randomUUID();
  await prisma.room.createMany({ data: [
    { id: roomA1, hotel_id: hotelA, room_number: "QR-R1", status: "active", capacity: 2, base_price: "100.00" },
    { id: roomA2, hotel_id: hotelA, room_number: "QR-R2", status: "active", capacity: 2, base_price: "100.00" },
    { id: roomA3, hotel_id: hotelA, room_number: "QR-R3", status: "active", capacity: 2, base_price: "100.00" },
    { id: inactiveRoomA, hotel_id: hotelA, room_number: "QR-R4", status: "inactive", capacity: 2, base_price: "100.00" },
    { id: roomB, hotel_id: hotelB, room_number: "QR-RB", status: "active", capacity: 2, base_price: "100.00" },
  ] });

  const categoryActive = randomUUID(), categoryInactive = randomUUID();
  const itemActive = randomUUID(), itemInactive = randomUUID(), itemHiddenCategory = randomUUID(), itemB = randomUUID();
  await prisma.menu_category.createMany({ data: [
    { id: categoryActive, hotel_id: hotelA, name: "QR Public", is_active: true, display_order: 1 },
    { id: categoryInactive, hotel_id: hotelA, name: "QR Private", is_active: false, display_order: 2 },
  ] });
  await prisma.menu_item.createMany({ data: [
    { id: itemActive, hotel_id: hotelA, category_id: categoryActive, name: "QR Available", price: "12.50", is_available: true, is_veg: true },
    { id: itemInactive, hotel_id: hotelA, category_id: categoryActive, name: "QR Unavailable", price: "15.00", is_available: false },
    { id: itemHiddenCategory, hotel_id: hotelA, category_id: categoryInactive, name: "QR Hidden Category", price: "20.00", is_available: true },
    { id: itemB, hotel_id: hotelB, name: "QR Other Hotel", price: "99.00", is_available: true },
  ] });

  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000), tomorrow = new Date(today.getTime() + 86400000);
  const booking = async (roomId, number, status, checkedOut = null) => prisma.room_booking.create({ data: {
    id: randomUUID(), hotel_id: hotelA, room_id: roomId, booking_number: number, customer_name: "Private QR Guest", customer_phone: "+910000000000",
    booking_from: yesterday, booking_to: tomorrow, status, payment_status: "pending", room_rate: "100.00", total_amount: "100.00", checked_in_at: status === "checked-in" ? new Date() : null, checked_out_at: checkedOut,
  } });
  const bookingA1 = await booking(roomA1, "QR-BOOK-1", "checked-in");
  const bookingA2 = await booking(roomA2, "QR-BOOK-2", "checked-in");
  const cancelledBooking = await booking(roomA3, "QR-BOOK-3", "cancelled");

  const liveOrigin = process.env.QR_TEST_BASE_URL?.replace(/\/$/, "");
  if (!liveOrigin) {
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
  }
  const origin = liveOrigin || `http://127.0.0.1:${server.address().port}`;
  const request = async (method, path, { role, tokenHotel = hotelA, body, expected = 200, headers = {} } = {}) => {
    const auth = role ? tokens[`${role}:${tokenHotel}`] : null;
    const response = await fetch(`${origin}${path}`, { method, headers: { ...(auth ? { Cookie: `aazira_auth=${auth}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const payload = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
    return payload;
  };
  const manage = (method, hotelId, suffix, options = {}) => request(method, `/api/hotels/${hotelId}/qr-codes${suffix}`, options);
  const createQr = async (role, type, target) => (await manage("POST", hotelA, "", { role, body: type === "room" ? { type, room_id: target } : { type, dining_table_id: target }, expected: 201 })).data.qr_code;

  await manage("GET", hotelA, "", { expected: 401 });
  await manage("GET", hotelA, "", { role: "Reception", expected: 403 });
  await manage("GET", hotelB, "", { role: "Admin", tokenHotel: hotelA, expected: 403 });
  pass("QR management requires authentication, Admin/Manager authorization, and URL hotel scope");

  const roomQr1 = await createQr("Admin", "room", roomA1);
  const roomQr2 = await createQr("Manager", "room", roomA2);
  const roomQr3 = await createQr("Admin", "room", roomA3);
  const inactiveRoomQr = await createQr("Admin", "room", inactiveRoomA);
  const tableQr = await createQr("Manager", "dining_table", tableA);
  const tableQrSameNumberOtherArea = await createQr("Admin", "dining_table", tableA2);
  const occupiedTableQr = await createQr("Admin", "dining_table", occupiedTableA);
  const inactiveTableQr = await createQr("Admin", "dining_table", inactiveTableA);
  const inactiveAreaQr = await createQr("Admin", "dining_table", areaInactiveTableA);
  assert.match(roomQr1.code, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(roomQr1.code, roomQr2.code);
  assert.ok(![roomA1, bookingA1.id, hotelA].includes(roomQr1.code));
  pass("Admin and Manager create cryptographically random URL-safe room and table QR tokens");

  await manage("POST", hotelA, "", { role: "Admin", body: { type: "room", room_id: roomA1 }, expected: 409 });
  await manage("POST", hotelA, "", { role: "Admin", body: { type: "room", dining_table_id: tableA }, expected: 400 });
  await manage("POST", hotelA, "", { role: "Admin", body: { type: "room", room_id: roomB }, expected: 404 });
  pass("duplicate, malformed, and cross-hotel QR targets are rejected");

  const listed = await manage("GET", hotelA, "", { role: "Admin" });
  assert.equal(listed.data.qr_codes.length, 9);
  assert.ok(listed.data.qr_codes.every(row => row.hotel_id === hotelA));
  pass("management list is restricted to the authenticated hotel");

  const roomContext = await request("GET", `/api/public/qr/${roomQr1.code}`);
  assert.deepEqual(roomContext.data.qr, { type: "room" });
  assert.equal(roomContext.data.hotel.name, "QR Test Hotel A");
  assert.equal(roomContext.data.room.number, "QR-R1");
  const serializedRoom = JSON.stringify(roomContext);
  for (const secret of [bookingA1.id, "Private QR Guest", "+910000000000", roomA1, hotelA]) assert.ok(!serializedRoom.includes(secret));
  pass("public room resolution returns safe display context without guest or internal identifiers");

  const tableContext = await request("GET", `/api/public/qr/${tableQr.code}`);
  assert.equal(tableContext.data.table.number, "QR-A1");
  assert.equal(tableContext.data.dining_area.name, "QR Area A");
  const sameNumberOtherAreaContext = await request("GET", `/api/public/qr/${tableQrSameNumberOtherArea.code}`);
  assert.equal(sameNumberOtherAreaContext.data.table.number, "QR-A1");
  assert.equal(sameNumberOtherAreaContext.data.dining_area.name, "QR Area A2");
  assert.notEqual(tableA, tableA2);
  assert.equal((await prisma.qr_code.findUniqueOrThrow({ where: { id: tableQr.id } })).dining_table_id, tableA);
  assert.equal((await prisma.qr_code.findUniqueOrThrow({ where: { id: tableQrSameNumberOtherArea.id } })).dining_table_id, tableA2);
  assert.equal(tableContext.data.ordering.eligible, true);
  const occupiedContext = await request("GET", `/api/public/qr/${occupiedTableQr.code}`);
  assert.equal(occupiedContext.data.ordering.eligible, true);
  pass("table QR resolves without a booking or customer login and permits concurrent occupied-table context");

  for (const unavailable of [inactiveTableQr.code, inactiveAreaQr.code, inactiveRoomQr.code]) {
    const result = await request("GET", `/api/public/qr/${unavailable}`, { expected: 409 });
    assert.equal(result.error.code, "QR_CONTEXT_UNAVAILABLE");
  }
  pass("inactive room, table, and dining-area targets cannot establish ordering context");

  await manage("PATCH", hotelA, `/${tableQr.id}/status`, { role: "Manager", body: { is_active: false } });
  await request("GET", `/api/public/qr/${tableQr.code}`, { expected: 404 });
  await manage("PATCH", hotelA, `/${tableQr.id}/status`, { role: "Manager", body: { is_active: true } });
  pass("deactivated QR tokens are rejected and explicit reactivation restores access");

  const oldTableToken = tableQr.code;
  const rotated = await manage("POST", hotelA, `/${tableQr.id}/rotate`, { role: "Admin", body: {} });
  assert.notEqual(rotated.data.qr_code.code, oldTableToken);
  await request("GET", `/api/public/qr/${oldTableToken}`, { expected: 404 });
  await request("GET", `/api/public/qr/${rotated.data.qr_code.code}`);
  pass("explicit rotation invalidates the prior opaque token without automatic room rotation");

  const issued1 = await manage("POST", hotelA, `/room-bookings/${bookingA1.id}/capability`, { role: "Manager", body: {}, expected: 201 });
  const capability1 = issued1.data.room_capability.capability;
  assert.match(capability1, /^[A-Za-z0-9_-]{43}$/);
  const storedBooking = await prisma.room_booking.findUniqueOrThrow({ where: { id: bookingA1.id }, select: { ordering_capability_hash: true } });
  assert.equal(storedBooking.ordering_capability_hash, createHash("sha256").update(capability1).digest("hex"));
  assert.notEqual(storedBooking.ordering_capability_hash, capability1);
  assert.ok(!JSON.stringify(issued1).includes(storedBooking.ordering_capability_hash));
  pass("booking capability is returned once while only its SHA-256 representation is persisted");

  const verified = await request("POST", `/api/public/qr/${roomQr1.code}/room-capability`, { body: { capability: capability1 } });
  assert.equal(verified.data.ordering.authorized, true);
  await request("POST", `/api/public/qr/${roomQr1.code}/room-capability`, { body: { capability: "x".repeat(43) }, expected: 403 });
  await request("POST", `/api/public/qr/${roomQr2.code}/room-capability`, { body: { capability: capability1 }, expected: 403 });
  pass("valid room capability authorizes only its physical room while invalid and wrong-room secrets fail");

  const receptionIssued = await manage("POST", hotelA, `/room-bookings/${bookingA1.id}/capability`, { role: "Reception", body: {}, expected: 201 });
  const receptionCapability = receptionIssued.data.room_capability.capability;
  assert.notEqual(receptionCapability, capability1);
  await request("POST", `/api/public/qr/${roomQr1.code}/room-capability`, { body: { capability: capability1 }, expected: 403 });
  await request("POST", `/api/public/qr/${roomQr1.code}/room-capability`, { body: { capability: receptionCapability } });
  const receptionReissued = await manage("POST", hotelA, `/room-bookings/${bookingA1.id}/capability`, { role: "Reception", body: {}, expected: 201 });
  assert.notEqual(receptionReissued.data.room_capability.capability, receptionCapability);
  await request("POST", `/api/public/qr/${roomQr1.code}/room-capability`, { body: { capability: receptionCapability }, expected: 403 });
  const persistedReissue = await prisma.room_booking.findUniqueOrThrow({ where: { id: bookingA1.id }, select: { ordering_capability_hash: true } });
  assert.equal(persistedReissue.ordering_capability_hash, createHash("sha256").update(receptionReissued.data.room_capability.capability).digest("hex"));
  assert.ok(!JSON.stringify(persistedReissue).includes(receptionReissued.data.room_capability.capability));
  pass("Reception can issue and reissue one-time room capabilities while prior values are invalidated and raw values are not persisted");

  const managerReissued = await manage("POST", hotelA, `/room-bookings/${bookingA1.id}/capability`, { role: "Manager", body: {}, expected: 201 });
  assert.notEqual(managerReissued.data.room_capability.capability, receptionReissued.data.room_capability.capability);
  await request("POST", `/api/public/qr/${roomQr1.code}/room-capability`, { body: { capability: receptionReissued.data.room_capability.capability }, expected: 403 });
  await request("POST", `/api/public/qr/${roomQr1.code}/room-capability`, { body: { capability: managerReissued.data.room_capability.capability } });
  pass("Manager can reissue a room capability and invalidate the previous value");

  await manage("POST", hotelA, `/room-bookings/${bookingA1.id}/capability`, { role: "Captain", body: {}, expected: 403 });
  pass("operational roles outside Admin, Manager, and Reception cannot issue room capabilities");

  await manage("POST", inactiveHotel, `/room-bookings/${bookingA1.id}/capability`, { role: "Reception", tokenHotel: inactiveHotel, body: {}, expected: 403 });
  pass("inactive hotels cannot issue room capabilities");

  await manage("POST", hotelB, `/room-bookings/${bookingA1.id}/capability`, { role: "Admin", tokenHotel: hotelA, body: {}, expected: 403 });
  await manage("POST", hotelA, `/room-bookings/${cancelledBooking.id}/capability`, { role: "Admin", body: {}, expected: 409 });
  await prisma.room_booking.update({ where: { id: bookingA1.id }, data: { status: "checked-out", checked_out_at: new Date() } });
  await request("POST", `/api/public/qr/${roomQr1.code}/room-capability`, { body: { capability: managerReissued.data.room_capability.capability }, expected: 403 });
  pass("cross-hotel issuance, cancelled stays, and capability reuse after checkout are rejected");

  const issued2 = await manage("POST", hotelA, `/room-bookings/${bookingA2.id}/capability`, { role: "Admin", body: {}, expected: 201 });
  const menu = await request("GET", `/api/public/qr/${roomQr2.code}/menu`, { headers: { "x-room-capability": issued2.data.room_capability.capability } });
  assert.deepEqual(menu.data.menu.categories.map(row => row.id), [categoryActive]);
  assert.deepEqual(menu.data.menu.items.map(row => row.id), [itemActive]);
  assert.equal(menu.data.menu.items[0].price, "12.50");
  const menuJson = JSON.stringify(menu);
  for (const forbidden of [itemInactive, itemHiddenCategory, itemB, "hotel_id", "created_at", "updated_at", "Private QR Guest"]) assert.ok(!menuJson.includes(forbidden));
  const tableMenu = await request("GET", `/api/public/qr/${rotated.data.qr_code.code}/menu`);
  assert.deepEqual(tableMenu.data.menu.items.map(row => row.id), [itemActive]);
  pass("public room/table menu exposes only active hotel-scoped presentation fields");

  await assert.rejects(prisma.qr_code.create({ data: { id: randomUUID(), hotel_id: hotelA, code: "z".repeat(43), type: "room" } }), rejectedByDatabase);
  await assert.rejects(prisma.qr_code.create({ data: { id: randomUUID(), hotel_id: hotelA, code: "y".repeat(43), type: "room", room_id: roomB } }), rejectedByDatabase);
  await assert.rejects(prisma.dining_table.update({ where: { id: tableA }, data: { dining_area_id: areaB } }), rejectedByDatabase);
  pass("database CHECK and composite foreign keys reject invalid target and cross-hotel relationships");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (fixture.hotelIds.length) {
    await prisma.hotel.updateMany({ where: { id: { in: fixture.hotelIds }, status: "INACTIVE" }, data: { status: "ACTIVE" } });
    await prisma.order_item.deleteMany({ where: { orders: { hotel_id: { in: fixture.hotelIds } } } });
    await prisma.orders.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.qr_code.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.room_booking.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.menu_item.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.menu_category.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.dining_table.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.dining_area.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.room.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.user_role.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.hotel.deleteMany({ where: { id: { in: fixture.hotelIds } } });
  }
  if (fixture.userIds.length) await prisma.users.deleteMany({ where: { id: { in: fixture.userIds } } });
  await deleteHotelFixtures(fixture.hotelIds);
  assert.deepEqual(await counts(), before, "Temporary QR fixtures were not completely removed");
  await prisma.$disconnect();
}

console.log(`QR integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
