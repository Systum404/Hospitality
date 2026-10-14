import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { HOTEL_STATUSES } from "../config/hotelLifecycle.js";
import { ASSIGNMENT_STATUSES, ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { activateHotel, deactivateHotel } from "../services/hotelLifecycleService.js";

const results = [];
const pass = name => results.push(name);
const password = `Context-${randomUUID()}`;
const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
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
  const payload = await response.json();
  if (expected !== undefined) assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return { payload, response, status: response.status };
}

function authCookie(response) {
  const header = response.headers.get("set-cookie") || "";
  const match = header.match(/aazira_auth=([^;]+)/);
  return match ? `aazira_auth=${match[1]}` : null;
}

async function addUser({ active = true, assignments, label }) {
  const id = randomUUID();
  const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id}@context-selection.invalid`;
  await prisma.users.create({ data: { id, email, is_active: active, name: label, password_hash: passwordHash } });
  const createdAssignments = [];
  for (const assignment of assignments) {
    createdAssignments.push(await prisma.user_role.create({
      data: {
        id: randomUUID(),
        hotel_id: assignment.hotelId ?? null,
        role_id: assignment.role.id,
        role_scope: assignment.role.scope,
        status: assignment.status ?? ASSIGNMENT_STATUSES.ACTIVE,
        user_id: id,
      },
    }));
  }
  return { assignments: createdAssignments, email, id };
}

try {
  const definitions = [
    [ROLE_KEYS.SUPER_ADMIN, "Super Admin", ROLE_SCOPES.COMPANY],
    [ROLE_KEYS.HOTEL_ADMIN, "Admin", ROLE_SCOPES.HOTEL],
    [ROLE_KEYS.MANAGER, "Manager", ROLE_SCOPES.HOTEL],
    [ROLE_KEYS.RECEPTION, "Reception", ROLE_SCOPES.HOTEL],
    [ROLE_KEYS.CAPTAIN, "Captain", ROLE_SCOPES.HOTEL],
    [ROLE_KEYS.KITCHEN, "Kitchen", ROLE_SCOPES.HOTEL],
  ];
  const roles = {};
  for (const [key, name, scope] of definitions) {
    roles[key] = await prisma.role.upsert({
      where: { system_key: key },
      update: {},
      create: { is_protected: true, name, scope, system_key: key },
    });
  }

  const hotelA = await prisma.hotel.create({ data: { id: randomUUID(), name: "Context Hotel A", plan: "PREMIUM" } });
  const hotelB = await prisma.hotel.create({ data: { id: randomUUID(), name: "Context Hotel B", plan: "PREMIUM" } });
  const hotelInactive = await prisma.hotel.create({ data: { id: randomUUID(), name: "Context Hotel Inactive", plan: "PREMIUM" } });

  const inactiveIdentity = await addUser({
    active: false,
    assignments: [{ hotelId: hotelA.id, role: roles[ROLE_KEYS.MANAGER] }],
    label: "Inactive Identity",
  });
  const single = await addUser({
    assignments: [
      { hotelId: hotelA.id, role: roles[ROLE_KEYS.HOTEL_ADMIN] },
      { hotelId: hotelB.id, role: roles[ROLE_KEYS.CAPTAIN], status: ASSIGNMENT_STATUSES.INACTIVE },
    ],
    label: "Single Active",
  });
  const multi = await addUser({
    assignments: [
      { hotelId: hotelA.id, role: roles[ROLE_KEYS.HOTEL_ADMIN] },
      { hotelId: hotelB.id, role: roles[ROLE_KEYS.MANAGER] },
      { hotelId: hotelA.id, role: roles[ROLE_KEYS.CAPTAIN], status: ASSIGNMENT_STATUSES.INACTIVE },
      { hotelId: hotelA.id, role: roles[ROLE_KEYS.RECEPTION], status: ASSIGNMENT_STATUSES.PENDING },
    ],
    label: "Multiple Active",
  });
  const other = await addUser({
    assignments: [{ hotelId: hotelA.id, role: roles[ROLE_KEYS.KITCHEN] }],
    label: "Other User",
  });
  const inactiveHotelUser = await addUser({
    assignments: [{ hotelId: hotelInactive.id, role: roles[ROLE_KEYS.MANAGER] }],
    label: "Inactive Hotel User",
  });
  await deactivateHotel(hotelInactive.id);
  const superMulti = await addUser({
    assignments: [
      { role: roles[ROLE_KEYS.SUPER_ADMIN] },
      { hotelId: hotelA.id, role: roles[ROLE_KEYS.HOTEL_ADMIN] },
    ],
    label: "Company And Hotel",
  });

  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const inactiveLogin = await request(origin, "POST", "/api/auth/login", { body: { identifier: inactiveIdentity.email, password, remember: false }, expected: 401 });
  assert.equal(inactiveLogin.payload.error.code, "INVALID_CREDENTIALS");
  pass("inactive identity cannot log in");

  const singleLogin = await request(origin, "POST", "/api/auth/login", { body: { identifier: single.email, password, remember: false }, expected: 200 });
  assert.equal(singleLogin.payload.status, "success");
  assert.ok(authCookie(singleLogin.response));
  pass("one eligible ACTIVE assignment logs in normally");
  assert.equal(singleLogin.payload.user.roleKey, ROLE_KEYS.HOTEL_ADMIN);
  pass("inactive assignment does not force context selection");

  let multiLogin = await request(origin, "POST", "/api/auth/login", { body: { identifier: multi.email, password, remember: true }, expected: 409 });
  assert.equal(multiLogin.payload.error.code, "ACCOUNT_CONTEXT_REQUIRED");
  assert.equal(authCookie(multiLogin.response), null);
  pass("multiple eligible assignments do not receive a normal session before selection");
  assert.deepEqual(new Set(multiLogin.payload.contextSelection.assignments.map(item => item.assignmentId)), new Set(multi.assignments.slice(0, 2).map(item => item.id)));
  pass("selection response contains only the authenticated user's eligible assignments");
  assert.equal(multiLogin.payload.contextSelection.assignments.some(item => item.assignmentId === multi.assignments[2].id), false);
  pass("inactive assignment is not listed as eligible");
  assert.equal(multiLogin.payload.contextSelection.assignments.some(item => item.assignmentId === multi.assignments[3].id), false);
  pass("pending assignment is not listed as eligible");

  const pendingBefore = await prisma.user_role.findUniqueOrThrow({ where: { id: multi.assignments[3].id } });
  const inactiveSelect = await request(origin, "POST", "/api/auth/context", { body: { challenge: multiLogin.payload.contextSelection.challenge, assignmentId: multi.assignments[2].id }, expected: 403 });
  assert.equal(inactiveSelect.payload.error.code, "CONTEXT_SELECTION_INVALID");
  pass("inactive assignment cannot be manually selected");
  const pendingSelect = await request(origin, "POST", "/api/auth/context", { body: { challenge: multiLogin.payload.contextSelection.challenge, assignmentId: multi.assignments[3].id }, expected: 403 });
  assert.equal(pendingSelect.payload.error.code, "CONTEXT_SELECTION_INVALID");
  pass("pending assignment cannot be manually selected");
  assert.deepEqual(await prisma.user_role.findUniqueOrThrow({ where: { id: multi.assignments[3].id } }), pendingBefore);
  pass("pending invitation assignment remains unchanged");

  const crossUser = await request(origin, "POST", "/api/auth/context", { body: { challenge: multiLogin.payload.contextSelection.challenge, assignmentId: other.assignments[0].id }, expected: 403 });
  assert.equal(crossUser.payload.error.code, "CONTEXT_SELECTION_INVALID");
  pass("challenge cannot select another user's assignment");

  for (const field of ["role", "scope", "hotelId"]) {
    const spoof = await request(origin, "POST", "/api/auth/context", {
      body: { challenge: multiLogin.payload.contextSelection.challenge, assignmentId: multi.assignments[0].id, [field]: "spoofed" },
      expected: 400,
    });
    assert.equal(spoof.payload.error.code, "VALIDATION_ERROR");
    pass(`${field} cannot be spoofed during context selection`);
  }
  const assignmentsBeforeSelection = await prisma.user_role.findMany({ where: { user_id: multi.id }, orderBy: { id: "asc" } });
  const selectedA = await request(origin, "POST", "/api/auth/context", { body: { challenge: multiLogin.payload.contextSelection.challenge, assignmentId: multi.assignments[0].id }, expected: 200 });
  const cookieA = authCookie(selectedA.response);
  assert.ok(cookieA);
  assert.equal(selectedA.payload.user.roleKey, ROLE_KEYS.HOTEL_ADMIN);
  assert.equal(selectedA.payload.user.hotelId, hotelA.id);
  pass("user can explicitly select assignment A");
  const sessionA = await request(origin, "GET", "/api/auth/session", { cookie: cookieA, expected: 200 });
  assert.equal(sessionA.payload.user.roleKey, ROLE_KEYS.HOTEL_ADMIN);
  assert.equal(sessionA.payload.user.hotelId, hotelA.id);
  pass("selected assignment A is preserved by the final session");
  await request(origin, "GET", `/api/hotels/${hotelA.id}/users`, { cookie: cookieA, expected: 200 });
  pass("existing hotel authorization middleware recognizes selected context A");
  assert.deepEqual(await prisma.user_role.findMany({ where: { user_id: multi.id }, orderBy: { id: "asc" } }), assignmentsBeforeSelection);
  pass("context selection does not mutate assignment authorization state");

  multiLogin = await request(origin, "POST", "/api/auth/login", { body: { identifier: multi.email, password, remember: false }, expected: 409 });
  const selectedB = await request(origin, "POST", "/api/auth/context", { body: { challenge: multiLogin.payload.contextSelection.challenge, assignmentId: multi.assignments[1].id }, expected: 200 });
  const cookieB = authCookie(selectedB.response);
  assert.equal(selectedB.payload.user.roleKey, ROLE_KEYS.MANAGER);
  assert.equal(selectedB.payload.user.hotelId, hotelB.id);
  pass("user can independently select assignment B");
  const sessionB = await request(origin, "GET", "/api/auth/session", { cookie: cookieB, expected: 200 });
  assert.equal(sessionB.payload.user.roleKey, ROLE_KEYS.MANAGER);
  assert.equal(sessionB.payload.user.hotelId, hotelB.id);
  pass("assignment A and B produce their authoritative role, scope, and hotel contexts");

  const inactiveHotelLogin = await request(origin, "POST", "/api/auth/login", { body: { identifier: inactiveHotelUser.email, password, remember: false }, expected: 403 });
  assert.equal(inactiveHotelLogin.payload.error.code, "HOTEL_INACTIVE");
  pass("inactive hotel context is rejected by existing lifecycle semantics");
  assert.equal(singleLogin.payload.user.hotelId, hotelA.id);
  pass("active hotel context continues to succeed");

  let superLogin = await request(origin, "POST", "/api/auth/login", { body: { identifier: superMulti.email, password, remember: false }, expected: 409 });
  assert.equal(superLogin.payload.error.code, "ACCOUNT_CONTEXT_REQUIRED");
  assert.equal(authCookie(superLogin.response), null);
  pass("SUPER_ADMIN is not automatically selected over another eligible context");
  const superAssignment = superMulti.assignments[0];
  const selectedCompany = await request(origin, "POST", "/api/auth/context", { body: { challenge: superLogin.payload.contextSelection.challenge, assignmentId: superAssignment.id }, expected: 200 });
  const companyCookie = authCookie(selectedCompany.response);
  assert.equal(selectedCompany.payload.user.roleKey, ROLE_KEYS.SUPER_ADMIN);
  assert.equal(selectedCompany.payload.user.scope, ROLE_SCOPES.COMPANY);
  assert.equal(selectedCompany.payload.user.hotelId, null);
  pass("SUPER_ADMIN selected context remains COMPANY scoped");
  await request(origin, "GET", "/api/company/hotels", { cookie: companyCookie, expected: 200 });
  pass("existing company authorization middleware recognizes selected SUPER_ADMIN context");
  superLogin = await request(origin, "POST", "/api/auth/login", { body: { identifier: superMulti.email, password, remember: false }, expected: 409 });
  const selectedHotelAdmin = await request(origin, "POST", "/api/auth/context", { body: { challenge: superLogin.payload.contextSelection.challenge, assignmentId: superMulti.assignments[1].id }, expected: 200 });
  assert.equal(selectedHotelAdmin.payload.user.roleKey, ROLE_KEYS.HOTEL_ADMIN);
  assert.equal(selectedHotelAdmin.payload.user.scope, ROLE_SCOPES.HOTEL);
  pass("HOTEL_ADMIN selection remains distinct from COMPANY scope");

  multiLogin = await request(origin, "POST", "/api/auth/login", { body: { identifier: multi.email, password, remember: false }, expected: 409 });
  await prisma.auth_context_challenge.updateMany({ data: { expires_at: new Date(Date.now() - 1000) }, where: { token_hash: { not: "" }, user_id: multi.id } });
  const expired = await request(origin, "POST", "/api/auth/context", { body: { challenge: multiLogin.payload.contextSelection.challenge, assignmentId: multi.assignments[0].id }, expected: 403 });
  assert.equal(expired.payload.error.code, "CONTEXT_SELECTION_INVALID");
  pass("expired context-selection challenge fails safely");

  multiLogin = await request(origin, "POST", "/api/auth/login", { body: { identifier: multi.email, password, remember: false }, expected: 409 });
  const concurrentSelection = await Promise.all([
    request(origin, "POST", "/api/auth/context", { body: { challenge: multiLogin.payload.contextSelection.challenge, assignmentId: multi.assignments[0].id } }),
    request(origin, "POST", "/api/auth/context", { body: { challenge: multiLogin.payload.contextSelection.challenge, assignmentId: multi.assignments[0].id } }),
  ]);
  assert.deepEqual(concurrentSelection.map(result => result.status).sort(), [200, 403]);
  const replay = await request(origin, "POST", "/api/auth/context", { body: { challenge: multiLogin.payload.contextSelection.challenge, assignmentId: multi.assignments[0].id }, expected: 403 });
  assert.equal(replay.payload.error.code, "CONTEXT_SELECTION_INVALID");
  pass("challenge is atomically single-use under concurrent selection and replay");

  const malformed = await request(origin, "POST", "/api/auth/context", { body: { challenge: "invalid", assignmentId: "invalid" }, expected: 400 });
  assert.equal(malformed.payload.error.code, "VALIDATION_ERROR");
  pass("malformed context-selection request fails safely");

  multiLogin = await request(origin, "POST", "/api/auth/login", { body: { identifier: multi.email, password, remember: false }, expected: 409 });
  await prisma.user_role.update({ where: { id: multi.assignments[1].id }, data: { status: ASSIGNMENT_STATUSES.INACTIVE } });
  const staleAssignment = await request(origin, "POST", "/api/auth/context", { body: { challenge: multiLogin.payload.contextSelection.challenge, assignmentId: multi.assignments[1].id }, expected: 403 });
  assert.equal(staleAssignment.payload.error.code, "CONTEXT_SELECTION_INVALID");
  await prisma.user_role.update({ where: { id: multi.assignments[1].id }, data: { status: ASSIGNMENT_STATUSES.ACTIVE } });
  pass("assignment becoming inactive after listing is rejected safely");

  multiLogin = await request(origin, "POST", "/api/auth/login", { body: { identifier: multi.email, password, remember: false }, expected: 409 });
  await deactivateHotel(hotelB.id);
  const staleHotel = await request(origin, "POST", "/api/auth/context", { body: { challenge: multiLogin.payload.contextSelection.challenge, assignmentId: multi.assignments[1].id }, expected: 403 });
  assert.equal(staleHotel.payload.error.code, "HOTEL_INACTIVE");
  await activateHotel(hotelB.id);
  pass("hotel becoming inactive after listing is rejected by lifecycle semantics");

  multiLogin = await request(origin, "POST", "/api/auth/login", { body: { identifier: multi.email, password, remember: false }, expected: 409 });
  const selectedForDeactivation = await request(origin, "POST", "/api/auth/context", { body: { challenge: multiLogin.payload.contextSelection.challenge, assignmentId: multi.assignments[0].id }, expected: 200 });
  const deactivationCookie = authCookie(selectedForDeactivation.response);
  await prisma.user_role.update({ where: { id: multi.assignments[0].id }, data: { status: ASSIGNMENT_STATUSES.INACTIVE } });
  const deactivatedSession = await request(origin, "GET", "/api/auth/session", { cookie: deactivationCookie, expected: 401 });
  assert.equal(deactivatedSession.payload.error.code, "UNAUTHENTICATED");
  await prisma.user_role.update({ where: { id: multi.assignments[0].id }, data: { status: ASSIGNMENT_STATUSES.ACTIVE } });
  pass("existing assignment deactivation continues to invalidate its session");

  const remainingChallenges = await prisma.auth_context_challenge.count({ where: { expires_at: { lte: new Date() } } });
  assert.equal(remainingChallenges, 0);
  pass("expired context challenges are removed during subsequent login");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
}

assert.equal(results.length, 33);
console.log(`Authentication Context Selection integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
