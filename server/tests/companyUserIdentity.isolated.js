import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { AUDIT_ACTIONS } from "../config/audit.js";
import { ASSIGNMENT_STATUSES, ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import {
  deactivateCompanyUserIdentity,
  reactivateCompanyUserIdentity,
} from "../services/companyUserIdentityService.js";
import { createAuthenticationToken } from "../services/tokenService.js";

const results = [];
const pass = name => results.push(name);
const password = `Phase10-${randomUUID()}`;
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
  const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id}@phase10.invalid`;
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

async function authCookie(user, assignment = user.assignments[0]) {
  const token = await createAuthenticationToken({ userId: user.id, userRoleId: assignment.id }, 1800);
  return `aazira_auth=${token}`;
}

function auditContext(actor, requestId = randomUUID()) {
  return {
    actor: {
      assignmentActive: true,
      hotelId: null,
      roleKey: ROLE_KEYS.SUPER_ADMIN,
      scope: ROLE_SCOPES.COMPANY,
      userActive: true,
      userId: actor.id,
      userRoleId: actor.assignments[0].id,
    },
    requestContext: { requestId },
  };
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

  const hotelA = await prisma.hotel.create({ data: { id: randomUUID(), name: "Phase 10 Hotel A", plan: "PREMIUM" } });
  const hotelB = await prisma.hotel.create({ data: { id: randomUUID(), name: "Phase 10 Hotel B", plan: "PREMIUM" } });
  const company = await addUser("Company Actor", [{ role: roles[ROLE_KEYS.SUPER_ADMIN] }]);
  const secondSuper = await addUser("Second Super Admin", [{ role: roles[ROLE_KEYS.SUPER_ADMIN] }]);
  const companyCookie = await authCookie(company);
  const multi = await addUser("Multi Identity", [
    { hotelId: hotelA.id, role: roles[ROLE_KEYS.HOTEL_ADMIN] },
    { hotelId: hotelB.id, role: roles[ROLE_KEYS.MANAGER] },
    { hotelId: hotelB.id, role: roles[ROLE_KEYS.HOTEL_ADMIN], status: ASSIGNMENT_STATUSES.INACTIVE },
    { hotelId: hotelA.id, role: roles[ROLE_KEYS.RECEPTION], status: ASSIGNMENT_STATUSES.PENDING },
  ]);
  const targetCookie = await authCookie(multi, multi.assignments[0]);
  const nonTarget = await addUser("Manager Only Target", [{ hotelId: hotelA.id, role: roles[ROLE_KEYS.MANAGER] }]);
  const actors = {};
  for (const roleKey of [ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION, ROLE_KEYS.CAPTAIN, ROLE_KEYS.KITCHEN]) {
    const actor = await addUser(`${roleKey} Actor`, [{ hotelId: hotelA.id, role: roles[roleKey] }]);
    actors[roleKey] = { ...actor, cookie: await authCookie(actor) };
  }
  const invitation = await prisma.admin_invitation.create({
    data: {
      created_by: company.id,
      email_snapshot: multi.email,
      expires_at: new Date(Date.now() + 3600000),
      hotel_id: hotelA.id,
      id: randomUUID(),
      status: "PENDING",
      token_hash: createHash("sha256").update(randomUUID()).digest("hex"),
      user_id: multi.id,
      user_role_id: multi.assignments[3].id,
    },
  });

  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await request(origin, "POST", `/api/company/users/${multi.id}/deactivate`, { body: {}, expected: 401 })).payload.error.code, "UNAUTHENTICATED");
  pass("unauthenticated identity deactivation is rejected");
  for (const roleKey of [ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION, ROLE_KEYS.CAPTAIN, ROLE_KEYS.KITCHEN]) {
    const denied = await request(origin, "POST", `/api/company/users/${multi.id}/deactivate`, { body: {}, cookie: actors[roleKey].cookie, expected: 403 });
    assert.equal(denied.payload.error.code, "COMPANY_SCOPE_REQUIRED");
    pass(`${roleKey} identity deactivation is rejected`);
  }
  assert.equal((await request(origin, "POST", "/api/company/users/not-a-uuid/deactivate", { body: {}, cookie: companyCookie, expected: 400 })).payload.error.code, "INVALID_USER_ID");
  pass("invalid user id is rejected before Prisma");
  assert.equal((await request(origin, "POST", `/api/company/users/${randomUUID()}/deactivate`, { body: {}, cookie: companyCookie, expected: 404 })).payload.error.code, "USER_IDENTITY_NOT_FOUND");
  pass("unknown user identity is not found");
  const ordinaryStaffDeactivation = await request(origin, "POST", `/api/company/users/${nonTarget.id}/deactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  assert.equal(ordinaryStaffDeactivation.payload.data.deactivatedAssignments, 1);
  await request(origin, "POST", `/api/company/users/${nonTarget.id}/reactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  pass("ordinary hotel staff identity is a company lifecycle target");
  for (const field of ["actor", "role", "scope", "hotelId", "assignmentId", "status", "is_active", "auditAction", "auditMetadata"]) {
    const spoof = await request(origin, "POST", `/api/company/users/${multi.id}/deactivate`, { body: { [field]: "spoofed" }, cookie: companyCookie, expected: 400 });
    assert.equal(spoof.payload.error.code, "UNSUPPORTED_IDENTITY_LIFECYCLE_FIELD");
  }
  pass("client cannot spoof identity state, authority, assignment, or audit data");

  const assignmentsBefore = await prisma.user_role.findMany({ where: { user_id: multi.id }, orderBy: { id: "asc" } });
  const invitationBefore = await prisma.admin_invitation.findUniqueOrThrow({ where: { id: invitation.id } });
  const identityBefore = await prisma.users.findUniqueOrThrow({ where: { id: multi.id } });
  const deactivated = await request(origin, "POST", `/api/company/users/${multi.id}/deactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  assert.equal(deactivated.payload.data.changed, true);
  assert.equal(deactivated.payload.data.identity.is_active, false);
  pass("Super Admin COMPANY context deactivates an eligible global identity");
  assert.equal((await prisma.users.findUniqueOrThrow({ where: { id: multi.id } })).is_active, false);
  pass("deactivation persists users.is_active=false");
  const assignmentsAfterDeactivation = await prisma.user_role.findMany({ where: { user_id: multi.id }, orderBy: { id: "asc" } });
  assert.equal(assignmentsAfterDeactivation.find(item => item.id === multi.assignments[0].id).status, ASSIGNMENT_STATUSES.INACTIVE);
  assert.equal(assignmentsAfterDeactivation.find(item => item.id === multi.assignments[0].id).restore_on_identity_reactivation, true);
  assert.equal(assignmentsAfterDeactivation.find(item => item.id === multi.assignments[1].id).status, ASSIGNMENT_STATUSES.INACTIVE);
  assert.equal(assignmentsAfterDeactivation.find(item => item.id === multi.assignments[1].id).restore_on_identity_reactivation, true);
  pass("deactivation marks every active hotel-role assignment for restoration");
  assert.deepEqual(
    assignmentsAfterDeactivation.map(item => item.hotel_id),
    assignmentsBefore.map(item => item.hotel_id),
  );
  pass("global deactivation preserves multi-hotel assignment ownership");
  assert.equal((await prisma.user_role.findUniqueOrThrow({ where: { id: multi.assignments[2].id } })).status, ASSIGNMENT_STATUSES.INACTIVE);
  pass("global deactivation preserves an inactive Hotel Admin assignment");
  assert.equal((await prisma.user_role.findUniqueOrThrow({ where: { id: multi.assignments[2].id } })).restore_on_identity_reactivation, false);
  assert.equal((await prisma.user_role.findUniqueOrThrow({ where: { id: multi.assignments[3].id } })).status, ASSIGNMENT_STATUSES.PENDING);
  pass("global deactivation preserves a pending assignment");
  assert.deepEqual(await prisma.admin_invitation.findUniqueOrThrow({ where: { id: invitation.id } }), invitationBefore);
  pass("deactivation preserves pending invitation data");
  assert.equal((await prisma.users.findUniqueOrThrow({ where: { id: multi.id } })).password_hash, identityBefore.password_hash);
  pass("deactivation preserves credentials and identity attributes");

  const deactivationAudit = await prisma.audit_event.findFirstOrThrow({
    where: { action: AUDIT_ACTIONS.HOTEL_ADMIN_IDENTITY_DEACTIVATED, target_id: multi.id },
  });
  assert.equal(deactivationAudit.actor_user_id, company.id);
  assert.equal(deactivationAudit.actor_assignment_id, company.assignments[0].id);
  assert.equal(deactivationAudit.actor_scope, ROLE_SCOPES.COMPANY);
  assert.equal(deactivationAudit.hotel_id, null);
  assert.equal(deactivationAudit.target_type, "USER_IDENTITY");
  assert.deepEqual(deactivationAudit.metadata, { current_active: "false", previous_active: "true" });
  pass("deactivation audit contains authoritative actor, target, scope, and state transition");
  assert.equal(JSON.stringify(deactivationAudit).match(/password|authorization|cookie|jwt|token|hash|credential/i), null);
  pass("identity transition audit contains no authentication secrets");

  const auditCountBeforeNoop = await prisma.audit_event.count({ where: { target_id: multi.id } });
  const timestampBeforeNoop = (await prisma.users.findUniqueOrThrow({ where: { id: multi.id } })).updated_at;
  const deactivateNoop = await request(origin, "POST", `/api/company/users/${multi.id}/deactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  assert.equal(deactivateNoop.payload.data.changed, false);
  assert.equal(await prisma.audit_event.count({ where: { target_id: multi.id } }), auditCountBeforeNoop);
  assert.deepEqual((await prisma.users.findUniqueOrThrow({ where: { id: multi.id } })).updated_at, timestampBeforeNoop);
  pass("repeated deactivation is an unaudited timestamp-preserving no-op");

  assert.equal((await request(origin, "GET", "/api/auth/session", { cookie: targetCookie, expected: 401 })).payload.error.code, "UNAUTHENTICATED");
  pass("existing selected session is invalid after global identity deactivation");
  assert.equal((await request(origin, "GET", `/api/hotels/${hotelA.id}/users`, { cookie: targetCookie, expected: 401 })).payload.error.code, "UNAUTHENTICATED");
  pass("protected API is inaccessible to the inactive identity");
  assert.equal((await request(origin, "POST", "/api/auth/login", { body: { identifier: multi.email, password, remember: false }, expected: 401 })).payload.error.code, "INVALID_CREDENTIALS");
  pass("fresh login is rejected without a context challenge while identity is inactive");

  await request(origin, "POST", `/api/company/users/${multi.id}/reactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  let login = await request(origin, "POST", "/api/auth/login", { body: { identifier: multi.email, password, remember: false }, expected: 409 });
  const staleChallenge = login.payload.contextSelection.challenge;
  await request(origin, "POST", `/api/company/users/${multi.id}/deactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  const staleSelection = await request(origin, "POST", "/api/auth/context", { body: { assignmentId: multi.assignments[0].id, challenge: staleChallenge }, expected: 403 });
  assert.equal(staleSelection.payload.error.code, "CONTEXT_SELECTION_INVALID");
  pass("outstanding context challenge cannot create a session for an inactive identity");

  const reactivated = await request(origin, "POST", `/api/company/users/${multi.id}/reactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  assert.equal(reactivated.payload.data.changed, true);
  assert.equal(reactivated.payload.data.identity.is_active, true);
  assert.equal((await prisma.users.findUniqueOrThrow({ where: { id: multi.id } })).is_active, true);
  pass("reactivation persists users.is_active=true");
  assert.deepEqual(await prisma.user_role.findMany({ where: { user_id: multi.id }, orderBy: { id: "asc" } }), assignmentsBefore);
  pass("reactivation restores only previously active hotel-role assignments");
  assert.deepEqual(await prisma.admin_invitation.findUniqueOrThrow({ where: { id: invitation.id } }), invitationBefore);
  pass("reactivation preserves invitation lifecycle state");

  const reactivationAudit = await prisma.audit_event.findFirstOrThrow({
    where: { action: AUDIT_ACTIONS.HOTEL_ADMIN_IDENTITY_REACTIVATED, target_id: multi.id },
    orderBy: { occurred_at: "desc" },
  });
  assert.deepEqual(reactivationAudit.metadata, { current_active: "true", previous_active: "false" });
  pass("reactivation creates the correct transactional audit event");
  const auditsBeforeReactivateNoop = await prisma.audit_event.count({ where: { target_id: multi.id } });
  const activeTimestamp = (await prisma.users.findUniqueOrThrow({ where: { id: multi.id } })).updated_at;
  const reactivateNoop = await request(origin, "POST", `/api/company/users/${multi.id}/reactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  assert.equal(reactivateNoop.payload.data.changed, false);
  assert.equal(await prisma.audit_event.count({ where: { target_id: multi.id } }), auditsBeforeReactivateNoop);
  assert.deepEqual((await prisma.users.findUniqueOrThrow({ where: { id: multi.id } })).updated_at, activeTimestamp);
  pass("repeated reactivation is an unaudited timestamp-preserving no-op");

  login = await request(origin, "POST", "/api/auth/login", { body: { identifier: multi.email, password, remember: false }, expected: 409 });
  assert.equal(login.payload.error.code, "ACCOUNT_CONTEXT_REQUIRED");
  assert.deepEqual(login.payload.contextSelection.assignments.map(item => item.assignmentId).sort(), [multi.assignments[0].id, multi.assignments[1].id].sort());
  pass("reactivation restores login and Phase 8 exposes only active eligible assignments");
  const selected = await request(origin, "POST", "/api/auth/context", { body: { assignmentId: multi.assignments[1].id, challenge: login.payload.contextSelection.challenge }, expected: 200 });
  assert.equal(selected.payload.user.roleKey, ROLE_KEYS.MANAGER);
  pass("Phase 8 context selection remains functional after identity reactivation");

  const rollbackIdentity = await prisma.users.findUniqueOrThrow({ where: { id: multi.id } });
  const rollbackAudits = await prisma.audit_event.count({ where: { target_id: multi.id } });
  await assert.rejects(() => deactivateCompanyUserIdentity(multi.id, auditContext(company, "invalid")));
  assert.deepEqual(await prisma.users.findUniqueOrThrow({ where: { id: multi.id } }), rollbackIdentity);
  assert.equal(await prisma.audit_event.count({ where: { target_id: multi.id } }), rollbackAudits);
  pass("audit failure rolls back identity mutation atomically");

  const concurrentAuditBefore = await prisma.audit_event.count({ where: { target_id: multi.id } });
  const concurrentDeactivate = await Promise.all([
    deactivateCompanyUserIdentity(multi.id, auditContext(company)),
    deactivateCompanyUserIdentity(multi.id, auditContext(company)),
  ]);
  assert.deepEqual(concurrentDeactivate.map(item => item.changed).sort(), [false, true]);
  assert.equal(await prisma.audit_event.count({ where: { target_id: multi.id } }), concurrentAuditBefore + 1);
  pass("concurrent deactivation serializes to one transition and one audit");
  const concurrentReactivate = await Promise.all([
    reactivateCompanyUserIdentity(multi.id, auditContext(company)),
    reactivateCompanyUserIdentity(multi.id, auditContext(company)),
  ]);
  assert.deepEqual(concurrentReactivate.map(item => item.changed).sort(), [false, true]);
  pass("concurrent reactivation serializes deterministically");
  const oppositeBefore = await prisma.audit_event.count({ where: { target_id: multi.id } });
  await Promise.all([
    deactivateCompanyUserIdentity(multi.id, auditContext(company)),
    reactivateCompanyUserIdentity(multi.id, auditContext(company)),
  ]);
  const oppositeAudits = await prisma.audit_event.findMany({ where: { target_id: multi.id }, orderBy: [{ occurred_at: "asc" }, { id: "asc" }] });
  const oppositeIdentity = await prisma.users.findUniqueOrThrow({ where: { id: multi.id } });
  assert.ok(oppositeAudits.length > oppositeBefore);
  assert.equal(String(oppositeIdentity.is_active), oppositeAudits.at(-1).metadata.current_active);
  pass("opposite concurrent transitions serialize to state matching the final audit");
  if (!oppositeIdentity.is_active) await reactivateCompanyUserIdentity(multi.id, auditContext(company));

  const secondDeactivate = await request(origin, "POST", `/api/company/users/${secondSuper.id}/deactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  assert.equal(secondDeactivate.payload.data.changed, true);
  pass("one Super Admin identity can be deactivated while another active Super Admin remains");
  const finalAttempt = await request(origin, "POST", `/api/company/users/${company.id}/deactivate`, { body: {}, cookie: companyCookie, expected: 409 });
  assert.equal(finalAttempt.payload.error.code, "FINAL_ACTIVE_SUPER_ADMIN_REQUIRED");
  assert.equal((await prisma.users.findUniqueOrThrow({ where: { id: company.id } })).is_active, true);
  pass("final active Super Admin identity cannot be deactivated");
  await request(origin, "POST", `/api/company/users/${secondSuper.id}/reactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  pass("Super Admin identity reactivation is supported without assignment mutation");

  assert.equal((await request(origin, "DELETE", `/api/company/users/${multi.id}`, { cookie: companyCookie, expected: 404 })).payload.error.code, "ROUTE_NOT_FOUND");
  pass("no company identity deletion endpoint exists");
  assert.equal((await request(origin, "PATCH", `/api/company/users/${secondSuper.id}`, { body: { role: "MANAGER" }, cookie: companyCookie, expected: 404 })).payload.error.code, "ROUTE_NOT_FOUND");
  pass("no company Super Admin demotion or generic role endpoint exists");

  const finalRaceActor = company;
  const finalRace = await Promise.allSettled([
    deactivateCompanyUserIdentity(company.id, auditContext(finalRaceActor)),
    deactivateCompanyUserIdentity(secondSuper.id, auditContext(finalRaceActor)),
  ]);
  assert.deepEqual(finalRace.map(item => item.status).sort(), ["fulfilled", "rejected"]);
  const activeSuperAdmins = await prisma.users.count({
    where: {
      is_active: true,
      user_role: { some: { role_scope: ROLE_SCOPES.COMPANY, status: ASSIGNMENT_STATUSES.ACTIVE, role: { system_key: ROLE_KEYS.SUPER_ADMIN } } },
    },
  });
  assert.equal(activeSuperAdmins, 1);
  assert.equal(finalRace.find(item => item.status === "rejected").reason.code, "FINAL_ACTIVE_SUPER_ADMIN_REQUIRED");
  pass("concurrent Super Admin deactivations cannot leave zero active Super Admin identities");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
}

assert.equal(results.length, 42);
console.log(`Company User Identity integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
