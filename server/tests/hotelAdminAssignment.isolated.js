import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { AUDIT_ACTIONS } from "../config/audit.js";
import { ASSIGNMENT_STATUSES, ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { deactivateHotelAdmin } from "../services/hotelAdminAssignmentService.js";
import { createAuthenticationToken } from "../services/tokenService.js";

const results = [];
const pass = name => results.push(name);
const password = `Phase9-${randomUUID()}`;
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

function responseCookie(response) {
  return (response.headers.get("set-cookie") || "").match(/aazira_auth=([^;]+)/)?.[0] || null;
}

async function addUser(label, assignments, { active = true } = {}) {
  const id = randomUUID();
  const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id}@phase9.invalid`;
  await prisma.users.create({ data: { email, id, is_active: active, name: label, password_hash: passwordHash } });
  const created = [];
  for (const input of assignments) {
    created.push(await prisma.user_role.create({
      data: {
        hotel_id: input.hotelId ?? null,
        id: randomUUID(),
        role_id: input.role.id,
        role_scope: input.role.scope,
        status: input.status ?? ASSIGNMENT_STATUSES.ACTIVE,
        user_id: id,
      },
    }));
  }
  return { assignments: created, email, id };
}

async function authCookie(user, assignment) {
  const token = await createAuthenticationToken({ userId: user.id, userRoleId: assignment.id }, 1800);
  return `aazira_auth=${token}`;
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
  const hotelA = await prisma.hotel.create({ data: { id: randomUUID(), name: "Phase 9 Hotel A", plan: "PREMIUM" } });
  const hotelB = await prisma.hotel.create({ data: { id: randomUUID(), name: "Phase 9 Hotel B", plan: "PREMIUM" } });
  const company = await addUser("Company Actor", [{ role: roles[ROLE_KEYS.SUPER_ADMIN] }]);
  const companyCookie = await authCookie(company, company.assignments[0]);
  const multi = await addUser("Multi Assignment", [
    { hotelId: hotelA.id, role: roles[ROLE_KEYS.HOTEL_ADMIN] },
    { hotelId: hotelB.id, role: roles[ROLE_KEYS.MANAGER] },
    { hotelId: hotelB.id, role: roles[ROLE_KEYS.HOTEL_ADMIN] },
  ]);
  const lastAdmin = await addUser("Last Admin", [{ hotelId: hotelA.id, role: roles[ROLE_KEYS.HOTEL_ADMIN] }]);
  const pending = await addUser("Pending Admin", [{ hotelId: hotelB.id, role: roles[ROLE_KEYS.HOTEL_ADMIN], status: ASSIGNMENT_STATUSES.PENDING }]);
  const inactiveIdentity = await addUser("Inactive Identity", [{ hotelId: hotelA.id, role: roles[ROLE_KEYS.HOTEL_ADMIN], status: ASSIGNMENT_STATUSES.INACTIVE }], { active: false });
  const actors = {};
  for (const roleKey of [ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION, ROLE_KEYS.CAPTAIN, ROLE_KEYS.KITCHEN]) {
    const actor = await addUser(`${roleKey} Actor`, [{ hotelId: hotelA.id, role: roles[roleKey] }]);
    actors[roleKey] = { ...actor, cookie: await authCookie(actor, actor.assignments[0]) };
  }
  const invitation = await prisma.admin_invitation.create({
    data: {
      created_by: company.id,
      email_snapshot: pending.email,
      expires_at: new Date(Date.now() + 3600000),
      hotel_id: hotelB.id,
      id: randomUUID(),
      status: "PENDING",
      token_hash: createHash("sha256").update(randomUUID()).digest("hex"),
      user_id: pending.id,
      user_role_id: pending.assignments[0].id,
    },
  });

  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const list = await request(origin, "GET", `/api/company/hotels/${hotelA.id}/admins`, { cookie: companyCookie, expected: 200 });
  assert.ok(list.payload.data.admins.some(item => item.assignment_id === multi.assignments[0].id));
  pass("Super Admin COMPANY context can list Hotel Admin assignments");
  assert.ok(list.payload.data.admins.every(item => item.role === ROLE_KEYS.HOTEL_ADMIN && item.scope === ROLE_SCOPES.HOTEL && item.hotel_id === hotelA.id));
  pass("list contains only HOTEL_ADMIN HOTEL assignments for the URL hotel");
  assert.ok(list.payload.data.admins.every(item => item.user.id && item.user.name && item.user.email));
  pass("list exposes the safe display identity required for company administration");
  assert.equal(list.payload.data.admins.some(item => item.assignment_id === multi.assignments[1].id), false);
  pass("list excludes non-Hotel-Admin assignments");
  assert.equal(JSON.stringify(list.payload).match(/password|token|cookie|hash/i), null);
  pass("list exposes no authentication secrets");
  assert.deepEqual(list.payload.data.admins.map(item => item.user.name), [...list.payload.data.admins.map(item => item.user.name)].sort());
  pass("list ordering is deterministic");

  assert.equal((await request(origin, "GET", `/api/company/hotels/${hotelA.id}/admins`, { expected: 401 })).payload.error.code, "UNAUTHENTICATED");
  pass("unauthenticated list is rejected");
  for (const roleKey of [ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION, ROLE_KEYS.CAPTAIN, ROLE_KEYS.KITCHEN]) {
    assert.equal((await request(origin, "GET", `/api/company/hotels/${hotelA.id}/admins`, { cookie: actors[roleKey].cookie, expected: 403 })).payload.error.code, "COMPANY_SCOPE_REQUIRED");
    pass(`${roleKey} cannot manage Hotel Admin assignments`);
  }

  const sessionCookie = actors[ROLE_KEYS.HOTEL_ADMIN].cookie;
  const identityBefore = await prisma.users.findUniqueOrThrow({ where: { id: multi.id } });
  const otherBefore = await prisma.user_role.findMany({ where: { user_id: multi.id, id: { not: multi.assignments[0].id } }, orderBy: { id: "asc" } });
  const deactivate = await request(origin, "POST", `/api/company/hotels/${hotelA.id}/admins/${multi.assignments[0].id}/deactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  assert.equal(deactivate.payload.data.changed, true);
  assert.equal(deactivate.payload.data.admin.status, ASSIGNMENT_STATUSES.INACTIVE);
  pass("Super Admin deactivates only the target assignment");
  assert.equal((await prisma.user_role.findUniqueOrThrow({ where: { id: multi.assignments[0].id } })).status, ASSIGNMENT_STATUSES.INACTIVE);
  pass("deactivated assignment status persists in PostgreSQL");
  assert.equal((await prisma.users.findUniqueOrThrow({ where: { id: multi.id } })).is_active, identityBefore.is_active);
  pass("deactivation does not change users.is_active");
  assert.equal((await prisma.users.findUniqueOrThrow({ where: { id: multi.id } })).email, identityBefore.email);
  pass("deactivation preserves the global user identity fields");
  assert.deepEqual(await prisma.user_role.findMany({ where: { user_id: multi.id, id: { not: multi.assignments[0].id } }, orderBy: { id: "asc" } }), otherBefore);
  pass("deactivation preserves every unrelated assignment");
  assert.equal((await request(origin, "GET", "/api/auth/session", { cookie: await authCookie(multi, multi.assignments[1]), expected: 200 })).payload.user.roleKey, ROLE_KEYS.MANAGER);
  pass("the same user's other active assignment remains usable");
  assert.equal((await prisma.user_role.findUniqueOrThrow({ where: { id: multi.assignments[2].id } })).status, ASSIGNMENT_STATUSES.ACTIVE);
  pass("the same user's Hotel Admin assignment for another hotel remains active");
  const invalidSession = await request(origin, "GET", "/api/auth/session", { cookie: await authCookie(multi, multi.assignments[0]), expected: 401 });
  assert.equal(invalidSession.payload.error.code, "UNAUTHENTICATED");
  pass("deactivated assignment session is rejected by Phase 8 revalidation");
  assert.equal((await request(origin, "GET", "/api/auth/session", { cookie: sessionCookie, expected: 200 })).payload.user.roleKey, ROLE_KEYS.HOTEL_ADMIN);
  pass("another user's active assignment session remains usable");

  let login = await request(origin, "POST", "/api/auth/login", { body: { identifier: multi.email, password, remember: false }, expected: 409 });
  assert.equal(login.payload.contextSelection.assignments.some(item => item.assignmentId === multi.assignments[0].id), false);
  assert.equal(login.payload.contextSelection.assignments.length, 2);
  pass("fresh login excludes the inactive assignment while retaining other contexts");
  const manualInactive = await request(origin, "POST", "/api/auth/context", { body: { assignmentId: multi.assignments[0].id, challenge: login.payload.contextSelection.challenge }, expected: 403 });
  assert.equal(manualInactive.payload.error.code, "CONTEXT_SELECTION_INVALID");
  pass("inactive assignment cannot be selected explicitly");

  const deactivateAudit = await prisma.audit_event.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.HOTEL_ADMIN_ASSIGNMENT_DEACTIVATED, target_id: multi.assignments[0].id } });
  assert.equal(deactivateAudit.actor_user_id, company.id);
  assert.equal(deactivateAudit.actor_assignment_id, company.assignments[0].id);
  assert.equal(deactivateAudit.actor_scope, ROLE_SCOPES.COMPANY);
  assert.equal(deactivateAudit.hotel_id, hotelA.id);
  assert.deepEqual(deactivateAudit.metadata, { current_status: "INACTIVE", previous_status: "ACTIVE", role: ROLE_KEYS.HOTEL_ADMIN, target_user_id: multi.id });
  pass("deactivation audit uses authoritative actor, assignment, scope, hotel, and safe transition metadata");
  assert.ok(deactivateAudit.request_id);
  pass("deactivation audit stores the server request identifier");
  const auditCount = await prisma.audit_event.count({ where: { target_id: multi.assignments[0].id } });
  const repeatedDeactivate = await request(origin, "POST", `/api/company/hotels/${hotelA.id}/admins/${multi.assignments[0].id}/deactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  assert.equal(repeatedDeactivate.payload.data.changed, false);
  assert.equal(await prisma.audit_event.count({ where: { target_id: multi.assignments[0].id } }), auditCount);
  pass("repeated deactivation is idempotent and creates no transition audit");

  const reactivate = await request(origin, "POST", `/api/company/hotels/${hotelA.id}/admins/${multi.assignments[0].id}/reactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  assert.equal(reactivate.payload.data.changed, true);
  assert.equal(reactivate.payload.data.admin.status, ASSIGNMENT_STATUSES.ACTIVE);
  pass("Super Admin reactivates the target assignment");
  const reactivateAudit = await prisma.audit_event.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.HOTEL_ADMIN_ASSIGNMENT_REACTIVATED, target_id: multi.assignments[0].id } });
  assert.equal(reactivateAudit.actor_scope, ROLE_SCOPES.COMPANY);
  pass("reactivation creates the required authoritative audit event");
  const reactivationCount = await prisma.audit_event.count({ where: { target_id: multi.assignments[0].id } });
  const repeatedReactivate = await request(origin, "POST", `/api/company/hotels/${hotelA.id}/admins/${multi.assignments[0].id}/reactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  assert.equal(repeatedReactivate.payload.data.changed, false);
  assert.equal(await prisma.audit_event.count({ where: { target_id: multi.assignments[0].id } }), reactivationCount);
  pass("repeated reactivation is idempotent and creates no transition audit");
  login = await request(origin, "POST", "/api/auth/login", { body: { identifier: multi.email, password, remember: false }, expected: 409 });
  assert.equal(login.payload.contextSelection.assignments.some(item => item.assignmentId === multi.assignments[0].id), true);
  pass("reactivated assignment becomes eligible for fresh context selection");

  assert.equal((await request(origin, "POST", `/api/company/hotels/${hotelB.id}/admins/${multi.assignments[0].id}/deactivate`, { body: {}, cookie: companyCookie, expected: 404 })).payload.error.code, "HOTEL_ADMIN_ASSIGNMENT_NOT_FOUND");
  pass("cross-hotel assignment mutation is rejected without target disclosure");
  assert.equal((await request(origin, "POST", `/api/company/hotels/${hotelB.id}/admins/${multi.assignments[1].id}/deactivate`, { body: {}, cookie: companyCookie, expected: 404 })).payload.error.code, "HOTEL_ADMIN_ASSIGNMENT_NOT_FOUND");
  pass("non-HOTEL_ADMIN assignment is rejected");
  assert.equal((await request(origin, "POST", `/api/company/hotels/${hotelA.id}/admins/${company.assignments[0].id}/deactivate`, { body: {}, cookie: companyCookie, expected: 404 })).payload.error.code, "HOTEL_ADMIN_ASSIGNMENT_NOT_FOUND");
  pass("COMPANY-scoped assignment is rejected");
  assert.equal((await request(origin, "POST", `/api/company/hotels/${hotelA.id}/admins/not-a-uuid/deactivate`, { body: {}, cookie: companyCookie, expected: 400 })).payload.error.code, "INVALID_ASSIGNMENT_ID");
  pass("invalid assignment identifier is rejected before Prisma");
  for (const field of ["userId", "role", "scope", "hotelId", "actor", "status", "auditAction", "auditMetadata"]) {
    const spoof = await request(origin, "POST", `/api/company/hotels/${hotelA.id}/admins/${multi.assignments[0].id}/deactivate`, { body: { [field]: "spoofed" }, cookie: companyCookie, expected: 400 });
    assert.equal(spoof.payload.error.code, "UNSUPPORTED_HOTEL_ADMIN_ASSIGNMENT_FIELD");
  }
  pass("client cannot spoof target, authority, state, or audit fields");

  const pendingAssignmentBefore = await prisma.user_role.findUniqueOrThrow({ where: { id: pending.assignments[0].id } });
  const invitationBefore = await prisma.admin_invitation.findUniqueOrThrow({ where: { id: invitation.id } });
  assert.equal((await request(origin, "POST", `/api/company/hotels/${hotelB.id}/admins/${pending.assignments[0].id}/deactivate`, { body: {}, cookie: companyCookie, expected: 409 })).payload.error.code, "INVALID_HOTEL_ADMIN_ASSIGNMENT");
  assert.deepEqual(await prisma.user_role.findUniqueOrThrow({ where: { id: pending.assignments[0].id } }), pendingAssignmentBefore);
  assert.deepEqual(await prisma.admin_invitation.findUniqueOrThrow({ where: { id: invitation.id } }), invitationBefore);
  pass("pending assignment and invitation lifecycle remain unchanged");
  assert.equal((await request(origin, "POST", `/api/company/hotels/${hotelB.id}/admins/${pending.assignments[0].id}/reactivate`, { body: {}, cookie: companyCookie, expected: 409 })).payload.error.code, "INVALID_HOTEL_ADMIN_ASSIGNMENT");
  pass("pending assignment cannot bypass invitation acceptance through reactivation");
  assert.equal((await request(origin, "POST", `/api/company/hotels/${hotelA.id}/admins/${inactiveIdentity.assignments[0].id}/reactivate`, { body: {}, cookie: companyCookie, expected: 409 })).payload.error.code, "HOTEL_ADMIN_IDENTITY_INACTIVE");
  assert.equal((await prisma.user_role.findUniqueOrThrow({ where: { id: inactiveIdentity.assignments[0].id } })).status, ASSIGNMENT_STATUSES.INACTIVE);
  pass("reactivation rejects an inactive global identity without modifying it");

  await prisma.hotel.update({ where: { id: hotelA.id }, data: { status: "INACTIVE" } });
  const inactiveHotelBefore = await prisma.user_role.findUniqueOrThrow({ where: { id: lastAdmin.assignments[0].id } });
  assert.equal((await request(origin, "POST", `/api/company/hotels/${hotelA.id}/admins/${lastAdmin.assignments[0].id}/deactivate`, { body: {}, cookie: companyCookie, expected: 403 })).payload.error.code, "HOTEL_INACTIVE");
  assert.deepEqual(await prisma.user_role.findUniqueOrThrow({ where: { id: lastAdmin.assignments[0].id } }), inactiveHotelBefore);
  assert.equal((await prisma.user_role.findUniqueOrThrow({ where: { id: lastAdmin.assignments[0].id } })).status, ASSIGNMENT_STATUSES.ACTIVE);
  pass("existing hotel lifecycle rules reject assignment mutation while the hotel is inactive");
  await prisma.hotel.update({ where: { id: hotelA.id }, data: { status: "ACTIVE" } });

  const lastActiveAdmins = await prisma.user_role.count({ where: { hotel_id: hotelA.id, role_id: roles[ROLE_KEYS.HOTEL_ADMIN].id, status: ASSIGNMENT_STATUSES.ACTIVE } });
  await prisma.user_role.updateMany({ where: { hotel_id: hotelA.id, role_id: roles[ROLE_KEYS.HOTEL_ADMIN].id, id: { not: lastAdmin.assignments[0].id } }, data: { status: ASSIGNMENT_STATUSES.INACTIVE } });
  await request(origin, "POST", `/api/company/hotels/${hotelA.id}/admins/${lastAdmin.assignments[0].id}/deactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  assert.equal(await prisma.user_role.count({ where: { hotel_id: hotelA.id, role_id: roles[ROLE_KEYS.HOTEL_ADMIN].id, status: ASSIGNMENT_STATUSES.ACTIVE } }), 0);
  pass("deactivation of the final active Hotel Admin is allowed because no last-admin policy exists");
  await request(origin, "POST", `/api/company/hotels/${hotelA.id}/admins/${lastAdmin.assignments[0].id}/reactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  assert.ok(lastActiveAdmins >= 1);

  const rollbackBefore = await prisma.user_role.findUniqueOrThrow({ where: { id: multi.assignments[2].id } });
  const rollbackAudits = await prisma.audit_event.count({ where: { target_id: multi.assignments[2].id } });
  await assert.rejects(() => deactivateHotelAdmin(hotelB.id, multi.assignments[2].id, {
    actor: { hotelId: null, roleKey: ROLE_KEYS.SUPER_ADMIN, scope: ROLE_SCOPES.COMPANY, userId: company.id, userRoleId: company.assignments[0].id },
    requestContext: { requestId: "invalid" },
  }));
  assert.deepEqual(await prisma.user_role.findUniqueOrThrow({ where: { id: multi.assignments[2].id } }), rollbackBefore);
  assert.equal(await prisma.audit_event.count({ where: { target_id: multi.assignments[2].id } }), rollbackAudits);
  pass("audit failure rolls back the assignment mutation atomically");

  await prisma.user_role.update({ where: { id: multi.assignments[2].id }, data: { status: ASSIGNMENT_STATUSES.ACTIVE } });
  const concurrentDeactivate = await Promise.all([
    request(origin, "POST", `/api/company/hotels/${hotelB.id}/admins/${multi.assignments[2].id}/deactivate`, { body: {}, cookie: companyCookie, expected: 200 }),
    request(origin, "POST", `/api/company/hotels/${hotelB.id}/admins/${multi.assignments[2].id}/deactivate`, { body: {}, cookie: companyCookie, expected: 200 }),
  ]);
  assert.deepEqual(concurrentDeactivate.map(item => item.payload.data.changed).sort(), [false, true]);
  assert.equal(await prisma.audit_event.count({ where: { action: AUDIT_ACTIONS.HOTEL_ADMIN_ASSIGNMENT_DEACTIVATED, target_id: multi.assignments[2].id } }), 1);
  pass("concurrent deactivation serializes to one transition and one audit");
  const concurrentReactivate = await Promise.all([
    request(origin, "POST", `/api/company/hotels/${hotelB.id}/admins/${multi.assignments[2].id}/reactivate`, { body: {}, cookie: companyCookie, expected: 200 }),
    request(origin, "POST", `/api/company/hotels/${hotelB.id}/admins/${multi.assignments[2].id}/reactivate`, { body: {}, cookie: companyCookie, expected: 200 }),
  ]);
  assert.deepEqual(concurrentReactivate.map(item => item.payload.data.changed).sort(), [false, true]);
  pass("concurrent reactivation serializes deterministically");
  const oppositeAuditBefore = await prisma.audit_event.count({ where: { target_id: multi.assignments[2].id } });
  await Promise.all([
    request(origin, "POST", `/api/company/hotels/${hotelB.id}/admins/${multi.assignments[2].id}/deactivate`, { body: {}, cookie: companyCookie, expected: 200 }),
    request(origin, "POST", `/api/company/hotels/${hotelB.id}/admins/${multi.assignments[2].id}/reactivate`, { body: {}, cookie: companyCookie, expected: 200 }),
  ]);
  const finalAssignment = await prisma.user_role.findUniqueOrThrow({ where: { id: multi.assignments[2].id } });
  const oppositeAudits = await prisma.audit_event.findMany({ where: { target_id: multi.assignments[2].id }, orderBy: [{ occurred_at: "asc" }, { id: "asc" }] });
  assert.ok([ASSIGNMENT_STATUSES.ACTIVE, ASSIGNMENT_STATUSES.INACTIVE].includes(finalAssignment.status));
  assert.ok(oppositeAudits.length > oppositeAuditBefore);
  assert.equal(finalAssignment.status, oppositeAudits.at(-1).metadata.current_status);
  pass("opposite concurrent transitions serialize to a coherent final state matching the final audit");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
}

assert.equal(results.length, 44);
console.log(`Hotel Admin Assignment integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
