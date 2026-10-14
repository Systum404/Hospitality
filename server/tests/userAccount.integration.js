// Explicit local-only integration test. Fixtures are isolated and removed in finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { HOTEL_PLANS } from "../config/hotelPlans.js";
import { ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { createAuthenticationToken } from "../services/tokenService.js";

const target = new URL(environment.databaseUrl);
const isolatedEntitlementRegression = process.env.AAZIRA_ISOLATED_ENTITLEMENT_REGRESSION_TEST === "1"
  && target.pathname.startsWith("/hms_entitlement_regression_");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && (target.pathname === "/hms" || isolatedEntitlementRegression), "Local hms only");

const models = ["hotel", "users", "user_role"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async (name) => [name, await prisma[name].count()])));
const before = await counts();
const existingUsers = await prisma.users.findMany({ orderBy: { id: "asc" } });
const existingAssignments = await prisma.user_role.findMany({ orderBy: { id: "asc" } });
const fixture = { hotelIds: [], userIds: [] };
const results = [];
const pass = (name) => results.push(name);
let server;

try {
  if (isolatedEntitlementRegression) {
    for (const [system_key, name] of [[ROLE_KEYS.HOTEL_ADMIN, "Admin"], [ROLE_KEYS.MANAGER, "Manager"], [ROLE_KEYS.RECEPTION, "Reception"]]) {
      await prisma.role.upsert({ where: { system_key }, update: {}, create: { is_protected: true, name, scope: ROLE_SCOPES.HOTEL, system_key } });
    }
  }
  const hotelA = randomUUID();
  const hotelB = randomUUID();
  fixture.hotelIds.push(hotelA, hotelB);
  await prisma.hotel.createMany({ data: [
    { id: hotelA, name: `User account test A ${hotelA}`, plan: HOTEL_PLANS.PREMIUM, status: "ACTIVE" },
    { id: hotelB, name: `User account test B ${hotelB}`, plan: HOTEL_PLANS.PREMIUM, status: "ACTIVE" },
  ] });

  const roles = Object.fromEntries(await Promise.all(["Admin", "Manager", "Reception"].map(async (name) => [name, await prisma.role.findUniqueOrThrow({ where: { name } })])));
  const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
  const tokens = {};
  const addActor = async (role, hotelId) => {
    const userId = randomUUID();
    const userRoleId = randomUUID();
    fixture.userIds.push(userId);
    await prisma.users.create({ data: { id: userId, name: `${role} user-account test`, email: `${userId}@user-account-test.invalid`, password_hash: passwordHash } });
    await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: roles[role].id, hotel_id: hotelId } });
    tokens[`${role}:${hotelId}`] = await createAuthenticationToken({ userId, userRoleId }, 600);
  };
  await addActor("Admin", hotelA);
  await addActor("Admin", hotelB);
  await addActor("Manager", hotelA);

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, hotelId, path, { body, role = "Admin", tokenHotel = hotelId, expected = 200 } = {}) => {
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
  const uniqueEmail = (label) => `${label}-${randomUUID()}@user-account-test.invalid`;
  const createBody = (roleId, label = "candidate") => ({
    name: `User Account ${label}`,
    email: uniqueEmail(label),
    password: randomUUID(),
    role_id: roleId,
    is_active: true,
  });

  const failedCreate = createBody(2147483648, "overflow");
  const createCounts = await counts();
  const createOverflow = await request("POST", hotelA, "/users", { body: failedCreate, expected: 400 });
  assert.equal(createOverflow.error.code, "INVALID_USER_ACCOUNT");
  assert.equal(await prisma.users.count({ where: { email: failedCreate.email } }), 0);
  assert.deepEqual(await counts(), createCounts);
  pass("POST role_id above PostgreSQL INTEGER maximum returns INVALID_USER_ACCOUNT without partial records");

  const created = (await request("POST", hotelA, "/users", { body: createBody(roles.Manager.id, "valid"), expected: 201 })).data.user;
  fixture.userIds.push(created.id);
  assert.equal(created.role.id, roles.Manager.id);
  pass("existing valid role_id creates a scoped user account");

  const patchOverflow = await request("PATCH", hotelA, `/users/${created.id}`, { body: { role_id: 2147483648 }, expected: 400 });
  assert.equal(patchOverflow.error.code, "INVALID_USER_ACCOUNT");
  pass("PATCH role_id above PostgreSQL INTEGER maximum returns INVALID_USER_ACCOUNT");

  assert.equal((await prisma.user_role.findFirstOrThrow({ where: { hotel_id: hotelA, user_id: created.id } })).role_id, roles.Manager.id);
  pass("rejected overflow PATCH preserves the existing role assignment");

  const maxCreate = await request("POST", hotelA, "/users", { body: createBody(2147483647, "maximum"), expected: 404 });
  assert.equal(maxCreate.error.code, "ROLE_NOT_FOUND");
  pass("role_id at PostgreSQL INTEGER maximum reaches established ROLE_NOT_FOUND behavior");

  const maxPatch = await request("PATCH", hotelA, `/users/${created.id}`, { body: { role_id: 2147483647 }, expected: 404 });
  assert.equal(maxPatch.error.code, "ROLE_NOT_FOUND");
  assert.equal((await prisma.user_role.findFirstOrThrow({ where: { hotel_id: hotelA, user_id: created.id } })).role_id, roles.Manager.id);
  pass("maximum role_id PATCH returns ROLE_NOT_FOUND and preserves the assignment");

  const validPatch = await request("PATCH", hotelA, `/users/${created.id}`, { body: { role_id: roles.Reception.id } });
  assert.equal(validPatch.data.user.role.id, roles.Reception.id);
  assert.equal((await prisma.user_role.findFirstOrThrow({ where: { hotel_id: hotelA, user_id: created.id } })).role_id, roles.Reception.id);
  pass("existing valid role_id continues to work on PATCH");

  for (const roleId of [0, -1, -2147483649, 1.5, "1"]) {
    const payload = await request("POST", hotelA, "/users", { body: createBody(roleId, "invalid"), expected: 400 });
    assert.equal(payload.error.code, "INVALID_USER_ACCOUNT");
  }
  pass("zero, negative, fractional, and string role_id values remain rejected");

  await request("POST", hotelA, "/users", { body: createBody(roles.Manager.id, "unauthenticated"), role: null, expected: 401 });
  pass("authentication remains required");

  await request("POST", hotelA, "/users", { body: createBody(roles.Manager.id, "forbidden"), role: "Manager", expected: 403 });
  pass("User Accounts remain Admin-only");

  await request("POST", hotelB, "/users", { body: createBody(roles.Manager.id, "scope"), tokenHotel: hotelA, expected: 403 });
  pass("hotel scope remains enforced");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixture.hotelIds.length) await prisma.user_role.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  if (fixture.userIds.length) await prisma.users.deleteMany({ where: { id: { in: fixture.userIds } } });
  if (fixture.hotelIds.length) await prisma.hotel.deleteMany({ where: { id: { in: fixture.hotelIds } } });
  assert.deepEqual(await counts(), before, "Temporary User Account fixtures were not completely removed");
  assert.deepEqual(await prisma.users.findMany({ orderBy: { id: "asc" } }), existingUsers, "Existing User Account data changed");
  assert.deepEqual(await prisma.user_role.findMany({ orderBy: { id: "asc" } }), existingAssignments, "Existing User Role assignments changed");
  await prisma.$disconnect();
}

console.log(`User Account integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
