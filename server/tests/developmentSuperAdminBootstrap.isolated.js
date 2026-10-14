import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { ASSIGNMENT_STATUSES, ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import {
  DEVELOPMENT_SUPER_ADMIN_NAME,
  bootstrapDevelopmentSuperAdmin,
  validateDevelopmentSuperAdminEnvironment,
} from "../services/developmentSuperAdminBootstrapService.js";

const results = [];
const pass = name => results.push(name);
const config = validateDevelopmentSuperAdminEnvironment(process.env);
let server;

async function request(origin, method, path, { body, cookie, expected } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  if (expected !== undefined) assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return { payload, response };
}

function authCookie(response) {
  const value = response.headers.get("set-cookie") || "";
  return value.match(/aazira_auth=([^;]+)/)?.[0] || null;
}

try {
  assert.throws(
    () => validateDevelopmentSuperAdminEnvironment({ ...process.env, NODE_ENV: "production" }),
    /development or test/,
  );
  pass("production environment refuses bootstrap before database access");

  assert.throws(
    () => validateDevelopmentSuperAdminEnvironment({ ...process.env, DATABASE_URL: "postgresql://user:password@example.com/hms" }),
    /local machine/,
  );
  pass("bootstrap refuses a non-local PostgreSQL target");

  const role = await prisma.role.findUnique({ where: { system_key: ROLE_KEYS.SUPER_ADMIN } });
  assert.equal(role.scope, ROLE_SCOPES.COMPANY);
  assert.equal(role.is_protected, true);
  pass("protected SUPER_ADMIN role has COMPANY scope");

  const user = await prisma.users.findUnique({ where: { email: config.email } });
  assert.ok(user);
  assert.equal(user.name, DEVELOPMENT_SUPER_ADMIN_NAME);
  pass("development bootstrap creates the dedicated identity");
  assert.equal(user.is_active, true);
  assert.equal(user.password_change_required, false);
  pass("development identity is active and immediately login-ready");
  assert.match(user.password_hash, /^\$argon2id\$/);
  assert.equal(await argon2.verify(user.password_hash, config.password, { type: argon2.argon2id }), true);
  pass("credential is stored with the existing Argon2id mechanism");

  const assignments = await prisma.user_role.findMany({ where: { user_id: user.id } });
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].role_id, role.id);
  assert.equal(assignments[0].role_scope, ROLE_SCOPES.COMPANY);
  assert.equal(assignments[0].hotel_id, null);
  assert.equal(assignments[0].status, ASSIGNMENT_STATUSES.ACTIVE);
  pass("exactly one ACTIVE SUPER_ADMIN COMPANY assignment exists with no hotel");

  const original = { assignmentId: assignments[0].id, hash: user.password_hash, userId: user.id };
  const repeated = await bootstrapDevelopmentSuperAdmin(prisma, config);
  const afterRepeated = await prisma.users.findUnique({ where: { email: config.email } });
  const repeatedAssignments = await prisma.user_role.findMany({ where: { user_id: user.id } });
  assert.equal(repeated.userCreated, false);
  assert.equal(repeated.assignmentCreated, false);
  assert.equal(afterRepeated.id, original.userId);
  assert.equal(afterRepeated.password_hash, original.hash);
  assert.deepEqual(repeatedAssignments.map(item => item.id), [original.assignmentId]);
  pass("repeated bootstrap is a write-free idempotent reuse");

  const hotelAdminRole = await prisma.role.upsert({
    where: { system_key: ROLE_KEYS.HOTEL_ADMIN },
    update: {},
    create: { is_protected: true, name: "Admin", scope: ROLE_SCOPES.HOTEL, system_key: ROLE_KEYS.HOTEL_ADMIN },
  });
  const hotel = await prisma.hotel.create({ data: { id: randomUUID(), name: "Bootstrap Isolation Hotel", plan: "FREE" } });
  const unrelatedUserId = randomUUID();
  const unrelatedEmail = `unrelated-${unrelatedUserId}@bootstrap.invalid`;
  await prisma.users.create({
    data: {
      email: unrelatedEmail,
      id: unrelatedUserId,
      name: "Unrelated Hotel Admin",
      password_hash: await argon2.hash(randomUUID(), { type: argon2.argon2id }),
    },
  });
  const unrelatedAssignment = await prisma.user_role.create({
    data: {
      hotel_id: hotel.id,
      id: randomUUID(),
      role_id: hotelAdminRole.id,
      role_scope: ROLE_SCOPES.HOTEL,
      status: ASSIGNMENT_STATUSES.ACTIVE,
      user_id: unrelatedUserId,
    },
  });
  await bootstrapDevelopmentSuperAdmin(prisma, config);
  assert.deepEqual(await prisma.user_role.findUnique({ where: { id: unrelatedAssignment.id } }), unrelatedAssignment);
  pass("existing unrelated assignments remain unchanged");

  const conflictEmail = `conflict-${randomUUID()}@bootstrap.invalid`;
  const conflictUser = await prisma.users.create({
    data: {
      email: conflictEmail,
      id: randomUUID(),
      name: DEVELOPMENT_SUPER_ADMIN_NAME,
      password_hash: await argon2.hash(config.password, { type: argon2.argon2id }),
    },
  });
  await prisma.user_role.create({
    data: {
      hotel_id: hotel.id,
      id: randomUUID(),
      role_id: hotelAdminRole.id,
      role_scope: ROLE_SCOPES.HOTEL,
      status: ASSIGNMENT_STATUSES.ACTIVE,
      user_id: conflictUser.id,
    },
  });
  await assert.rejects(bootstrapDevelopmentSuperAdmin(prisma, { ...config, email: conflictEmail }), /incompatible assignment/);
  assert.equal((await prisma.user_role.findMany({ where: { user_id: conflictUser.id } })).length, 1);
  pass("an existing identity with incompatible assignments fails without role escalation");

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;

  const login = await request(origin, "POST", "/api/auth/login", {
    body: { identifier: config.email, password: config.password, remember: false }, expected: 200,
  });
  const cookie = authCookie(login.response);
  assert.ok(cookie);
  assert.equal(login.payload.user.roleKey, ROLE_KEYS.SUPER_ADMIN);
  assert.equal(login.payload.user.scope, ROLE_SCOPES.COMPANY);
  assert.equal(login.payload.user.hotelId, null);
  pass("bootstrap credentials authenticate directly as SUPER_ADMIN COMPANY");

  const session = await request(origin, "GET", "/api/auth/session", { cookie, expected: 200 });
  assert.equal(session.payload.user.roleKey, ROLE_KEYS.SUPER_ADMIN);
  assert.equal(session.payload.user.scope, ROLE_SCOPES.COMPANY);
  pass("authenticated session exposes the exact company context");

  await request(origin, "GET", "/api/company/hotels", { cookie, expected: 200 });
  pass("company control-plane authorization accepts the bootstrap session");

  await request(origin, "GET", `/api/hotels/${hotel.id}/rooms`, { cookie, expected: 403 });
  pass("hotel operational routes retain hotel-scoped authorization");

  const finalProtection = await request(origin, "POST", `/api/company/users/${user.id}/deactivate`, {
    body: {}, cookie, expected: 409,
  });
  assert.equal(finalProtection.payload.error.code, "FINAL_ACTIVE_SUPER_ADMIN_REQUIRED");
  assert.equal((await prisma.users.findUnique({ where: { id: user.id } })).is_active, true);
  pass("final active Super Admin protection remains enforced");

  for (const path of ["/api/company/super-admin", "/api/admin/create-super-admin"]) {
    await request(origin, "POST", path, { body: {}, cookie, expected: 404 });
  }
  pass("no public Super Admin bootstrap endpoint exists");

  const routesSource = await readFile(new URL("../../client/src/app/routes.jsx", import.meta.url), "utf8");
  assert.match(routesSource, /path: "login"/);
  assert.match(routesSource, /path: "company\/overview"/);
  assert.match(routesSource, /allowedRoleKeys=\{\["SUPER_ADMIN"\]\}/);
  assert.match(routesSource, /allowedScopes=\{\["COMPANY"\]\}/);
  pass("existing login and protected company overview routes remain wired");

  const logout = await request(origin, "POST", "/api/auth/logout", { body: {}, cookie, expected: 200 });
  assert.match(logout.response.headers.get("set-cookie") || "", /aazira_auth=;/);
  await request(origin, "GET", "/api/auth/session", { expected: 401 });
  const relogin = await request(origin, "POST", "/api/auth/login", {
    body: { identifier: config.email, password: config.password, remember: false }, expected: 200,
  });
  assert.ok(authCookie(relogin.response));
  pass("logout clears the browser cookie and the development account can log in again");

  const multiPassword = `Multi-${randomUUID()}`;
  const multiUser = await prisma.users.create({
    data: {
      email: `multi-${randomUUID()}@bootstrap.invalid`,
      id: randomUUID(),
      name: "Multi-context Identity",
      password_hash: await argon2.hash(multiPassword, { type: argon2.argon2id }),
    },
  });
  const companyAssignment = await prisma.user_role.create({
    data: { hotel_id: null, id: randomUUID(), role_id: role.id, role_scope: ROLE_SCOPES.COMPANY, status: ASSIGNMENT_STATUSES.ACTIVE, user_id: multiUser.id },
  });
  await prisma.user_role.create({
    data: { hotel_id: hotel.id, id: randomUUID(), role_id: hotelAdminRole.id, role_scope: ROLE_SCOPES.HOTEL, status: ASSIGNMENT_STATUSES.ACTIVE, user_id: multiUser.id },
  });
  const multiLogin = await request(origin, "POST", "/api/auth/login", {
    body: { identifier: multiUser.email, password: multiPassword, remember: false }, expected: 409,
  });
  assert.equal(multiLogin.payload.error.code, "ACCOUNT_CONTEXT_REQUIRED");
  const selected = await request(origin, "POST", "/api/auth/context", {
    body: { assignmentId: companyAssignment.id, challenge: multiLogin.payload.contextSelection.challenge }, expected: 200,
  });
  assert.equal(selected.payload.user.roleKey, ROLE_KEYS.SUPER_ADMIN);
  assert.equal(selected.payload.user.scope, ROLE_SCOPES.COMPANY);
  pass("existing Phase 8 context selection still supports company context");

  assert.equal(results.length, 19);
  console.log(`Development Super Admin bootstrap integration: ${results.length}/${results.length} passed`);
  results.forEach(name => console.log(`PASS ${name}`));
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
}
