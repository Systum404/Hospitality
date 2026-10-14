import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { AUDIT_ACTIONS } from "../config/audit.js";
import { ASSIGNMENT_STATUSES, ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { resetCompanyUserPassword } from "../services/companyUserIdentityService.js";
import { createAuthenticationToken } from "../services/tokenService.js";

const results = [];
const pass = name => results.push(name);
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
  return { payload, response };
}

function responseCookie(response) {
  return (response.headers.get("set-cookie") || "").match(/aazira_auth=([^;]+)/)?.[0] || null;
}

async function addUser(label, password, assignments, { active = true } = {}) {
  const id = randomUUID();
  const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id}@phase11.invalid`;
  await prisma.users.create({
    data: {
      email,
      id,
      is_active: active,
      name: label,
      password_hash: await argon2.hash(password, { type: argon2.argon2id }),
    },
  });
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
  return { assignments: created, email, id, password };
}

async function cookieFor(user, assignment = user.assignments[0]) {
  const token = await createAuthenticationToken({ credentialVersion: 0, userId: user.id, userRoleId: assignment.id }, 1800);
  return `aazira_auth=${token}`;
}

function auditInput(actor, requestId = randomUUID()) {
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

  const hotels = [];
  for (let index = 0; index < 4; index += 1) {
    hotels.push(await prisma.hotel.create({ data: { id: randomUUID(), name: `Phase 11 Hotel ${index + 1}`, plan: "PREMIUM" } }));
  }
  const companyPassword = `Company-${randomUUID()}`;
  const company = await addUser("Company Actor", companyPassword, [{ role: roles[ROLE_KEYS.SUPER_ADMIN] }]);
  const secondSuper = await addUser("Second Super", `Second-${randomUUID()}`, [{ role: roles[ROLE_KEYS.SUPER_ADMIN] }]);
  const oldPassword = `Target-${randomUUID()}`;
  const target = await addUser("Target Identity", oldPassword, [
    { hotelId: hotels[0].id, role: roles[ROLE_KEYS.HOTEL_ADMIN] },
    { hotelId: hotels[1].id, role: roles[ROLE_KEYS.HOTEL_ADMIN] },
    { hotelId: hotels[2].id, role: roles[ROLE_KEYS.HOTEL_ADMIN], status: ASSIGNMENT_STATUSES.INACTIVE },
    { hotelId: hotels[3].id, role: roles[ROLE_KEYS.HOTEL_ADMIN], status: ASSIGNMENT_STATUSES.PENDING },
    { hotelId: hotels[0].id, role: roles[ROLE_KEYS.MANAGER] },
  ]);
  const actors = {};
  for (const roleKey of [ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION, ROLE_KEYS.CAPTAIN, ROLE_KEYS.KITCHEN]) {
    actors[roleKey] = await addUser(`${roleKey} Actor`, `Actor-${randomUUID()}`, [{ hotelId: hotels[0].id, role: roles[roleKey] }]);
  }

  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const companyLogin = await request(origin, "POST", "/api/auth/login", {
    body: { identifier: company.email, password: companyPassword, remember: false },
    expected: 200,
  });
  const companyCookie = responseCookie(companyLogin.response);
  assert.ok(companyCookie);

  const oldSession = await cookieFor(target, target.assignments[0]);
  const preDeactivateLogin = await request(origin, "POST", "/api/auth/login", {
    body: { identifier: target.email, password: oldPassword, remember: false },
    expected: 409,
  });
  const preDeactivateChallenge = preDeactivateLogin.payload.contextSelection.challenge;

  const deactivated = await request(origin, "POST", `/api/company/users/${target.id}/deactivate`, {
    body: {}, cookie: companyCookie, expected: 200,
  });
  assert.equal(deactivated.payload.data.changed, true);
  assert.equal(deactivated.payload.data.deactivatedAssignments, 3);
  pass("Super Admin deactivates every active hotel-role assignment on the identity");
  const inactiveIdentity = await prisma.users.findUniqueOrThrow({ where: { id: target.id } });
  assert.equal(inactiveIdentity.is_active, false);
  assert.equal(inactiveIdentity.credential_version, 1);
  pass("global identity deactivation persists inactive state and advances credential version");
  const afterDeactivate = await prisma.user_role.findMany({ where: { user_id: target.id }, orderBy: { id: "asc" } });
  for (const id of [target.assignments[0].id, target.assignments[1].id, target.assignments[4].id]) {
    const assignment = afterDeactivate.find(item => item.id === id);
    assert.equal(assignment.status, ASSIGNMENT_STATUSES.INACTIVE);
    assert.equal(assignment.restore_on_identity_reactivation, true);
  }
  pass("all formerly active hotel-role assignments are inactive and marked for restoration");
  pass("ordinary Manager assignments follow the same identity lifecycle");
  assert.equal(afterDeactivate.find(item => item.id === target.assignments[2].id).status, ASSIGNMENT_STATUSES.INACTIVE);
  assert.equal(afterDeactivate.find(item => item.id === target.assignments[2].id).restore_on_identity_reactivation, false);
  pass("previously inactive Hotel Admin assignment remains inactive and unmarked");
  assert.equal(afterDeactivate.find(item => item.id === target.assignments[3].id).status, ASSIGNMENT_STATUSES.PENDING);
  assert.equal(afterDeactivate.find(item => item.id === target.assignments[3].id).restore_on_identity_reactivation, false);
  pass("pending Hotel Admin assignment remains governed by invitation lifecycle");
  assert.equal(await prisma.auth_context_challenge.count({ where: { user_id: target.id } }), 0);
  pass("global deactivation deletes outstanding context-selection challenges");
  assert.equal((await request(origin, "GET", "/api/auth/session", { cookie: oldSession, expected: 401 })).payload.error.code, "UNAUTHENTICATED");
  pass("pre-deactivation session is invalidated");
  assert.equal((await request(origin, "POST", "/api/auth/login", { body: { identifier: target.email, password: oldPassword }, expected: 401 })).payload.error.code, "INVALID_CREDENTIALS");
  pass("fresh login is blocked while identity is inactive");
  assert.equal((await request(origin, "POST", "/api/auth/context", { body: { assignmentId: target.assignments[0].id, challenge: preDeactivateChallenge }, expected: 403 })).payload.error.code, "CONTEXT_SELECTION_INVALID");
  pass("pre-deactivation context challenge cannot be used");

  const noOpTimestamp = inactiveIdentity.updated_at;
  const noOpAudits = await prisma.audit_event.count({ where: { target_id: target.id } });
  assert.equal((await request(origin, "POST", `/api/company/users/${target.id}/deactivate`, { body: {}, cookie: companyCookie, expected: 200 })).payload.data.changed, false);
  assert.deepEqual((await prisma.users.findUniqueOrThrow({ where: { id: target.id } })).updated_at, noOpTimestamp);
  assert.equal(await prisma.audit_event.count({ where: { target_id: target.id } }), noOpAudits);
  pass("repeated global deactivation is timestamp-preserving and unaudited");

  const reactivated = await request(origin, "POST", `/api/company/users/${target.id}/reactivate`, {
    body: {}, cookie: companyCookie, expected: 200,
  });
  assert.equal(reactivated.payload.data.restoredAssignments, 3);
  pass("reactivation reports every restored hotel-role assignment");
  const afterReactivate = await prisma.user_role.findMany({ where: { user_id: target.id } });
  for (const id of [target.assignments[0].id, target.assignments[1].id, target.assignments[4].id]) {
    const assignment = afterReactivate.find(item => item.id === id);
    assert.equal(assignment.status, ASSIGNMENT_STATUSES.ACTIVE);
    assert.equal(assignment.restore_on_identity_reactivation, false);
  }
  pass("reactivation restores only marked assignments and clears restoration markers");
  assert.equal(afterReactivate.find(item => item.id === target.assignments[2].id).status, ASSIGNMENT_STATUSES.INACTIVE);
  assert.equal(afterReactivate.find(item => item.id === target.assignments[3].id).status, ASSIGNMENT_STATUSES.PENDING);
  pass("reactivation leaves pre-existing inactive and pending assignments unchanged");
  assert.equal((await request(origin, "GET", "/api/auth/session", { cookie: oldSession, expected: 401 })).payload.error.code, "UNAUTHENTICATED");
  pass("old JWT remains invalid after identity reactivation");

  assert.equal((await request(origin, "POST", `/api/company/users/${target.id}/password-reset`, { body: {}, expected: 401 })).payload.error.code, "UNAUTHENTICATED");
  pass("password reset requires authentication");
  for (const roleKey of Object.keys(actors)) {
    const denied = await request(origin, "POST", `/api/company/users/${target.id}/password-reset`, {
      body: {}, cookie: await cookieFor(actors[roleKey]), expected: 403,
    });
    assert.equal(denied.payload.error.code, "COMPANY_SCOPE_REQUIRED");
  }
  pass("Hotel Admin, Manager, Reception, Captain, and Kitchen cannot reset passwords");
  assert.equal((await request(origin, "POST", `/api/company/users/${company.id}/password-reset`, { body: {}, cookie: companyCookie, expected: 409 })).payload.error.code, "SELF_PASSWORD_RESET_FORBIDDEN");
  pass("Super Admin cannot use company reset to reset their own password");

  const beforeReset = await prisma.users.findUniqueOrThrow({ where: { id: target.id } });
  const assignmentsBeforeReset = await prisma.user_role.findMany({ where: { user_id: target.id }, orderBy: { id: "asc" } });
  const contextBeforeReset = await request(origin, "POST", "/api/auth/login", {
    body: { identifier: target.email, password: oldPassword, remember: false }, expected: 409,
  });
  const staleContextChallenge = contextBeforeReset.payload.contextSelection.challenge;
  const selectedBeforeReset = await request(origin, "POST", "/api/auth/context", {
    body: { assignmentId: target.assignments[4].id, challenge: staleContextChallenge }, expected: 200,
  });
  const sessionBeforeReset = responseCookie(selectedBeforeReset.response);
  const anotherContext = await request(origin, "POST", "/api/auth/login", {
    body: { identifier: target.email, password: oldPassword, remember: false }, expected: 409,
  });

  const reset = await request(origin, "POST", `/api/company/users/${target.id}/password-reset`, {
    body: {}, cookie: companyCookie, expected: 200,
  });
  const temporaryPassword = reset.payload.data.temporaryPassword;
  assert.equal(typeof temporaryPassword, "string");
  assert.ok(temporaryPassword.length >= 8);
  pass("Super Admin receives one generated temporary credential in the successful response");
  const afterReset = await prisma.users.findUniqueOrThrow({ where: { id: target.id } });
  assert.equal(afterReset.password_change_required, true);
  assert.equal(afterReset.credential_version, beforeReset.credential_version + 1);
  assert.equal(await argon2.verify(afterReset.password_hash, temporaryPassword, { type: argon2.argon2id }), true);
  assert.match(afterReset.password_hash, /^\$argon2id\$/);
  pass("reset stores only an Argon2id hash and marks forced password change");
  assert.notEqual(afterReset.password_hash, temporaryPassword);
  assert.equal(JSON.stringify(afterReset).includes(temporaryPassword), false);
  pass("plaintext temporary credential is not persisted on the user identity");
  assert.equal(afterReset.email, beforeReset.email);
  assert.equal(afterReset.is_active, beforeReset.is_active);
  assert.deepEqual(await prisma.user_role.findMany({ where: { user_id: target.id }, orderBy: { id: "asc" } }), assignmentsBeforeReset);
  pass("password reset preserves email, active state, roles, and hotel assignments");
  assert.equal(await prisma.auth_context_challenge.count({ where: { user_id: target.id } }), 0);
  pass("password reset deletes all outstanding context-selection challenges");
  assert.equal((await request(origin, "GET", "/api/auth/session", { cookie: sessionBeforeReset, expected: 401 })).payload.error.code, "UNAUTHENTICATED");
  pass("password reset invalidates an existing authenticated session");
  assert.equal((await request(origin, "POST", "/api/auth/context", {
    body: { assignmentId: target.assignments[0].id, challenge: anotherContext.payload.contextSelection.challenge }, expected: 403,
  })).payload.error.code, "CONTEXT_SELECTION_INVALID");
  pass("password reset invalidates an outstanding context-selection challenge");
  assert.equal((await request(origin, "POST", "/api/auth/login", { body: { identifier: target.email, password: oldPassword }, expected: 401 })).payload.error.code, "INVALID_CREDENTIALS");
  pass("old password no longer authenticates after reset");

  const temporaryLogin = await request(origin, "POST", "/api/auth/login", {
    body: { identifier: target.email, password: temporaryPassword, remember: true }, expected: 409,
  });
  assert.equal(temporaryLogin.payload.error.code, "PASSWORD_CHANGE_REQUIRED");
  assert.equal(responseCookie(temporaryLogin.response), null);
  assert.ok(temporaryLogin.payload.passwordChange.challenge);
  pass("temporary password produces only a restricted password-change challenge and no normal session");
  const resetChallenge = temporaryLogin.payload.passwordChange.challenge;
  assert.equal((await request(origin, "POST", "/api/auth/password-change", {
    body: { challenge: resetChallenge, newPassword: "short" }, expected: 400,
  })).payload.error.code, "VALIDATION_ERROR");
  assert.equal(await prisma.password_change_challenge.count({ where: { user_id: target.id } }), 1);
  pass("invalid permanent password is rejected without consuming the reset challenge");

  const newPassword = `Permanent-${randomUUID()}`;
  const changed = await request(origin, "POST", "/api/auth/password-change", {
    body: { challenge: resetChallenge, newPassword }, expected: 200,
  });
  assert.equal(changed.payload.data.user.id, target.id);
  pass("valid restricted challenge establishes the new permanent password");
  const afterChange = await prisma.users.findUniqueOrThrow({ where: { id: target.id } });
  assert.equal(afterChange.password_change_required, false);
  assert.equal(afterChange.credential_version, afterReset.credential_version + 1);
  assert.equal(await argon2.verify(afterChange.password_hash, newPassword, { type: argon2.argon2id }), true);
  pass("new permanent password is Argon2id and clears forced-change state");
  assert.equal(await prisma.password_change_challenge.count({ where: { user_id: target.id } }), 0);
  pass("successful change deletes all reset challenges");
  assert.equal((await request(origin, "POST", "/api/auth/password-change", { body: { challenge: resetChallenge, newPassword }, expected: 403 })).payload.error.code, "PASSWORD_CHANGE_INVALID");
  pass("password-change challenge is single-use");
  assert.equal((await request(origin, "POST", "/api/auth/login", { body: { identifier: target.email, password: temporaryPassword }, expected: 401 })).payload.error.code, "INVALID_CREDENTIALS");
  pass("temporary credential cannot authenticate after permanent password change");
  const normalLogin = await request(origin, "POST", "/api/auth/login", {
    body: { identifier: target.email, password: newPassword, remember: false }, expected: 409,
  });
  assert.equal(normalLogin.payload.error.code, "ACCOUNT_CONTEXT_REQUIRED");
  pass("normal multi-context login resumes after permanent password change");

  const passwordAudits = await prisma.audit_event.findMany({
    where: { target_id: target.id, action: { in: [AUDIT_ACTIONS.USER_PASSWORD_RESET, AUDIT_ACTIONS.USER_PASSWORD_CHANGED] } },
    orderBy: { occurred_at: "asc" },
  });
  assert.deepEqual(passwordAudits.map(event => event.action), [AUDIT_ACTIONS.USER_PASSWORD_RESET, AUDIT_ACTIONS.USER_PASSWORD_CHANGED]);
  assert.equal(passwordAudits[0].actor_user_id, company.id);
  assert.equal(passwordAudits[0].actor_assignment_id, company.assignments[0].id);
  assert.equal(passwordAudits[0].actor_scope, ROLE_SCOPES.COMPANY);
  assert.equal(passwordAudits[1].actor_user_id, target.id);
  assert.equal(passwordAudits[1].actor_assignment_id, null);
  assert.equal(passwordAudits[1].actor_scope, null);
  pass("reset and forced-change audits preserve authoritative admin and pre-auth identity actors");
  const serializedAudits = JSON.stringify(passwordAudits);
  assert.equal(serializedAudits.includes(temporaryPassword), false);
  assert.equal(serializedAudits.includes(newPassword), false);
  assert.equal(/password|authorization|cookie|jwt|token|hash|credential/i.test(JSON.stringify(passwordAudits.map(event => event.metadata))), false);
  pass("password audit metadata contains no credential material");

  const rollbackBefore = await prisma.users.findUniqueOrThrow({ where: { id: target.id } });
  const rollbackAuditCount = await prisma.audit_event.count({ where: { target_id: target.id } });
  await assert.rejects(() => resetCompanyUserPassword(target.id, auditInput(company, "invalid")));
  assert.deepEqual(await prisma.users.findUniqueOrThrow({ where: { id: target.id } }), rollbackBefore);
  assert.equal(await prisma.audit_event.count({ where: { target_id: target.id } }), rollbackAuditCount);
  pass("audit persistence failure rolls back password reset atomically");

  const firstRepeatedReset = await request(origin, "POST", `/api/company/users/${target.id}/password-reset`, { body: {}, cookie: companyCookie, expected: 200 });
  const firstRepeatedLogin = await request(origin, "POST", "/api/auth/login", {
    body: { identifier: target.email, password: firstRepeatedReset.payload.data.temporaryPassword }, expected: 409,
  });
  const secondRepeatedReset = await request(origin, "POST", `/api/company/users/${target.id}/password-reset`, { body: {}, cookie: companyCookie, expected: 200 });
  assert.equal((await request(origin, "POST", "/api/auth/password-change", {
    body: { challenge: firstRepeatedLogin.payload.passwordChange.challenge, newPassword }, expected: 403,
  })).payload.error.code, "PASSWORD_CHANGE_INVALID");
  assert.equal((await request(origin, "POST", "/api/auth/login", {
    body: { identifier: target.email, password: firstRepeatedReset.payload.data.temporaryPassword }, expected: 401,
  })).payload.error.code, "INVALID_CREDENTIALS");
  assert.equal((await request(origin, "POST", "/api/auth/login", {
    body: { identifier: target.email, password: secondRepeatedReset.payload.data.temporaryPassword }, expected: 409,
  })).payload.error.code, "PASSWORD_CHANGE_REQUIRED");
  pass("repeated reset deterministically invalidates the prior temporary credential and challenge");

  const secondSuperReset = await request(origin, "POST", `/api/company/users/${secondSuper.id}/password-reset`, {
    body: {}, cookie: companyCookie, expected: 200,
  });
  assert.ok(secondSuperReset.payload.data.temporaryPassword);
  const finalAccessProtection = await request(origin, "POST", `/api/company/users/${company.id}/deactivate`, {
    body: {}, cookie: companyCookie, expected: 409,
  });
  assert.equal(finalAccessProtection.payload.error.code, "FINAL_ACTIVE_SUPER_ADMIN_REQUIRED");
  pass("forced reset of one Super Admin cannot be followed by disabling the final usable Super Admin");

  const lifecycleAudits = await prisma.audit_event.findMany({
    where: { target_id: target.id, action: { in: [AUDIT_ACTIONS.HOTEL_ADMIN_IDENTITY_DEACTIVATED, AUDIT_ACTIONS.HOTEL_ADMIN_IDENTITY_REACTIVATED] } },
  });
  assert.equal(lifecycleAudits.length, 2);
  assert.ok(lifecycleAudits.every(event => event.actor_user_id === company.id && event.actor_scope === ROLE_SCOPES.COMPANY));
  pass("identity transition audit remains transactional and company-scoped");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
}

assert.equal(results.length, 40);
console.log(`Company Identity Security integration: ${results.length}/${results.length} passed`);
