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

const models = ["hotel", "users", "user_role", "dining_area", "dining_table", "orders", "qr_code"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async (name) => [name, await prisma[name].count()])));
const before = await counts();
const existingTables = await prisma.dining_table.findMany({ orderBy: { id: "asc" } });
const existingOrders = await prisma.orders.findMany({ orderBy: { id: "asc" } });
const existingQrCodes = await prisma.qr_code.findMany({ orderBy: { id: "asc" } });
const fixture = { hotelIds: [], userIds: [] };
const results = [];
const pass = (name) => results.push(name);
let server;

try {
  const hotelA = randomUUID();
  const hotelB = randomUUID();
  fixture.hotelIds.push(hotelA, hotelB);
  await prisma.hotel.createMany({ data: [
    { id: hotelA, name: `Dining table test A ${hotelA}`, status: "ACTIVE" },
    { id: hotelB, name: `Dining table test B ${hotelB}`, status: "ACTIVE" },
  ].map(entitledHotelFixture) });

  const roles = Object.fromEntries(await Promise.all(["Admin", "Manager", "Reception"].map(async (name) => [name, await prisma.role.findUniqueOrThrow({ where: { name } })])));
  const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
  const tokens = {};
  const addUser = async (role, hotelId) => {
    const userId = randomUUID();
    const userRoleId = randomUUID();
    fixture.userIds.push(userId);
    await prisma.users.create({ data: { id: userId, name: `${role} dining-table test`, email: `${userId}@dining-table-test.invalid`, password_hash: passwordHash } });
    await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: roles[role].id, hotel_id: hotelId } });
    tokens[`${role}:${hotelId}`] = await createAuthenticationToken({ userId, userRoleId }, 600);
  };
  await addUser("Admin", hotelA);
  await addUser("Manager", hotelA);
  await addUser("Manager", hotelB);
  await addUser("Reception", hotelA);

  const areaA = await prisma.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelA, name: `DT-A-${randomUUID().slice(0, 8)}`, status: "active" } });
  const areaA2 = await prisma.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelA, name: `DT-A2-${randomUUID().slice(0, 8)}`, status: "active" } });
  const areaB = await prisma.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelB, name: `DT-B-${randomUUID().slice(0, 8)}`, status: "active" } });

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const requestResult = async (method, hotelId, path, { body, role = "Manager", tokenHotel = hotelId } = {}) => {
    const token = role ? tokens[`${role}:${tokenHotel}`] : null;
    const response = await fetch(`${origin}/api/hotels/${hotelId}${path}`, {
      method,
      headers: { ...(token ? { Cookie: `aazira_auth=${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json();
    return { status: response.status, payload };
  };
  const request = async (method, hotelId, path, { body, role = "Manager", tokenHotel = hotelId, expected = 200 } = {}) => {
    const { status, payload } = await requestResult(method, hotelId, path, { body, role, tokenHotel });
    assert.equal(status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
    return payload;
  };
  const tableBody = (capacity, tableNumber = `DT-${randomUUID().slice(0, 8)}`) => ({ dining_area_id: areaA.id, table_number: tableNumber, capacity, status: "active" });
  const getAreas = async (hotelId, { tokenHotel = hotelId } = {}) => {
    const response = await fetch(`${origin}/api/hotels/${hotelId}/dining-areas`, {
      headers: { Cookie: `aazira_auth=${tokens[`Manager:${tokenHotel}`]}` },
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    return payload.data.dining_areas;
  };

  const countAreaA = await prisma.dining_area.create({ data: {
    id: randomUUID(), hotel_id: hotelA, name: `DT-COUNT-A-${randomUUID().slice(0, 8)}`, status: "active", total_tables: 99,
  } });
  const countAreaB = await prisma.dining_area.create({ data: {
    id: randomUUID(), hotel_id: hotelB, name: `DT-COUNT-B-${randomUUID().slice(0, 8)}`, status: "active", total_tables: 99,
  } });
  const readCount = async (hotelId, areaId, options) => {
    const area = (await getAreas(hotelId, options)).find(candidate => candidate.id === areaId);
    assert.ok(area, `Dining area ${areaId} was not returned`);
    assert.equal(area.total_tables, area.tables.length);
    return area.total_tables;
  };
  assert.equal(await readCount(hotelA, countAreaA.id), 0);
  pass("an empty area reports zero from its authoritative table collection even when the legacy counter is stale");

  const countNumberA = `COUNT-A-${randomUUID().slice(0, 8)}`;
  const countTableA = (await request("POST", hotelA, "/dining-tables", { body: {
    dining_area_id: countAreaA.id, table_number: countNumberA, capacity: 4, status: "available",
  }, expected: 201 })).data.dining_table;
  assert.equal(await readCount(hotelA, countAreaA.id), 1);
  assert.equal(await prisma.dining_table.count({ where: { dining_area_id: countAreaA.id } }), 1);
  pass("creating one table immediately and persistently reports one table");

  const countNumberB = `COUNT-B-${randomUUID().slice(0, 8)}`;
  const countTableB = (await request("POST", hotelA, "/dining-tables", { body: {
    dining_area_id: countAreaA.id, table_number: countNumberB, capacity: 6, status: "available",
  }, expected: 201 })).data.dining_table;
  assert.equal(await readCount(hotelA, countAreaA.id), 2);
  assert.equal(await prisma.dining_table.count({ where: { dining_area_id: countAreaA.id } }), 2);
  pass("creating a second table reports two and returns both persisted records");

  const rejectedCountCreate = await request("POST", hotelA, "/dining-tables", { body: {
    dining_area_id: countAreaA.id, table_number: countNumberB, capacity: 6, status: "available",
  }, expected: 409 });
  assert.equal(rejectedCountCreate.error.code, "DINING_TABLE_NUMBER_CONFLICT");
  assert.equal(await readCount(hotelA, countAreaA.id), 2);
  pass("a failed table creation leaves the authoritative count unchanged");

  await request("POST", hotelB, "/dining-tables", { body: {
    dining_area_id: countAreaB.id, table_number: `FOREIGN-${randomUUID().slice(0, 8)}`, capacity: 4, status: "available",
  }, tokenHotel: hotelA, expected: 403 });
  assert.equal(await readCount(hotelB, countAreaB.id), 0);
  pass("cross-hotel rejection cannot change another area's table count");

  await request("DELETE", hotelA, `/dining-tables/${countTableA.id}`);
  assert.equal(await readCount(hotelA, countAreaA.id), 1);
  assert.equal(await prisma.dining_table.count({ where: { dining_area_id: countAreaA.id } }), 1);
  pass("deleting one of two tables immediately and persistently reports one table");

  await request("DELETE", hotelA, `/dining-tables/${countTableB.id}`);
  assert.equal(await readCount(hotelA, countAreaA.id), 0);
  assert.equal(await prisma.dining_table.count({ where: { dining_area_id: countAreaA.id } }), 0);
  pass("deleting the final table reports zero after a fresh request lifecycle");

  const sharedAcrossAreas = `AREA-SHARED-${randomUUID().slice(0, 8)}`;
  const [areaACreate, areaA2Create] = await Promise.all([
    request("POST", hotelA, "/dining-tables", { body: tableBody(4, sharedAcrossAreas), expected: 201 }),
    request("POST", hotelA, "/dining-tables", { body: { ...tableBody(4, sharedAcrossAreas), dining_area_id: areaA2.id }, expected: 201 }),
  ]);
  assert.notEqual(areaACreate.data.dining_table.id, areaA2Create.data.dining_table.id);
  assert.equal(await prisma.dining_table.count({ where: { hotel_id: hotelA, table_number: sharedAcrossAreas } }), 2);
  pass("the same table number can be created concurrently in two dining areas of one hotel");

  const duplicateInArea = await request("POST", hotelA, "/dining-tables", { body: tableBody(4, sharedAcrossAreas), expected: 409 });
  assert.equal(duplicateInArea.error.code, "DINING_TABLE_NUMBER_CONFLICT");
  pass("the same table number remains rejected within one dining area");

  const sameAreaRenameTarget = (await request("POST", hotelA, "/dining-tables", { body: tableBody(4), expected: 201 })).data.dining_table;
  const rejectedRename = await request("PATCH", hotelA, `/dining-tables/${sameAreaRenameTarget.id}`, { body: { table_number: sharedAcrossAreas }, expected: 409 });
  assert.equal(rejectedRename.error.code, "DINING_TABLE_NUMBER_CONFLICT");
  assert.equal((await prisma.dining_table.findUniqueOrThrow({ where: { id: sameAreaRenameTarget.id } })).table_number, sameAreaRenameTarget.table_number);
  pass("PATCH table-number changes remain unique within the persisted dining area");

  const concurrentNumber = `AREA-RACE-${randomUUID().slice(0, 8)}`;
  const concurrentCreates = await Promise.all([
    requestResult("POST", hotelA, "/dining-tables", { body: tableBody(4, concurrentNumber) }),
    requestResult("POST", hotelA, "/dining-tables", { body: tableBody(4, concurrentNumber) }),
  ]);
  assert.deepEqual(concurrentCreates.map(({ status }) => status).sort((a, b) => a - b), [201, 409]);
  assert.equal(concurrentCreates.find(({ status }) => status === 409).payload.error.code, "DINING_TABLE_NUMBER_CONFLICT");
  assert.equal(await prisma.dining_table.count({ where: { hotel_id: hotelA, dining_area_id: areaA.id, table_number: concurrentNumber } }), 1);
  pass("concurrent same-area creation yields one success and one controlled conflict");

  const moveNumber = `AREA-MOVE-${randomUUID().slice(0, 8)}`;
  const moveSource = (await request("POST", hotelA, "/dining-tables", { body: tableBody(4, moveNumber), expected: 201 })).data.dining_table;
  const moveTarget = (await request("POST", hotelA, "/dining-tables", { body: { ...tableBody(4, moveNumber), dining_area_id: areaA2.id }, expected: 201 })).data.dining_table;
  const rejectedMove = await request("PATCH", hotelA, `/dining-tables/${moveSource.id}`, { body: { dining_area_id: areaA2.id }, expected: 409 });
  assert.equal(rejectedMove.error.code, "DINING_TABLE_NUMBER_CONFLICT");
  assert.equal((await prisma.dining_table.findUniqueOrThrow({ where: { id: moveSource.id } })).dining_area_id, areaA.id);
  assert.equal((await prisma.dining_table.findUniqueOrThrow({ where: { id: moveTarget.id } })).dining_area_id, areaA2.id);
  pass("PATCH validates the effective dining-area and table-number combination and preserves rejected moves");

  const successfulMoveNumber = `AREA-MOVE-OK-${randomUUID().slice(0, 8)}`;
  const successfulMoveSource = (await request("POST", hotelA, "/dining-tables", { body: tableBody(4, successfulMoveNumber), expected: 201 })).data.dining_table;
  const successfulMove = (await request("PATCH", hotelA, `/dining-tables/${successfulMoveSource.id}`, { body: { dining_area_id: areaA2.id } })).data.dining_table;
  assert.equal(successfulMove.dining_area_id, areaA2.id);
  assert.equal(successfulMove.table_number, successfulMoveNumber);
  pass("PATCH can move a table when its effective area/table number is available");

  const raceMoveNumber = `AREA-MOVE-RACE-${randomUUID().slice(0, 8)}`;
  const raceMoveSource = (await request("POST", hotelA, "/dining-tables", { body: tableBody(4, raceMoveNumber), expected: 201 })).data.dining_table;
  const moveAndCreate = await Promise.all([
    requestResult("PATCH", hotelA, `/dining-tables/${raceMoveSource.id}`, { body: { dining_area_id: areaA2.id } }),
    requestResult("POST", hotelA, "/dining-tables", { body: { ...tableBody(4, raceMoveNumber), dining_area_id: areaA2.id } }),
  ]);
  assert.equal(moveAndCreate.filter(({ status }) => status === 409).length, 1);
  assert.ok([200, 201].includes(moveAndCreate.find(({ status }) => status !== 409).status));
  assert.equal(moveAndCreate.find(({ status }) => status === 409).payload.error.code, "DINING_TABLE_NUMBER_CONFLICT");
  assert.equal(await prisma.dining_table.count({ where: { hotel_id: hotelA, dining_area_id: areaA2.id, table_number: raceMoveNumber } }), 1);
  pass("concurrent move/create cannot produce a duplicate effective area/table number");

  const initialCount = await prisma.dining_table.count({ where: { hotel_id: hotelA } });
  for (const capacity of [2147483648, -2147483649]) {
    const payload = await request("POST", hotelA, "/dining-tables", { body: tableBody(capacity), expected: 400 });
    assert.equal(payload.error.code, "INVALID_DINING_TABLE_CAPACITY");
  }
  assert.equal(await prisma.dining_table.count({ where: { hotel_id: hotelA } }), initialCount);
  pass("out-of-range CREATE capacities return 400 and create no rows");

  for (const capacity of [0, -1, 1.5, "2"]) {
    const payload = await request("POST", hotelA, "/dining-tables", { body: tableBody(capacity), expected: 400 });
    assert.equal(payload.error.code, "INVALID_DINING_TABLE_CAPACITY");
  }
  assert.equal(await prisma.dining_table.count({ where: { hotel_id: hotelA } }), initialCount);
  pass("existing invalid capacity types and values remain rejected");

  const maximum = (await request("POST", hotelA, "/dining-tables", { body: tableBody(2147483647), expected: 201 })).data.dining_table;
  assert.equal(maximum.capacity, 2147483647);
  assert.equal((await prisma.dining_table.findUniqueOrThrow({ where: { id: maximum.id } })).capacity, 2147483647);
  pass("PostgreSQL INTEGER maximum remains accepted on CREATE");

  const patchTarget = (await request("POST", hotelA, "/dining-tables", { body: tableBody(4), role: "Admin", expected: 201 })).data.dining_table;
  for (const capacity of [2147483648, -2147483649]) {
    const payload = await request("PATCH", hotelA, `/dining-tables/${patchTarget.id}`, { body: { capacity }, expected: 400 });
    assert.equal(payload.error.code, "INVALID_DINING_TABLE_CAPACITY");
    assert.equal((await prisma.dining_table.findUniqueOrThrow({ where: { id: patchTarget.id } })).capacity, 4);
  }
  pass("out-of-range PATCH capacities return 400 and preserve the stored capacity");

  const updated = (await request("PATCH", hotelA, `/dining-tables/${patchTarget.id}`, { body: { capacity: 2147483647 } })).data.dining_table;
  assert.equal(updated.capacity, 2147483647);
  assert.equal((await prisma.dining_table.findUniqueOrThrow({ where: { id: patchTarget.id } })).capacity, 2147483647);
  pass("PostgreSQL INTEGER maximum remains accepted on PATCH");

  await request("POST", hotelA, "/dining-tables", { body: tableBody(2), role: null, expected: 401 });
  await request("POST", hotelA, "/dining-tables", { body: tableBody(2), role: "Reception", expected: 403 });
  await request("POST", hotelB, "/dining-tables", { body: { ...tableBody(2), dining_area_id: areaB.id }, tokenHotel: hotelA, expected: 403 });
  const adminTable = (await request("POST", hotelA, "/dining-tables", { body: tableBody(2), role: "Admin", expected: 201 })).data.dining_table;
  assert.equal(adminTable.hotel_id, hotelA);
  pass("authentication, Admin/Manager authorization, and hotel scope remain enforced");

  const createTable = async (label, role = "Manager") => (await request("POST", hotelA, "/dining-tables", {
    body: tableBody(4, `DEL-${label}-${randomUUID().slice(0, 8)}`), role, expected: 201,
  })).data.dining_table;
  const createQr = async (table, isActive = true) => prisma.qr_code.create({ data: {
    id: randomUUID(), hotel_id: hotelA, code: `DT-DELETE-${randomUUID()}`, type: "dining_table",
    dining_table_id: table.id, is_active: isActive,
  } });
  const createOrder = async (table) => prisma.orders.create({ data: {
    id: randomUUID(), hotel_id: hotelA, table_id: table.id, order_number: `DT-DEL-${randomUUID()}`,
    source: "captain", customer_name: "Dining Table deletion test", customer_phone: "0000000000",
    status: "completed", subtotal: "0.00", tax_amount: "0.00", discount_amount: "0.00",
    total_amount: "0.00", payment_status: "pending",
  } });

  const qrTable = await createTable("qr");
  const qr = await createQr(qrTable);
  const qrTableBefore = await prisma.dining_table.findUniqueOrThrow({ where: { id: qrTable.id } });
  const qrDelete = await request("DELETE", hotelA, `/dining-tables/${qrTable.id}`, { expected: 409 });
  assert.equal(qrDelete.error.code, "DINING_TABLE_HAS_DEPENDENCIES");
  assert.deepEqual(await prisma.dining_table.findUniqueOrThrow({ where: { id: qrTable.id } }), qrTableBefore);
  assert.equal((await prisma.qr_code.findUniqueOrThrow({ where: { id: qr.id } })).dining_table_id, qrTable.id);
  pass("an existing QR returns 409 and preserves the Dining Table, its configuration, and QR linkage");

  const inactiveQrTable = await createTable("inactive-qr", "Admin");
  const inactiveQr = await createQr(inactiveQrTable, false);
  const inactiveQrDelete = await request("DELETE", hotelA, `/dining-tables/${inactiveQrTable.id}`, { role: "Admin", expected: 409 });
  assert.equal(inactiveQrDelete.error.code, "DINING_TABLE_HAS_DEPENDENCIES");
  assert.equal((await prisma.qr_code.findUniqueOrThrow({ where: { id: inactiveQr.id } })).is_active, false);
  pass("inactive QR configuration remains a protected dependency for Admin deletion");

  const orderTable = await createTable("order");
  const order = await createOrder(orderTable);
  const orderDelete = await request("DELETE", hotelA, `/dining-tables/${orderTable.id}`, { expected: 409 });
  assert.equal(orderDelete.error.code, "DINING_TABLE_HAS_DEPENDENCIES");
  assert.ok(await prisma.dining_table.findUnique({ where: { id: orderTable.id } }));
  assert.equal((await prisma.orders.findUniqueOrThrow({ where: { id: order.id } })).table_id, orderTable.id);
  pass("an existing order retains the established dependency rejection and linkage");

  const combinedTable = await createTable("combined");
  const combinedOrder = await createOrder(combinedTable);
  const combinedQr = await createQr(combinedTable);
  const combinedDelete = await request("DELETE", hotelA, `/dining-tables/${combinedTable.id}`, { expected: 409 });
  assert.equal(combinedDelete.error.code, "DINING_TABLE_HAS_DEPENDENCIES");
  assert.match(combinedDelete.error.message, /orders and a QR code/);
  assert.equal((await prisma.orders.findUniqueOrThrow({ where: { id: combinedOrder.id } })).table_id, combinedTable.id);
  assert.equal((await prisma.qr_code.findUniqueOrThrow({ where: { id: combinedQr.id } })).dining_table_id, combinedTable.id);
  pass("combined order and QR dependencies retain their established precedence and remain intact");

  const managerEmptyTable = await createTable("manager-empty");
  const managerDeleted = await request("DELETE", hotelA, `/dining-tables/${managerEmptyTable.id}`);
  assert.equal(managerDeleted.data.dining_table.id, managerEmptyTable.id);
  assert.equal(await prisma.dining_table.findUnique({ where: { id: managerEmptyTable.id } }), null);
  const adminEmptyTable = await createTable("admin-empty", "Admin");
  const adminDeleted = await request("DELETE", hotelA, `/dining-tables/${adminEmptyTable.id}`, { role: "Admin" });
  assert.equal(adminDeleted.data.dining_table.id, adminEmptyTable.id);
  assert.equal(await prisma.dining_table.findUnique({ where: { id: adminEmptyTable.id } }), null);
  pass("dependency-free Dining Tables remain deletable by Manager and Admin");

  const protectedTable = await createTable("protected");
  await request("DELETE", hotelA, `/dining-tables/${protectedTable.id}`, { role: "Reception", expected: 403 });
  await request("DELETE", hotelB, `/dining-tables/${protectedTable.id}`, { tokenHotel: hotelA, expected: 403 });
  const invalidDelete = await request("DELETE", hotelA, "/dining-tables/not-a-uuid", { expected: 400 });
  assert.equal(invalidDelete.error.code, "INVALID_TABLE_ID");
  await request("DELETE", hotelA, `/dining-tables/${protectedTable.id}`, { role: null, expected: 401 });
  assert.ok(await prisma.dining_table.findUnique({ where: { id: protectedTable.id } }));
  pass("deletion preserves Reception rejection, hotel scope, UUID validation, and authentication");

  const raceTable = await createTable("race");
  const raceQrId = randomUUID();
  const connection = new Client({ connectionString: environment.databaseUrl });
  await connection.connect();
  try {
    await connection.query("BEGIN");
    await connection.query(
      "INSERT INTO qr_code (id, hotel_id, code, type, dining_table_id, is_active) VALUES ($1,$2,$3,'dining_table',$4,true)",
      [raceQrId, hotelA, `DT-RACE-${randomUUID()}`, raceTable.id],
    );
    const racingDelete = request("DELETE", hotelA, `/dining-tables/${raceTable.id}`, { expected: 409 });
    const state = await Promise.race([racingDelete.then(() => "completed"), new Promise(resolve => setTimeout(() => resolve("blocked"), 100))]);
    assert.equal(state, "blocked");
    await connection.query("COMMIT");
    const payload = await racingDelete;
    assert.equal(payload.error.code, "DINING_TABLE_HAS_DEPENDENCIES");
  } finally {
    await connection.query("ROLLBACK").catch(() => {});
    await connection.end();
  }
  assert.ok(await prisma.dining_table.findUnique({ where: { id: raceTable.id } }));
  assert.equal((await prisma.qr_code.findUniqueOrThrow({ where: { id: raceQrId } })).dining_table_id, raceTable.id);
  pass("concurrent committed QR creation is observed before deletion and returns controlled 409 without cascade loss");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixture.hotelIds.length) {
    await prisma.orders.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.qr_code.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.dining_table.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.dining_area.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.user_role.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  }
  if (fixture.userIds.length) await prisma.users.deleteMany({ where: { id: { in: fixture.userIds } } });
  await deleteHotelFixtures(fixture.hotelIds);
  assert.deepEqual(await counts(), before, "Temporary Dining Table fixtures were not completely removed");
  assert.deepEqual(await prisma.dining_table.findMany({ orderBy: { id: "asc" } }), existingTables, "Existing Dining Table data changed");
  assert.deepEqual(await prisma.orders.findMany({ orderBy: { id: "asc" } }), existingOrders, "Existing Order data changed");
  assert.deepEqual(await prisma.qr_code.findMany({ orderBy: { id: "asc" } }), existingQrCodes, "Existing QR Code data changed");
  await prisma.$disconnect();
}

console.log(`Dining Table integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
