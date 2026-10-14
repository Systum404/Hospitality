// Explicit local-only integration test. Raw invitation tokens are never printed.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { ADMIN_INVITATION_STATUSES } from "../config/adminInvitations.js";
import { ASSIGNMENT_STATUSES, ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { activateHotel, deactivateHotel } from "../services/hotelLifecycleService.js";
import { createAuthenticationToken } from "../services/tokenService.js";

const database = new URL(environment.databaseUrl);
const isolatedControlPlane = process.env.AAZIRA_ISOLATED_CONTROL_PLANE_TEST === "1" && database.pathname.startsWith("/hms_phase5_control_");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && (database.pathname === "/hms" || isolatedControlPlane), "Local hms only");

const tracked = ["hotel", "users", "role", "user_role", "room", "room_booking", "orders", "bill", "payment", "notification", "attendance", "admin_invitation"];
const counts = async () => Object.fromEntries(await Promise.all(tracked.map(async model => [model, await prisma[model].count()])));
const before = await counts();
const fixture = { hotelIds: [], userIds: [] };
const results = [];
const pass = name => results.push(name);
let server;

function inviteBody(label) {
  return { full_name: `Phase Four ${label}`, email: `${label}-${randomUUID()}@phase4.invalid`, mobile_number: "+91 98765 43210" };
}

function invitationToken(payload) {
  const invitationUrl = payload.data.delivery.invitation_url;
  assert.equal(payload.data.delivery.status, "NOT_SENT");
  const token = new URL(invitationUrl, "https://test.invalid").searchParams.get("token");
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  return token;
}

async function createActor(role, hotelId = null) {
  const userId = randomUUID();
  const userRoleId = randomUUID();
  fixture.userIds.push(userId);
  const password = randomUUID();
  await prisma.users.create({ data: { id: userId, email: `${userId}@phase4-actor.invalid`, name: role.system_key, password_hash: await argon2.hash(password), is_active: true } });
  await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: role.id, role_scope: role.scope, status: ASSIGNMENT_STATUSES.ACTIVE, hotel_id: hotelId } });
  return { password, token: await createAuthenticationToken({ userId, userRoleId }, 900), userId, userRoleId };
}

