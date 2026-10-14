// Explicit local-only integration test. Every committed fixture is removed in finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { ASSIGNMENT_STATUSES, ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { requireCompanyScope } from "../middleware/companyScope.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";

const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Local hms only");

const models = ["hotel", "users", "role", "user_role", "room_booking", "orders", "bill", "payment", "attendance", "notification"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const existingUsers = await prisma.users.findMany({ orderBy: { id: "asc" } });
const existingAssignments = await prisma.user_role.findMany({ orderBy: { id: "asc" } });
const fixture = { hotelIds: [], userIds: [] };
const results = [];
const pass = name => results.push(name);
let server;

async function addUser({ hotelId = null, role, status = ASSIGNMENT_STATUSES.ACTIVE }) {
  const userId = randomUUID();
  const userRoleId = randomUUID();
  fixture.userIds.push(userId);
  await prisma.users.create({
    data: {
      id: userId,
      email: `${userId}@role-scope-test.invalid`,
      name: `Role scope ${role.system_key}`,
      password_hash: await argon2.hash(randomUUID(), { type: argon2.argon2id }),
    },
  });
  await prisma.user_role.create({
    data: { id: userRoleId, user_id: userId, role_id: role.id, role_scope: role.scope, status, hotel_id: hotelId },
  });
  return { token: await createAuthenticationToken({ userId, userRoleId }, 600), userId, userRoleId };
}

async function expectDatabaseRejection(work, description) {
  await assert.rejects(work, error => ["P2002", "P2003", "P2004", "P2039"].includes(error?.code), description);
}

try {
  const roleRows = await prisma.role.findMany({ orderBy: { id: "asc" } });
  const roles = Object.fromEntries(roleRows.map(role => [role.system_key, role]));
  const expected = {
    [ROLE_KEYS.HOTEL_ADMIN]: ["Admin", ROLE_SCOPES.HOTEL],
    [ROLE_KEYS.MANAGER]: ["Manager", ROLE_SCOPES.HOTEL],
    [ROLE_KEYS.RECEPTION]: ["Reception", ROLE_SCOPES.HOTEL],
    [ROLE_KEYS.CAPTAIN]: ["Captain", ROLE_SCOPES.HOTEL],
    [ROLE_KEYS.KITCHEN]: ["Kitchen", ROLE_SCOPES.HOTEL],
    [ROLE_KEYS.SUPER_ADMIN]: ["Super Admin", ROLE_SCOPES.COMPANY],
  };
  for (const [key, [name, scope]] of Object.entries(expected)) {
    assert.equal(roles[key].name, name);
    assert.equal(roles[key].scope, scope);
    assert.equal(roles[key].is_protected, true);
  }
  const retainedAssignments = await prisma.user_role.findMany({
    select: { hotel_id: true, role_scope: true, status: true, role: { select: { scope: true, system_key: true } } },
  });
  assert.ok(retainedAssignments.every(assignment => assignment.role_scope === assignment.role.scope));
  assert.ok(retainedAssignments.every(assignment => assignment.role_scope === ROLE_SCOPES.COMPANY
    ? assignment.hotel_id === null && assignment.role.system_key === ROLE_KEYS.SUPER_ADMIN
    : assignment.role_scope === ROLE_SCOPES.HOTEL && typeof assignment.hotel_id === "string"));
  pass("protected role definitions and stable system-key mapping are correct");

  assert.ok(retainedAssignments.every(assignment => Object.values(ASSIGNMENT_STATUSES).includes(assignment.status)));
  pass("existing assignments preserve valid role scope, hotel ownership, and lifecycle state");

  const hotelId = randomUUID();
  const otherHotelId = randomUUID();
  fixture.hotelIds.push(hotelId, otherHotelId);
  await prisma.hotel.createMany({ data: [
    { id: hotelId, name: `Role scope hotel ${hotelId}`, status: "ACTIVE" },
    { id: otherHotelId, name: `Role scope hotel ${otherHotelId}`, status: "ACTIVE" },
  ].map(entitledHotelFixture) });

  const invalidCompanyUser = await addUser({ role: roles[ROLE_KEYS.SUPER_ADMIN] });
  await prisma.user_role.delete({ where: { id: invalidCompanyUser.userRoleId } });
  await expectDatabaseRejection(
    () => prisma.user_role.create({ data: { id: randomUUID(), user_id: invalidCompanyUser.userId, role_id: roles[ROLE_KEYS.SUPER_ADMIN].id, role_scope: ROLE_SCOPES.COMPANY, hotel_id: hotelId } }),
    "COMPANY assignment with hotel_id must fail",
  );
  pass("database rejects COMPANY role with hotel_id");

  const invalidHotelUser = await addUser({ hotelId, role: roles[ROLE_KEYS.MANAGER] });
  await prisma.user_role.delete({ where: { id: invalidHotelUser.userRoleId } });
  await expectDatabaseRejection(
    () => prisma.user_role.create({ data: { id: randomUUID(), user_id: invalidHotelUser.userId, role_id: roles[ROLE_KEYS.MANAGER].id, role_scope: ROLE_SCOPES.HOTEL, hotel_id: null } }),
    "HOTEL assignment without hotel_id must fail",
  );
  pass("database rejects HOTEL role without hotel_id");

  const mismatchUserId = randomUUID();
  fixture.userIds.push(mismatchUserId);
  await prisma.users.create({ data: { id: mismatchUserId, email: `${mismatchUserId}@role-scope-test.invalid`, name: "Mismatch", password_hash: await argon2.hash(randomUUID()) } });
  await expectDatabaseRejection(
    () => prisma.user_role.create({ data: { id: randomUUID(), user_id: mismatchUserId, role_id: roles[ROLE_KEYS.SUPER_ADMIN].id, role_scope: ROLE_SCOPES.HOTEL, hotel_id: hotelId } }),
    "role identity and assignment scope mismatch must fail",
  );
  pass("composite foreign key rejects role/scope mismatch");

  const company = await addUser({ role: roles[ROLE_KEYS.SUPER_ADMIN] });
  const hotelAdmin = await addUser({ hotelId, role: roles[ROLE_KEYS.HOTEL_ADMIN] });
  const inactive = await addUser({ hotelId, role: roles[ROLE_KEYS.MANAGER], status: ASSIGNMENT_STATUSES.INACTIVE });
  const staff = {};
  for (const key of [ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION, ROLE_KEYS.CAPTAIN, ROLE_KEYS.KITCHEN]) {
    staff[key] = await addUser({ hotelId, role: roles[key] });
  }
  pass("valid COMPANY and HOTEL assignments are accepted");

  const secondHotelAssignment = await prisma.user_role.create({
    data: { id: randomUUID(), user_id: hotelAdmin.userId, role_id: roles[ROLE_KEYS.MANAGER].id, role_scope: ROLE_SCOPES.HOTEL, hotel_id: hotelId },
  });
  assert.equal(await prisma.user_role.count({ where: { user_id: hotelAdmin.userId } }), 2);
  await prisma.user_role.delete({ where: { id: secondHotelAssignment.id } });
  pass("multiple assignment cardinality remains supported while each assignment is scope-safe");

  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, path, { body, expected = 200, token } = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { ...(token ? { Cookie: `aazira_auth=${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
    return payload;
  };

  const companySession = (await request("GET", "/api/auth/session", { token: company.token })).user;
  assert.equal(companySession.roleKey, ROLE_KEYS.SUPER_ADMIN);
  assert.equal(companySession.scope, ROLE_SCOPES.COMPANY);
  assert.equal(companySession.hotelId, null);
  assert.equal(companySession.assignmentActive, true);
  assert.equal(companySession.userActive, true);
  pass("Super Admin-shaped fixture hydrates a company session without a hotel");

  const adminSession = (await request("GET", "/api/auth/session", { token: hotelAdmin.token })).user;
  assert.equal(adminSession.role, "Admin");
  assert.equal(adminSession.roleKey, ROLE_KEYS.HOTEL_ADMIN);
  assert.equal(adminSession.scope, ROLE_SCOPES.HOTEL);
  assert.equal(adminSession.hotelId, hotelId);
  pass("existing Admin presentation remains compatible while authority uses HOTEL_ADMIN");

  for (const [key, actor] of Object.entries(staff)) {
    const session = (await request("GET", "/api/auth/session", { token: actor.token })).user;
    assert.equal(session.roleKey, key);
    assert.equal(session.scope, ROLE_SCOPES.HOTEL);
    assert.equal(session.hotelId, hotelId);
  }
  pass("Manager, Reception, Captain, and Kitchen contexts remain hotel-scoped");

  assert.equal((await request("GET", "/api/auth/session", { token: inactive.token, expected: 401 })).error.code, "UNAUTHENTICATED");
  pass("inactive assignment is rejected during session hydration");

  assert.equal((await request("GET", `/api/hotels/${hotelId}/users`, { token: company.token, expected: 403 })).error.code, "HOTEL_SCOPE_REQUIRED");
  pass("company-scoped Super Admin cannot pass hotel mutation scope middleware");

  let companyMiddlewareError;
  await requireCompanyScope({ auth: companySessionToContext(companySession, company) }, {}, error => { companyMiddlewareError = error; });
  assert.equal(companyMiddlewareError, undefined);
  let hotelMiddlewareError;
  await requireCompanyScope({ auth: companySessionToContext(adminSession, hotelAdmin) }, {}, error => { hotelMiddlewareError = error; });
  assert.equal(hotelMiddlewareError.code, "COMPANY_SCOPE_REQUIRED");
  pass("company-scope middleware accepts only active company Super Admin context");

  const escalationEmail = `${randomUUID()}@role-scope-test.invalid`;
  const escalationBody = { name: "Escalation attempt", email: escalationEmail, password: randomUUID(), role_id: roles[ROLE_KEYS.SUPER_ADMIN].id, is_active: true };
  const beforeEscalation = await counts();
  const escalation = await request("POST", `/api/hotels/${hotelId}/users`, { body: escalationBody, expected: 403, token: hotelAdmin.token });
  assert.equal(escalation.error.code, "ROLE_ASSIGNMENT_FORBIDDEN");
  assert.equal(await prisma.users.count({ where: { email: escalationEmail } }), 0);
  assert.deepEqual(await counts(), beforeEscalation);
  pass("Hotel Admin cannot create a user with SUPER_ADMIN and no partial mutation occurs");

  const patchTarget = staff[ROLE_KEYS.MANAGER];
  const originalAssignment = await prisma.user_role.findUniqueOrThrow({ where: { id: patchTarget.userRoleId } });
  const patchEscalation = await request("PATCH", `/api/hotels/${hotelId}/users/${patchTarget.userId}`, { body: { role_id: roles[ROLE_KEYS.SUPER_ADMIN].id }, expected: 403, token: hotelAdmin.token });
  assert.equal(patchEscalation.error.code, "ROLE_ASSIGNMENT_FORBIDDEN");
  assert.deepEqual(await prisma.user_role.findUniqueOrThrow({ where: { id: patchTarget.userRoleId } }), originalAssignment);
  pass("Hotel Admin cannot promote an existing user to SUPER_ADMIN");

  const manipulated = await request("POST", `/api/hotels/${hotelId}/users`, { body: { ...escalationBody, email: `${randomUUID()}@role-scope-test.invalid`, role_id: roles[ROLE_KEYS.MANAGER].id, hotel_id: null }, expected: 400, token: hotelAdmin.token });
  assert.equal(manipulated.error.code, "UNSUPPORTED_USER_ACCOUNT_FIELD");
  await request("POST", `/api/hotels/${otherHotelId}/users`, { body: { ...escalationBody, email: `${randomUUID()}@role-scope-test.invalid`, role_id: roles[ROLE_KEYS.MANAGER].id }, expected: 403, token: hotelAdmin.token });
  pass("Hotel Admin cannot inject assignment scope or assign another hotel");

  await request("PATCH", `/api/hotels/${hotelId}/roles/${roles[ROLE_KEYS.SUPER_ADMIN].id}`, { body: { name: "Changed" }, expected: 404, token: hotelAdmin.token });
  assert.deepEqual(await prisma.role.findUniqueOrThrow({ where: { id: roles[ROLE_KEYS.SUPER_ADMIN].id } }), roles[ROLE_KEYS.SUPER_ADMIN]);
  pass("ordinary Hotel Admin APIs expose no protected-role mutation route");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (fixture.userIds.length) await prisma.user_role.deleteMany({ where: { user_id: { in: fixture.userIds } } });
  if (fixture.userIds.length) await prisma.users.deleteMany({ where: { id: { in: fixture.userIds } } });
  if (fixture.hotelIds.length) await prisma.hotel.deleteMany({ where: { id: { in: fixture.hotelIds } } });
  const after = await counts();
  assert.deepEqual(after, before, "Temporary role-scope fixtures were not completely removed");
  assert.deepEqual(await prisma.users.findMany({ orderBy: { id: "asc" } }), existingUsers, "Existing users changed");
  assert.deepEqual(await prisma.user_role.findMany({ orderBy: { id: "asc" } }), existingAssignments, "Existing assignments changed");
  await prisma.$disconnect();
}

function companySessionToContext(session, actor) {
  return {
    assignmentActive: session.assignmentActive,
    hotelId: session.hotelId,
    roleKey: session.roleKey,
    scope: session.scope,
    userActive: session.userActive,
    userId: actor.userId,
    userRoleId: actor.userRoleId,
  };
}

console.log(`Role & Scope Foundation integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
