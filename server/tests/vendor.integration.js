// Explicit local-only integration test. Fixtures are isolated and removed in finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import pg from "pg";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";
import { deleteHotelFixtures } from "./helpers/hotelFixtureCleanup.js";

const { Client } = pg;
const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Local hms only");

const models = ["hotel", "users", "user_role", "vendor", "inventory"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const existingVendors = await prisma.vendor.findMany({ orderBy: { id: "asc" } });
const existingInventory = await prisma.inventory.findMany({ orderBy: { id: "asc" } });
const fixture = { hotelIds: [], userIds: [] };
const results = [];
const pass = name => results.push(name);
let server;

try {
  const hotelA = randomUUID();
  const hotelB = randomUUID();
  fixture.hotelIds.push(hotelA, hotelB);
  await prisma.hotel.createMany({ data: [
    { id: hotelA, name: `Vendor test A ${hotelA}`, status: "ACTIVE" },
    { id: hotelB, name: `Vendor test B ${hotelB}`, status: "ACTIVE" },
  ].map(entitledHotelFixture) });

  const roles = Object.fromEntries(await Promise.all(["Admin", "Manager", "Reception"].map(async name => [name, await prisma.role.findUniqueOrThrow({ where: { name } })])));
  const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
  const tokens = {};
  const addActor = async (role, hotelId) => {
    const userId = randomUUID();
    const userRoleId = randomUUID();
    fixture.userIds.push(userId);
    await prisma.users.create({ data: { id: userId, name: `${role} vendor test`, email: `${userId}@vendor-test.invalid`, password_hash: passwordHash } });
    await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: roles[role].id, hotel_id: hotelId } });
    tokens[`${role}:${hotelId}`] = await createAuthenticationToken({ userId, userRoleId }, 600);
  };
  await addActor("Admin", hotelA);
  await addActor("Manager", hotelA);
  await addActor("Manager", hotelB);
  await addActor("Reception", hotelA);

  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, hotelId, path, { body, role = "Admin", tokenHotel = hotelId, expected = 200 } = {}) => {
    const token = role ? tokens[`${role}:${tokenHotel}`] : null;
    const response = await fetch(`${origin}/api/hotels/${hotelId}${path}`, {
      method,
      headers: { ...(token ? { Cookie: `aazira_auth=${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
    return payload;
  };
  const createVendor = async (hotelId, label, options = {}) => (await request("POST", hotelId, "/vendors", {
    body: { name: `Vendor ${label} ${randomUUID()}`, contact_person: null, phone: null, email: null },
    expected: 201,
    ...options,
  })).data.vendor;
  const createInventory = (hotelId, vendorId, label) => prisma.inventory.create({
    data: { id: randomUUID(), hotel_id: hotelId, name: `Inventory ${label} ${randomUUID()}`, supplier_id: vendorId },
  });

  const referenced = await createVendor(hotelA, "REFERENCED");
  const inventory = await createInventory(hotelA, referenced.id, "REFERENCED");
  const referencedBefore = await prisma.vendor.findUniqueOrThrow({ where: { id: referenced.id } });
  const rejected = await request("DELETE", hotelA, `/vendors/${referenced.id}`, { role: "Manager", expected: 409 });
  assert.equal(rejected.error.code, "VENDOR_HAS_INVENTORY");
  assert.deepEqual(await prisma.vendor.findUniqueOrThrow({ where: { id: referenced.id } }), referencedBefore);
  assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).supplier_id, referenced.id);
  pass("one Inventory reference returns 409 and preserves Vendor and supplier_id for Manager");

  const multiple = await createVendor(hotelA, "MULTIPLE");
  await request("PATCH", hotelA, `/vendors/${multiple.id}/status`, { body: { is_active: false } });
  const multipleInventory = await Promise.all([createInventory(hotelA, multiple.id, "MULTIPLE-A"), createInventory(hotelA, multiple.id, "MULTIPLE-B")]);
  const multipleDelete = await request("DELETE", hotelA, `/vendors/${multiple.id}`, { expected: 409 });
  assert.equal(multipleDelete.error.code, "VENDOR_HAS_INVENTORY");
  assert.equal((await prisma.vendor.findUniqueOrThrow({ where: { id: multiple.id } })).is_active, false);
  assert.deepEqual((await prisma.inventory.findMany({ where: { id: { in: multipleInventory.map(row => row.id) } }, orderBy: { id: "asc" } })).map(row => row.supplier_id), [multiple.id, multiple.id]);
  pass("multiple Inventory references protect an inactive Vendor and preserve every supplier_id for Admin");

  const unreferenced = await createVendor(hotelA, "UNREFERENCED");
  await request("DELETE", hotelA, `/vendors/${unreferenced.id}`);
  assert.equal(await prisma.vendor.count({ where: { id: unreferenced.id } }), 0);
  pass("unreferenced Vendor deletion retains HTTP 200 behavior");

  const foreign = await createVendor(hotelB, "FOREIGN", { role: "Manager", tokenHotel: hotelB });
  await request("DELETE", hotelB, `/vendors/${foreign.id}`, { tokenHotel: hotelA, expected: 403 });
  await request("DELETE", hotelA, `/vendors/${referenced.id}`, { role: "Reception", expected: 403 });
  await request("DELETE", hotelA, `/vendors/${referenced.id}`, { role: null, expected: 401 });
  const invalid = await request("DELETE", hotelA, "/vendors/not-a-uuid", { expected: 400 });
  assert.equal(invalid.error.code, "INVALID_VENDOR_ID");
  assert.ok(await prisma.vendor.findUnique({ where: { id: foreign.id } }));
  pass("authentication, Admin/Manager authorization, Reception rejection, hotel scope, and UUID validation remain enforced");

  const raceVendor = await createVendor(hotelA, "RACE");
  const raceInventoryId = randomUUID();
  const connection = new Client({ connectionString: environment.databaseUrl });
  await connection.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("INSERT INTO inventory (id, hotel_id, name, supplier_id) VALUES ($1, $2, $3, $4)", [raceInventoryId, hotelA, `Inventory race ${randomUUID()}`, raceVendor.id]);
    const racingDelete = request("DELETE", hotelA, `/vendors/${raceVendor.id}`, { expected: 409 });
    const state = await Promise.race([racingDelete.then(() => "completed"), new Promise(resolve => setTimeout(() => resolve("blocked"), 100))]);
    assert.equal(state, "blocked");
    await connection.query("COMMIT");
    const racingPayload = await racingDelete;
    assert.equal(racingPayload.error.code, "VENDOR_HAS_INVENTORY");
  } finally {
    await connection.query("ROLLBACK").catch(() => {});
    await connection.end();
  }
  assert.ok(await prisma.vendor.findUnique({ where: { id: raceVendor.id } }));
  assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: raceInventoryId } })).supplier_id, raceVendor.id);
  pass("concurrent committed Inventory reference cannot race past Vendor deletion");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (fixture.hotelIds.length) {
    await prisma.inventory.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.vendor.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.user_role.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  }
  if (fixture.userIds.length) await prisma.users.deleteMany({ where: { id: { in: fixture.userIds } } });
  await deleteHotelFixtures(fixture.hotelIds);
  assert.deepEqual(await counts(), before, "Temporary Vendor fixtures were not completely removed");
  assert.deepEqual(await prisma.vendor.findMany({ orderBy: { id: "asc" } }), existingVendors, "Existing Vendor data changed");
  assert.deepEqual(await prisma.inventory.findMany({ orderBy: { id: "asc" } }), existingInventory, "Existing Inventory data changed");
  await prisma.$disconnect();
}

console.log(`Vendor integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