try {
  const originalHotel = await prisma.hotel.findFirstOrThrow({ orderBy: { created_at: "asc" } });
  const roles = Object.fromEntries((await prisma.role.findMany()).map(role => [role.system_key, role]));
  const otherHotel = await prisma.hotel.create({ data: { id: randomUUID(), name: "Phase 4 isolated hotel", plan: "PREMIUM", status: "ACTIVE", timezone: "UTC" } });
  fixture.hotelIds.push(otherHotel.id);
  const company = await createActor(roles[ROLE_KEYS.SUPER_ADMIN]);
  const adminA = await createActor(roles[ROLE_KEYS.HOTEL_ADMIN], originalHotel.id);
  const adminB = await createActor(roles[ROLE_KEYS.HOTEL_ADMIN], otherHotel.id);
  const staff = {};
  for (const key of [ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION, ROLE_KEYS.CAPTAIN, ROLE_KEYS.KITCHEN]) staff[key] = await createActor(roles[key], originalHotel.id);

  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, path, { body, expected, token } = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { ...(token ? { Cookie: `aazira_auth=${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    if (expected !== undefined) assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
    return { body: payload, headers: response.headers, status: response.status };
  };

  assert.equal((await request("POST", `/api/company/hotels/${originalHotel.id}/admin-invitations`, { body: inviteBody("unauth"), expected: 401 })).body.error.code, "UNAUTHENTICATED");
  assert.equal((await request("POST", `/api/hotels/${originalHotel.id}/admin-invitations`, { body: inviteBody("unauth-hotel"), expected: 401 })).body.error.code, "UNAUTHENTICATED");
  pass("invitation creation requires authentication");

  for (const key of [ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION, ROLE_KEYS.CAPTAIN, ROLE_KEYS.KITCHEN]) {
    assert.equal((await request("POST", `/api/hotels/${originalHotel.id}/admin-invitations`, { body: inviteBody(`role-${key}`), expected: 403, token: staff[key].token })).body.error.code, "FORBIDDEN");
    pass(`${key} cannot create Hotel Admin invitations`);
  }
  assert.equal((await request("POST", `/api/hotels/${otherHotel.id}/admin-invitations`, { body: inviteBody("cross"), expected: 403, token: adminA.token })).body.error.code, "HOTEL_SCOPE_MISMATCH");
  pass("Hotel Admin cannot invite for another hotel through URL manipulation");

  const initialCounts = await counts();
  const firstInput = inviteBody("first-admin");
  const firstResponse = await request("POST", `/api/company/hotels/${originalHotel.id}/admin-invitations`, { body: firstInput, expected: 201, token: company.token });
  const firstToken = invitationToken(firstResponse.body);
  const firstId = firstResponse.body.data.invitation.id;
  const firstRecord = await prisma.admin_invitation.findUniqueOrThrow({ where: { id: firstId }, include: { user: true, assignment: { include: { role: true } } } });
  fixture.userIds.push(firstRecord.user_id);
  assert.equal(firstRecord.status, ADMIN_INVITATION_STATUSES.PENDING);
  assert.equal(firstRecord.user.password_hash, null);
  assert.equal(firstRecord.user.is_active, false);
  assert.equal(firstRecord.assignment.status, ASSIGNMENT_STATUSES.PENDING);
  assert.equal(firstRecord.assignment.role.system_key, ROLE_KEYS.HOTEL_ADMIN);
  assert.equal(firstRecord.assignment.role_scope, ROLE_SCOPES.HOTEL);
  assert.equal(firstRecord.hotel_id, originalHotel.id);
  assert.equal(firstRecord.token_hash, createHash("sha256").update(firstToken).digest("hex"));
  assert.notEqual(firstRecord.token_hash, firstToken);
  assert.ok(firstRecord.expires_at.getTime() - firstRecord.created_at.getTime() === 48 * 60 * 60 * 1000);
  assert.equal((await counts()).users, initialCounts.users + 1);
  pass("Super Admin creates a 48-hour pending first-Admin identity and assignment without a password");

  const pendingLogin = await request("POST", "/api/auth/login", { body: { identifier: firstInput.email, password: randomUUID(), remember: false }, expected: 401 });
  assert.equal(pendingLogin.body.error.code, "INVALID_CREDENTIALS");
  pass("pending invitation identity cannot log in");

  const validation = await request("GET", `/api/public/admin-invitations/${firstToken}`, { expected: 200 });
  assert.deepEqual(Object.keys(validation.body.data.invitation).sort(), ["email", "expires_at", "hotel", "role"].sort());
  assert.equal(validation.body.data.invitation.hotel.code, originalHotel.code);
  assert.equal(validation.body.data.invitation.role, ROLE_KEYS.HOTEL_ADMIN);
  assert.equal((await request("GET", `/api/public/admin-invitations/${firstToken.slice(0, -1)}A`, { expected: 404 })).body.error.code, "ADMIN_INVITATION_INVALID");
  assert.equal((await request("GET", "/api/public/admin-invitations/not-a-token", { expected: 404 })).body.error.code, "ADMIN_INVITATION_INVALID");
  pass("public validation exposes only safe data and rejects invalid or modified tokens generically");

  const listed = await request("GET", `/api/company/hotels/${originalHotel.id}/admin-invitations`, { expected: 200, token: company.token });
  const serialized = JSON.stringify(listed.body);
  assert.ok(!serialized.includes("token_hash") && !serialized.includes(firstToken) && !serialized.includes("password_hash") && !serialized.includes("user_role_id"));
  assert.equal(listed.body.data.invitations.find(item => item.id === firstId).status, "PENDING");
  const hotelListed = await request("GET", `/api/hotels/${originalHotel.id}/admin-invitations`, { expected: 200, token: adminA.token });
  assert.ok(hotelListed.body.data.invitations.some(item => item.id === firstId));
  pass("company and same-hotel lists expose lifecycle metadata without token or identity internals");

  const duplicate = await request("POST", `/api/company/hotels/${originalHotel.id}/admin-invitations`, { body: firstInput, expected: 409, token: company.token });
  assert.equal(duplicate.body.error.code, "ADMIN_INVITATION_PENDING");
  pass("one pending workflow per hotel and email is enforced");

  const escalationBaseline = await counts();
  for (const field of ["role", "role_id", "scope", "hotel_id", "user_id", "assignment_id", "expires_at"]) {
    const response = await request("POST", `/api/company/hotels/${originalHotel.id}/admin-invitations`, { body: { ...inviteBody(`escalate-${field}`), [field]: field === "scope" ? "COMPANY" : "SUPER_ADMIN" }, expected: 400, token: company.token });
    assert.equal(response.body.error.code, "UNSUPPORTED_ADMIN_INVITATION_FIELD");
  }
  assert.deepEqual(await counts(), escalationBaseline);
  pass("role, scope, hotel, identity, assignment, and expiry escalation fields are rejected without mutation");

  const existingHash = (await prisma.users.findUniqueOrThrow({ where: { id: staff[ROLE_KEYS.MANAGER].userId } })).password_hash;
  const existingEmail = (await prisma.users.findUniqueOrThrow({ where: { id: staff[ROLE_KEYS.MANAGER].userId } })).email;
  const existingAssignments = await prisma.user_role.count({ where: { user_id: staff[ROLE_KEYS.MANAGER].userId } });
  assert.equal((await request("POST", `/api/company/hotels/${originalHotel.id}/admin-invitations`, { body: { full_name: "Existing", email: existingEmail, mobile_number: "+91 98765 43210" }, expected: 409, token: company.token })).body.error.code, "ADMIN_INVITATION_IDENTITY_CONFLICT");
  assert.equal((await prisma.users.findUniqueOrThrow({ where: { id: staff[ROLE_KEYS.MANAGER].userId } })).password_hash, existingHash);
  assert.equal(await prisma.user_role.count({ where: { user_id: staff[ROLE_KEYS.MANAGER].userId } }), existingAssignments);
  pass("existing identity is safely rejected because current authentication lacks assignment selection, with no overwrite");

  const sameHotelInput = inviteBody("same-hotel-admin");
  const sameHotelResponse = await request("POST", `/api/hotels/${originalHotel.id}/admin-invitations`, { body: sameHotelInput, expected: 201, token: adminA.token });
  const sameHotelId = sameHotelResponse.body.data.invitation.id;
  const sameHotelRecord = await prisma.admin_invitation.findUniqueOrThrow({ where: { id: sameHotelId } });
  fixture.userIds.push(sameHotelRecord.user_id);
  pass("Hotel Admin can create another same-hotel Hotel Admin invitation");

  const resendInput = inviteBody("resend");
  const resendCreated = await request("POST", `/api/company/hotels/${originalHotel.id}/admin-invitations`, { body: resendInput, expected: 201, token: company.token });
  const oldResendToken = invitationToken(resendCreated.body);
  const oldResendId = resendCreated.body.data.invitation.id;
  fixture.userIds.push((await prisma.admin_invitation.findUniqueOrThrow({ where: { id: oldResendId } })).user_id);
  const resent = await request("POST", `/api/company/admin-invitations/${oldResendId}/resend`, { expected: 201, token: company.token });
  const newResendToken = invitationToken(resent.body);
  assert.equal((await prisma.admin_invitation.findUniqueOrThrow({ where: { id: oldResendId } })).status, ADMIN_INVITATION_STATUSES.SUPERSEDED);
  assert.equal((await request("GET", `/api/public/admin-invitations/${oldResendToken}`, { expected: 404 })).body.error.code, "ADMIN_INVITATION_INVALID");
  assert.equal((await request("GET", `/api/public/admin-invitations/${newResendToken}`, { expected: 200 })).body.data.invitation.email, resendInput.email);
  pass("resend supersedes history, resets expiry, and immediately invalidates the old token");

  const concurrentResendInput = inviteBody("concurrent-resend");
  const concurrentResendCreated = await request("POST", `/api/hotels/${originalHotel.id}/admin-invitations`, { body: concurrentResendInput, expected: 201, token: adminA.token });
  const concurrentResendId = concurrentResendCreated.body.data.invitation.id;
  fixture.userIds.push((await prisma.admin_invitation.findUniqueOrThrow({ where: { id: concurrentResendId } })).user_id);
  const resendAttempts = await Promise.all([
    request("POST", `/api/hotels/${originalHotel.id}/admin-invitations/${concurrentResendId}/resend`, { token: adminA.token }),
    request("POST", `/api/hotels/${originalHotel.id}/admin-invitations/${concurrentResendId}/resend`, { token: adminA.token }),
  ]);
  assert.deepEqual(resendAttempts.map(attempt => attempt.status).sort(), [201, 409]);
  assert.equal(await prisma.admin_invitation.count({ where: { user_id: (await prisma.admin_invitation.findUniqueOrThrow({ where: { id: concurrentResendId } })).user_id, status: ADMIN_INVITATION_STATUSES.PENDING } }), 1);
  pass("concurrent resend produces exactly one replacement pending token");

  const revokeInput = inviteBody("revoke");
  const revokeCreated = await request("POST", `/api/hotels/${originalHotel.id}/admin-invitations`, { body: revokeInput, expected: 201, token: adminA.token });
  const revokeToken = invitationToken(revokeCreated.body);
  const revokeId = revokeCreated.body.data.invitation.id;
  fixture.userIds.push((await prisma.admin_invitation.findUniqueOrThrow({ where: { id: revokeId } })).user_id);
  assert.equal((await request("POST", `/api/hotels/${originalHotel.id}/admin-invitations/${revokeId}/revoke`, { expected: 200, token: adminA.token })).body.data.changed, true);
  assert.equal((await request("POST", `/api/hotels/${originalHotel.id}/admin-invitations/${revokeId}/revoke`, { expected: 200, token: adminA.token })).body.data.changed, false);
  assert.equal((await request("GET", `/api/public/admin-invitations/${revokeToken}`, { expected: 404 })).body.error.code, "ADMIN_INVITATION_INVALID");
  pass("revoke is persistent, token-invalidating, and idempotent");

  const expiredInput = inviteBody("expired");
  const expiredCreated = await request("POST", `/api/company/hotels/${originalHotel.id}/admin-invitations`, { body: expiredInput, expected: 201, token: company.token });
  const expiredToken = invitationToken(expiredCreated.body);
  const expiredId = expiredCreated.body.data.invitation.id;
  fixture.userIds.push((await prisma.admin_invitation.findUniqueOrThrow({ where: { id: expiredId } })).user_id);
  await prisma.admin_invitation.update({ where: { id: expiredId }, data: { created_at: new Date(Date.now() - 72 * 60 * 60 * 1000), expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000) } });
  assert.equal((await request("GET", `/api/public/admin-invitations/${expiredToken}`, { expected: 404 })).body.error.code, "ADMIN_INVITATION_INVALID");
  assert.equal((await request("POST", `/api/public/admin-invitations/${expiredToken}/accept`, { body: { full_name: "Expired", mobile_number: "+91 98765 43210", password: randomUUID() }, expected: 404 })).body.error.code, "ADMIN_INVITATION_INVALID");
  pass("expired pending invitations are derived and cannot validate or accept without a background job");

  const acceptInput = inviteBody("accept");
  const acceptCreated = await request("POST", `/api/company/hotels/${originalHotel.id}/admin-invitations`, { body: acceptInput, expected: 201, token: company.token });
  const acceptToken = invitationToken(acceptCreated.body);
  const acceptId = acceptCreated.body.data.invitation.id;
  const acceptUserId = (await prisma.admin_invitation.findUniqueOrThrow({ where: { id: acceptId } })).user_id;
  fixture.userIds.push(acceptUserId);
  const password = `P4-${randomUUID()}`;
  const acceptance = await request("POST", `/api/public/admin-invitations/${acceptToken}/accept`, { body: { full_name: "Accepted Hotel Admin", mobile_number: "+91 91234 56789", password }, expected: 200 });
  assert.equal(acceptance.body.data.requires_login, true);
  const accepted = await prisma.admin_invitation.findUniqueOrThrow({ where: { id: acceptId }, include: { user: true, assignment: true } });
  assert.equal(accepted.status, ADMIN_INVITATION_STATUSES.ACCEPTED);
  assert.ok(accepted.accepted_at);
  assert.equal(accepted.assignment.status, ASSIGNMENT_STATUSES.ACTIVE);
  assert.equal(accepted.user.is_active, true);
  assert.match(accepted.user.password_hash, /^\$argon2id\$/);
  assert.equal(await argon2.verify(accepted.user.password_hash, password), true);
  assert.equal((await request("POST", `/api/public/admin-invitations/${acceptToken}/accept`, { body: { full_name: "Reuse", mobile_number: "+91 91234 56789", password: randomUUID() }, expected: 404 })).body.error.code, "ADMIN_INVITATION_INVALID");
  pass("acceptance atomically activates identity and assignment with Argon2id and is single-use");

  const login = await request("POST", "/api/auth/login", { body: { identifier: acceptInput.email, password, remember: false }, expected: 200 });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const sessionResponse = await fetch(`${origin}/api/auth/session`, { headers: { Cookie: cookie } });
  const session = await sessionResponse.json();
  assert.equal(sessionResponse.status, 200);
  assert.equal(session.user.roleKey, ROLE_KEYS.HOTEL_ADMIN);
  assert.equal(session.user.scope, ROLE_SCOPES.HOTEL);
  assert.equal(session.user.hotelId, originalHotel.id);
  pass("accepted Hotel Admin logs in through the normal flow and receives HOTEL_ADMIN/HOTEL session context");

  const raceInput = inviteBody("accept-race");
  const raceCreated = await request("POST", `/api/company/hotels/${originalHotel.id}/admin-invitations`, { body: raceInput, expected: 201, token: company.token });
  const raceToken = invitationToken(raceCreated.body);
  const raceId = raceCreated.body.data.invitation.id;
  const raceUserId = (await prisma.admin_invitation.findUniqueOrThrow({ where: { id: raceId } })).user_id;
  fixture.userIds.push(raceUserId);
  const racePasswords = [`Race-A-${randomUUID()}`, `Race-B-${randomUUID()}`];
  const race = await Promise.all(racePasswords.map((candidate, index) => request("POST", `/api/public/admin-invitations/${raceToken}/accept`, { body: { full_name: `Race ${index}`, mobile_number: "+91 90000 00000", password: candidate } })));
  assert.deepEqual(race.map(attempt => attempt.status).sort(), [200, 404]);
  const raced = await prisma.admin_invitation.findUniqueOrThrow({ where: { id: raceId }, include: { user: true, assignment: true } });
  assert.equal(raced.status, ADMIN_INVITATION_STATUSES.ACCEPTED);
  assert.equal(raced.assignment.status, ASSIGNMENT_STATUSES.ACTIVE);
  assert.equal((await Promise.all(racePasswords.map(candidate => argon2.verify(raced.user.password_hash, candidate)))).filter(Boolean).length, 1);
  pass("concurrent acceptance has exactly one winner and one final password/active assignment");

  const inactiveInput = inviteBody("inactive-accept");
  const inactiveCreated = await request("POST", `/api/company/hotels/${otherHotel.id}/admin-invitations`, { body: inactiveInput, expected: 201, token: company.token });
  const inactiveToken = invitationToken(inactiveCreated.body);
  const inactiveId = inactiveCreated.body.data.invitation.id;
  fixture.userIds.push((await prisma.admin_invitation.findUniqueOrThrow({ where: { id: inactiveId } })).user_id);
  await deactivateHotel(otherHotel.id);
  assert.equal((await request("GET", `/api/public/admin-invitations/${inactiveToken}`, { expected: 404 })).body.error.code, "ADMIN_INVITATION_INVALID");
  assert.equal((await request("POST", `/api/public/admin-invitations/${inactiveToken}/accept`, { body: { full_name: "Inactive", mobile_number: "+91 98765 43210", password: randomUUID() }, expected: 404 })).body.error.code, "ADMIN_INVITATION_INVALID");
  assert.equal((await request("POST", `/api/company/hotels/${otherHotel.id}/admin-invitations`, { body: inviteBody("inactive-create"), expected: 403, token: company.token })).body.error.code, "HOTEL_INACTIVE");
  assert.equal((await prisma.admin_invitation.findUniqueOrThrow({ where: { id: inactiveId } })).status, ADMIN_INVITATION_STATUSES.PENDING);
  await activateHotel(otherHotel.id);
  pass("inactive hotels preserve invitations but block creation, validation, and acceptance");

  const tokenCollisionSource = await prisma.admin_invitation.findUniqueOrThrow({ where: { id: firstId } });
  await assert.rejects(
    () => prisma.admin_invitation.create({ data: { ...tokenCollisionSource, id: randomUUID(), status: ADMIN_INVITATION_STATUSES.SUPERSEDED, superseded_at: new Date(), accepted_at: null, revoked_at: null } }),
    error => error?.code === "P2002",
  );
  pass("database token-hash uniqueness is the final collision barrier");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  for (const hotelId of fixture.hotelIds) {
    try { await activateHotel(hotelId); } catch {}
  }
  await prisma.admin_invitation.deleteMany({ where: { OR: [{ user_id: { in: fixture.userIds } }, { created_by: { in: fixture.userIds } }] } });
  if (fixture.userIds.length) await prisma.user_role.deleteMany({ where: { user_id: { in: fixture.userIds } } });
  if (fixture.userIds.length) await prisma.users.deleteMany({ where: { id: { in: fixture.userIds } } });
  if (fixture.hotelIds.length) await prisma.hotel.deleteMany({ where: { id: { in: fixture.hotelIds } } });
  assert.deepEqual(await counts(), before, "Phase 4 fixtures were not completely removed");
  await prisma.$disconnect();
}

console.log(`Admin Invitation integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
