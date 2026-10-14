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

const models = ["hotel", "users", "user_role", "dining_area", "dining_table", "orders"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const existingAreas = await prisma.dining_area.findMany({ orderBy: { id: "asc" } });
const existingTables = await prisma.dining_table.findMany({ orderBy: { id: "asc" } });
const existingOrders = await prisma.orders.findMany({ orderBy: { id: "asc" } });
const fixture = { hotelIds: [], userIds: [] };
const results = [];
const pass = name => results.push(name);
let server;

try {
  const hotelA = randomUUID();
  const hotelB = randomUUID();
  fixture.hotelIds.push(hotelA, hotelB);
  await prisma.hotel.createMany({ data: [
    { id: hotelA, name: `Dining area test A ${hotelA}`, status: "ACTIVE" },
    { id: hotelB, name: `Dining area test B ${hotelB}`, status: "ACTIVE" },
  ].map(entitledHotelFixture) });

  const roles = Object.fromEntries(await Promise.all(["Admin", "Manager", "Reception"].map(async name => [name, await prisma.role.findUniqueOrThrow({ where: { name } })])));
  const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
  const tokens = {};
  const addUser = async role => {
    const userId = randomUUID();
    const userRoleId = randomUUID();
    fixture.userIds.push(userId);
    await prisma.users.create({ data: { id: userId, name: `${role} dining-area test`, email: `${userId}@dining-area-test.invalid`, password_hash: passwordHash } });
    await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: roles[role].id, hotel_id: hotelA } });
    tokens[role] = await createAuthenticationToken({ userId, userRoleId }, 600);
  };
  await addUser("Admin");
  await addUser("Manager");
  await addUser("Reception");

  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (hotelId, areaId, { role = "Admin", expected = 200 } = {}) => {
    const response = await fetch(`${origin}/api/hotels/${hotelId}/dining-areas/${areaId}`, {
      method: "DELETE",
      headers: role ? { Cookie: `aazira_auth=${tokens[role]}` } : {},
    });
    const payload = await response.json();
    assert.equal(response.status, expected, JSON.stringify(payload));
    return payload;
  };
  const createArea = (hotelId, label) => prisma.dining_area.create({
    data: { id: randomUUID(), hotel_id: hotelId, name: `${label}-${randomUUID().slice(0, 8)}`, status: "active" },
  });
  const createTable = (hotelId, areaId, label, overrides = {}) => prisma.dining_table.create({
    data: { id: randomUUID(), hotel_id: hotelId, dining_area_id: areaId, table_number: `${label}-${randomUUID().slice(0, 8)}`, capacity: 4, status: "available", ...overrides },
  });
  const createOrder = (hotelId, tableId, label) => prisma.orders.create({
    data: {
      id: randomUUID(), hotel_id: hotelId, table_id: tableId, order_number: `DA-${label}-${randomUUID()}`,
      source: "captain", customer_name: "Dining Area Test", customer_phone: "0000000000",
      status: "completed", payment_status: "pending",
    },
  });

  const oneTableArea = await createArea(hotelA, "ONE");
  const oneTable = await createTable(hotelA, oneTableArea.id, "ONE", { capacity: 7, status: "reserved" });
  const oneAreaBefore = await prisma.dining_area.findUniqueOrThrow({ where: { id: oneTableArea.id } });
  const oneTableBefore = await prisma.dining_table.findUniqueOrThrow({ where: { id: oneTable.id } });
  const oneRejected = await request(hotelA, oneTableArea.id, { role: "Manager", expected: 409 });
  assert.equal(oneRejected.error.code, "DINING_AREA_HAS_TABLES");
  pass("one empty Dining Table returns 409 DINING_AREA_HAS_TABLES for Manager");
  assert.deepEqual(await prisma.dining_area.findUniqueOrThrow({ where: { id: oneTableArea.id } }), oneAreaBefore);
  pass("rejected deletion preserves the Dining Area");
  assert.deepEqual(await prisma.dining_table.findUniqueOrThrow({ where: { id: oneTable.id } }), oneTableBefore);
  pass("rejected deletion preserves table configuration");

  const multipleArea = await createArea(hotelA, "MULTIPLE");
  const multipleTables = await Promise.all([
    createTable(hotelA, multipleArea.id, "MULTI-A"),
    createTable(hotelA, multipleArea.id, "MULTI-B", { capacity: 6, status: "inactive" }),
  ]);
  const multipleBefore = await prisma.dining_table.findMany({ where: { dining_area_id: multipleArea.id }, orderBy: { id: "asc" } });
  const multipleRejected = await request(hotelA, multipleArea.id, { expected: 409 });
  assert.equal(multipleRejected.error.code, "DINING_AREA_HAS_TABLES");
  pass("multiple empty Dining Tables return 409 for Admin");
  assert.deepEqual(await prisma.dining_table.findMany({ where: { dining_area_id: multipleArea.id }, orderBy: { id: "asc" } }), multipleBefore);
  assert.equal(multipleTables.length, 2);
  pass("rejected deletion preserves every Dining Table");

  const historyArea = await createArea(hotelA, "HISTORY");
  const historyTable = await createTable(hotelA, historyArea.id, "HISTORY");
  const historyOrder = await createOrder(hotelA, historyTable.id, "HISTORY");
  const historyRejected = await request(hotelA, historyArea.id, { expected: 409 });
  assert.equal(historyRejected.error.code, "DINING_AREA_HAS_ORDERS");
  assert.ok(await prisma.dining_area.findUnique({ where: { id: historyArea.id } }));
  assert.ok(await prisma.dining_table.findUnique({ where: { id: historyTable.id } }));
  assert.ok(await prisma.orders.findUnique({ where: { id: historyOrder.id } }));
  pass("table order history retains existing DINING_AREA_HAS_ORDERS protection");

  const mixedArea = await createArea(hotelA, "MIXED");
  const mixedTables = await Promise.all([createTable(hotelA, mixedArea.id, "MIXED-A"), createTable(hotelA, mixedArea.id, "MIXED-B")]);
  await createOrder(hotelA, mixedTables[1].id, "MIXED");
  const mixedRejected = await request(hotelA, mixedArea.id, { expected: 409 });
  assert.equal(mixedRejected.error.code, "DINING_AREA_HAS_ORDERS");
  assert.equal(await prisma.dining_table.count({ where: { dining_area_id: mixedArea.id } }), 2);
  pass("multiple tables with one historical order remain fully protected");

  const unrelatedArea = await createArea(hotelA, "UNRELATED");
  const unrelatedTable = await createTable(hotelA, unrelatedArea.id, "UNRELATED");
  const unrelatedBefore = await prisma.dining_table.findUniqueOrThrow({ where: { id: unrelatedTable.id } });
  const emptyArea = await createArea(hotelA, "EMPTY");
  const emptyDeleted = await request(hotelA, emptyArea.id, { role: "Manager" });
  assert.equal(emptyDeleted.status, "success");
  assert.equal(await prisma.dining_area.count({ where: { id: emptyArea.id } }), 0);
  pass("zero-table Dining Area deletion retains HTTP 200 behavior");
  assert.deepEqual(await prisma.dining_table.findUniqueOrThrow({ where: { id: unrelatedTable.id } }), unrelatedBefore);
  assert.ok(await prisma.dining_area.findUnique({ where: { id: unrelatedArea.id } }));
  pass("successful deletion removes only the selected empty Area");

  const adminArea = await createArea(hotelA, "ADMIN");
  await request(hotelA, adminArea.id, { role: "Admin" });
  assert.equal(await prisma.dining_area.count({ where: { id: adminArea.id } }), 0);
  pass("Admin authorization remains supported");

  const managerArea = await createArea(hotelA, "MANAGER");
  await request(hotelA, managerArea.id, { role: "Manager" });
  assert.equal(await prisma.dining_area.count({ where: { id: managerArea.id } }), 0);
  pass("Manager authorization remains supported");

  await request(hotelA, oneTableArea.id, { role: "Reception", expected: 403 });
  assert.ok(await prisma.dining_area.findUnique({ where: { id: oneTableArea.id } }));
  pass("Reception remains rejected");

  const foreignArea = await createArea(hotelB, "FOREIGN");
  await request(hotelB, foreignArea.id, { role: "Manager", expected: 403 });
  assert.ok(await prisma.dining_area.findUnique({ where: { id: foreignArea.id } }));
  pass("cross-hotel URL access remains rejected");

  const invalid = await request(hotelA, "not-a-uuid", { expected: 400 });
  assert.equal(invalid.error.code, "INVALID_AREA_ID");
  pass("invalid Area UUID behavior remains unchanged");

  await request(hotelA, oneTableArea.id, { role: null, expected: 401 });
  assert.ok(await prisma.dining_area.findUnique({ where: { id: oneTableArea.id } }));
  pass("authentication remains required");

  const raceArea = await createArea(hotelA, "RACE");
  const raceTableId = randomUUID();
  const connection = new Client({ connectionString: environment.databaseUrl });
  await connection.connect();
  try {
    await connection.query("BEGIN");
    await connection.query(
      "INSERT INTO dining_table (id, hotel_id, dining_area_id, table_number, capacity, status) VALUES ($1,$2,$3,$4,4,'available')",
      [raceTableId, hotelA, raceArea.id, `RACE-${raceTableId.slice(0, 8)}`],
    );
    const racingDelete = request(hotelA, raceArea.id, { expected: 409 });
    const state = await Promise.race([racingDelete.then(() => "completed"), new Promise(resolve => setTimeout(() => resolve("blocked"), 100))]);
    assert.equal(state, "blocked");
    await connection.query("COMMIT");
    const racingPayload = await racingDelete;
    assert.equal(racingPayload.error.code, "DINING_AREA_HAS_TABLES");
  } finally {
    await connection.query("ROLLBACK").catch(() => {});
    await connection.end();
  }
  assert.ok(await prisma.dining_area.findUnique({ where: { id: raceArea.id } }));
  assert.ok(await prisma.dining_table.findUnique({ where: { id: raceTableId } }));
  pass("concurrent committed Dining Table cannot race past Area deletion");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (fixture.hotelIds.length) {
    await prisma.orders.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.dining_table.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.dining_area.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.user_role.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  }
  if (fixture.userIds.length) await prisma.users.deleteMany({ where: { id: { in: fixture.userIds } } });
  await deleteHotelFixtures(fixture.hotelIds);
  assert.deepEqual(await counts(), before, "Temporary Dining Area fixtures were not completely removed");
  assert.deepEqual(await prisma.dining_area.findMany({ orderBy: { id: "asc" } }), existingAreas, "Existing Dining Area data changed");
  assert.deepEqual(await prisma.dining_table.findMany({ orderBy: { id: "asc" } }), existingTables, "Existing Dining Table data changed");
  assert.deepEqual(await prisma.orders.findMany({ orderBy: { id: "asc" } }), existingOrders, "Existing Order data changed");
  await prisma.$disconnect();
}

console.log(`Dining Area integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
