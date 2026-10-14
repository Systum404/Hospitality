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

const models = ["hotel", "users", "user_role", "inventory", "notification"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async (name) => [name, await prisma[name].count()])));
const fixture = { hotelIds: [], userIds: [] };
const before = await counts();
const existingInventory = await prisma.inventory.findMany({ orderBy: { id: "asc" } });
const results = [];
const pass = (name) => results.push(name);
let server;

try {
  const hotelA = randomUUID();
  const hotelB = randomUUID();
  fixture.hotelIds.push(hotelA, hotelB);
  await prisma.hotel.createMany({
    data: [
  { id: hotelA, name: `Inventory test A ${hotelA}`, status: "ACTIVE" },
  { id: hotelB, name: `Inventory test B ${hotelB}`, status: "ACTIVE" },
    ].map(entitledHotelFixture),
  });

  const roles = Object.fromEntries(await Promise.all(
    ["Admin", "Manager", "Reception"].map(async (name) => [name, await prisma.role.findUniqueOrThrow({ where: { name } })]),
  ));
  const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
  const tokens = {};
  const addUser = async (role, hotelId, { active = true } = {}) => {
    const userId = randomUUID();
    const userRoleId = randomUUID();
    fixture.userIds.push(userId);
    await prisma.users.create({
      data: { id: userId, name: `${role} inventory test`, email: `${userId}@inventory-test.invalid`, password_hash: passwordHash, is_active: active },
    });
    await prisma.user_role.create({
      data: { id: userRoleId, user_id: userId, role_id: roles[role].id, hotel_id: hotelId },
    });
    if (active) {
      tokens[`${role}:${hotelId}`] = await createAuthenticationToken({ userId, userRoleId }, 600);
    }
    return userId;
  };
  await addUser("Admin", hotelA);
  await addUser("Admin", hotelB);
  const managerOne = await addUser("Manager", hotelA);
  const managerTwo = await addUser("Manager", hotelA);
  const inactiveManager = await addUser("Manager", hotelA, { active: false });
  const otherHotelManager = await addUser("Manager", hotelB);
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

  const startingCount = await prisma.inventory.count({ where: { hotel_id: hotelA } });
  for (const date of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-01-00", "2026-04-31"]) {
    const payload = await request("POST", hotelA, "/inventory", {
      body: { name: `Rejected ${date}`, last_restocked: date },
      expected: 400,
    });
    assert.equal(payload.error.code, "INVALID_INVENTORY");
  }
  assert.equal(await prisma.inventory.count({ where: { hotel_id: hotelA } }), startingCount);
  pass("nonexistent calendar dates on create return 400 INVALID_INVENTORY and create no rows");

  const leap = (await request("POST", hotelA, "/inventory", {
    body: { name: `Leap ${randomUUID()}`, last_restocked: "2028-02-29" },
    expected: 201,
  })).data.inventory_item;
  assert.equal(leap.last_restocked, "2028-02-29");
  const normal = (await request("POST", hotelA, "/inventory", {
    body: { name: `Normal ${randomUUID()}`, last_restocked: "2026-09-10" },
    role: "Manager",
    expected: 201,
  })).data.inventory_item;
  assert.equal(normal.last_restocked, "2026-09-10");
  const omitted = (await request("POST", hotelA, "/inventory", {
    body: { name: `Omitted ${randomUUID()}` },
    expected: 201,
  })).data.inventory_item;
  assert.equal(omitted.last_restocked, null);
  pass("leap-day, normal-date, and omitted-date create behavior remains valid");

  for (const date of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-01-00", "2026-04-31"]) {
    const payload = await request("PATCH", hotelA, `/inventory/${normal.id}`, {
      body: { last_restocked: date },
      expected: 400,
    });
    assert.equal(payload.error.code, "INVALID_INVENTORY");
    assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: normal.id } })).last_restocked.toISOString().slice(0, 10), "2026-09-10");
  }
  pass("nonexistent calendar dates on update return 400 and preserve the stored date");

  const patchedLeap = await request("PATCH", hotelA, `/inventory/${normal.id}`, { body: { last_restocked: "2028-02-29" } });
  assert.equal(patchedLeap.data.inventory_item.last_restocked, "2028-02-29");
  const patchedNull = await request("PATCH", hotelA, `/inventory/${normal.id}`, { body: { last_restocked: null } });
  assert.equal(patchedNull.data.inventory_item.last_restocked, null);
  assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: normal.id } })).last_restocked, null);
  pass("valid-date and null updates retain their existing behavior");

  const thresholdItem = (await request("POST", hotelA, "/inventory", {
    body: { name: `Threshold ${randomUUID()}`, quantity: "6.00", minimum_quantity: "5.00", unit: "kg" },
    expected: 201,
  })).data.inventory_item;
  const lowStockRows = () => prisma.notification.findMany({
    where: { hotel_id: hotelA, event_key: { startsWith: `inventory-low:${thresholdItem.id}:` } },
    orderBy: [{ event_key: "asc" }, { user_id: "asc" }],
  });
  assert.equal((await lowStockRows()).length, 0);
  await request("PATCH", hotelA, `/inventory/${thresholdItem.id}`, { body: { quantity: "7.00" } });
  assert.equal((await lowStockRows()).length, 0);
  pass("creation and above-threshold updates do not create low-stock notifications");

  await request("PATCH", hotelA, `/inventory/${thresholdItem.id}`, { body: { quantity: "5.00" } });
  let rows = await lowStockRows();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.user_id).sort(), [managerOne, managerTwo].sort());
  assert.ok(rows.every(row => row.type === "manager_operational" && row.title === "Low Stock Alert" && row.message.includes(thresholdItem.name)));
  assert.ok(!rows.some(row => [inactiveManager, otherHotelManager].includes(row.user_id)));
  pass("a threshold crossing notifies each active same-hotel Manager exactly once");

  await request("PATCH", hotelA, `/inventory/${thresholdItem.id}`, { body: { quantity: "4.00" } });
  assert.equal((await lowStockRows()).length, 2);
  await request("PATCH", hotelA, `/inventory/${thresholdItem.id}`, { body: { quantity: "6.00" } });
  assert.equal((await lowStockRows()).length, 2);
  await request("PATCH", hotelA, `/inventory/${thresholdItem.id}`, { body: { quantity: "5.00" } });
  rows = await lowStockRows();
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map(row => row.event_key)).size, 2);
  await request("PATCH", hotelA, `/inventory/${thresholdItem.id}`, { body: { quantity: "5.00" } });
  assert.equal((await lowStockRows()).length, 4);
  pass("low-stock edits do not duplicate and recovery permits a new crossing episode");

  await request("PATCH", hotelA, `/inventory/${thresholdItem.id}`, { body: { quantity: "6.00" } });
  const failed = await request("PATCH", hotelA, `/inventory/${thresholdItem.id}`, { body: { quantity: "5.00", supplier_id: randomUUID() }, expected: 404 });
  assert.equal(failed.error.code, "VENDOR_NOT_FOUND");
  assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: thresholdItem.id } })).quantity.toFixed(2), "6.00");
  assert.equal((await lowStockRows()).length, 4);
  pass("failed inventory mutation preserves stock and creates no notification");

  const concurrent = await Promise.all([
    request("PATCH", hotelA, `/inventory/${thresholdItem.id}`, { body: { quantity: "5.00" } }),
    request("PATCH", hotelA, `/inventory/${thresholdItem.id}`, { body: { quantity: "4.00" } }),
  ]);
  assert.equal(concurrent.length, 2);
  rows = await lowStockRows();
  assert.equal(rows.length, 6);
  assert.equal(new Set(rows.map(row => row.event_key)).size, 3);
  for (const eventKey of new Set(rows.map(row => row.event_key))) {
    assert.deepEqual(rows.filter(row => row.event_key === eventKey).map(row => row.user_id).sort(), [managerOne, managerTwo].sort());
  }
  pass("concurrent low-stock updates serialize into one notification episode per Manager");

  await request("GET", hotelB, "/inventory", { tokenHotel: hotelA, expected: 403 });
  await request("POST", hotelA, "/inventory", {
    body: { name: "Unauthorized inventory" },
    role: "Reception",
    expected: 403,
  });
  await request("POST", hotelA, "/inventory", {
    body: { name: "Unauthenticated inventory" },
    role: null,
    expected: 401,
  });
  assert.equal(await prisma.inventory.count({ where: { hotel_id: hotelB } }), 0);
  pass("authentication, Admin/Manager authorization, and hotel scope remain enforced");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixture.hotelIds.length) {
    await prisma.notification.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.inventory.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.user_role.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  }
  if (fixture.userIds.length) await prisma.users.deleteMany({ where: { id: { in: fixture.userIds } } });
  await deleteHotelFixtures(fixture.hotelIds);
  assert.deepEqual(await counts(), before, "Temporary Inventory fixtures were not completely removed");
  assert.deepEqual(await prisma.inventory.findMany({ orderBy: { id: "asc" } }), existingInventory, "Existing Inventory data changed");
  await prisma.$disconnect();
}

console.log(`Inventory integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
