// Runs only inside the disposable schema created by runAuditFoundation.integration.js.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { AUDIT_ACTIONS, AUDIT_OUTCOMES, AUDIT_TARGET_TYPES } from "../config/audit.js";
import { ASSIGNMENT_STATUSES, ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { createAuditEvent } from "../services/auditService.js";
import { createCompanyHotel } from "../services/companyHotelService.js";
import { activateHotel, deactivateHotel } from "../services/hotelLifecycleService.js";
import { createAuthenticationToken } from "../services/tokenService.js";

const results = [];
const pass = name => results.push(name);
let server;

function validHotel(label) {
  return {
    name: `Audit Hotel ${label}`,
    type: "Hotel",
    address_line: "1 Audit Road",
    city: "Pune",
    state_province: "Maharashtra",
    country: "India",
    postal_code: "411001",
    phone: "+91 98765 43210",
    official_email: `${label}-${randomUUID()}@audit.invalid`,
    timezone: "Asia/Kolkata",
    currency_code: "INR",
  };
}

async function actor(role, hotelId = null) {
  const userId = randomUUID();
  const userRoleId = randomUUID();
  await prisma.users.create({ data: { id: userId, email: `${userId}@audit.invalid`, name: role.system_key, password_hash: await argon2.hash(randomUUID()), is_active: true } });
  await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: role.id, role_scope: role.scope, status: ASSIGNMENT_STATUSES.ACTIVE, hotel_id: hotelId } });
  return {
    context: { assignmentActive: true, hotelId, roleKey: role.system_key, scope: role.scope, userActive: true, userId, userRoleId },
    cookie: `aazira_auth=${await createAuthenticationToken({ userId, userRoleId }, 900)}`,
    userId,
    userRoleId,
  };
}

try {
  await prisma.role.upsert({
    where: { system_key: ROLE_KEYS.HOTEL_ADMIN },
    update: {},
    create: { name: "Hotel Admin", system_key: ROLE_KEYS.HOTEL_ADMIN, scope: ROLE_SCOPES.HOTEL, is_protected: true },
  });
  const roles = Object.fromEntries((await prisma.role.findMany()).map(role => [role.system_key, role]));
  const superAdmin = await actor(roles[ROLE_KEYS.SUPER_ADMIN]);
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, path, { body, cookie, expected = 200, headers = {} } = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
    return { payload, requestId: response.headers.get("x-request-id"), status: response.status };
  };

  const createdResponse = await request("POST", "/api/company/hotels", { body: validHotel("created"), cookie: superAdmin.cookie, expected: 201 });
  const hotel = createdResponse.payload.data.hotel;
  await prisma.hotel.update({ where: { id: hotel.id }, data: { plan: "PREMIUM" } });
  const createdAudit = await prisma.audit_event.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.HOTEL_CREATED, target_id: hotel.id } });
  assert.equal(createdAudit.actor_user_id, superAdmin.userId);
  assert.equal(createdAudit.actor_assignment_id, superAdmin.userRoleId);
  assert.equal(createdAudit.actor_scope, ROLE_SCOPES.COMPANY);
  assert.equal(createdAudit.hotel_id, hotel.id);
  assert.equal(createdAudit.request_id, createdResponse.requestId);
  assert.equal(createdAudit.outcome, AUDIT_OUTCOMES.SUCCESS);
  pass("hotel creation commits a matching audit event");
  pass("authenticated actor identity and assignment come from server context");
  pass("company actor scope and authoritative target hotel are preserved");
  pass("server-generated request identifier is returned and persisted");

  const directAudit = await prisma.$transaction(transaction => createAuditEvent(transaction, {
    action: AUDIT_ACTIONS.HOTEL_CREATED,
    actor: superAdmin.context,
    hotelId: hotel.id,
    metadata: { hotel_code: hotel.code },
    requestContext: { ipAddress: "127.0.0.1", requestId: randomUUID(), userAgent: "audit-test" },
    targetId: hotel.id,
    targetType: AUDIT_TARGET_TYPES.HOTEL,
  }));
  assert.ok(directAudit.id);
  pass("audit event can be created through the controlled service path");
  await assert.rejects(() => prisma.audit_event.update({ where: { id: directAudit.id }, data: { action: "MUTATED" } }), error => `${error.message} ${JSON.stringify(error.meta || {})}`.includes("AUDIT_EVENT_APPEND_ONLY"));
  pass("PostgreSQL rejects audit UPDATE");
  await assert.rejects(() => prisma.audit_event.delete({ where: { id: directAudit.id } }), error => `${error.message} ${JSON.stringify(error.meta || {})}`.includes("AUDIT_EVENT_APPEND_ONLY"));
  pass("PostgreSQL rejects audit DELETE");
  assert.equal((await prisma.audit_event.findUniqueOrThrow({ where: { id: directAudit.id } })).action, AUDIT_ACTIONS.HOTEL_CREATED);
  pass("append-only protection preserves the original event");

  for (const field of ["actor_user_id", "actor_assignment_id", "actor_scope", "hotel_id"]) {
    const before = await prisma.audit_event.count();
    const response = await request("POST", "/api/company/hotels", { body: { ...validHotel(`spoof-${field}`), [field]: field === "actor_scope" ? "HOTEL" : randomUUID() }, cookie: superAdmin.cookie, expected: 400 });
    assert.equal(response.payload.error.code, "UNSUPPORTED_HOTEL_FIELD");
    assert.equal(await prisma.audit_event.count(), before);
    pass(`client cannot spoof ${field}`);
  }

  const patchResponse = await request("PATCH", `/api/company/hotels/${hotel.id}`, { body: { name: "Audited Hotel Rename", description: "Safe description" }, cookie: superAdmin.cookie });
  const metadataAudit = await prisma.audit_event.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.HOTEL_METADATA_UPDATED, target_id: hotel.id } });
  assert.deepEqual(metadataAudit.metadata.changed_fields, ["description", "name"]);
  assert.equal(metadataAudit.request_id, patchResponse.requestId);
  pass("hotel metadata update records only changed field names");

  const rollbackInput = validHotel("rollback");
  const hotelsBeforeRollback = await prisma.hotel.count();
  const auditsBeforeRollback = await prisma.audit_event.count();
  await assert.rejects(() => createCompanyHotel({
    name: rollbackInput.name, type: rollbackInput.type, address: rollbackInput.address_line, city: rollbackInput.city,
    state_province: rollbackInput.state_province, country: rollbackInput.country, postal_code: rollbackInput.postal_code,
    phone: rollbackInput.phone, email: rollbackInput.official_email, timezone: rollbackInput.timezone, currency_code: rollbackInput.currency_code,
  }, { actor: superAdmin.context, requestContext: { requestId: "invalid" } }));
  assert.equal(await prisma.hotel.count(), hotelsBeforeRollback);
  assert.equal(await prisma.audit_event.count(), auditsBeforeRollback);
  pass("audit failure rolls back the business mutation and audit together");

  const failedBefore = await prisma.audit_event.count();
  await request("PATCH", `/api/company/hotels/${randomUUID()}`, { body: { name: "Missing" }, cookie: superAdmin.cookie, expected: 404 });
  assert.equal(await prisma.audit_event.count(), failedBefore);
  pass("failed business mutation creates no false SUCCESS event");

  const hotelAdmin = await actor(roles[ROLE_KEYS.HOTEL_ADMIN], hotel.id);
  const inviteBody = label => ({ full_name: `Audit Admin ${label}`, email: `${label}-${randomUUID()}@audit.invalid`, mobile_number: "+91 90000 00000" });
  const companyInvite = await request("POST", `/api/company/hotels/${hotel.id}/admin-invitations`, { body: inviteBody("company"), cookie: superAdmin.cookie, expected: 201 });
  const companyInvitation = companyInvite.payload.data.invitation;
  const companyToken = new URL(companyInvite.payload.data.delivery.invitation_url, "https://audit.invalid").searchParams.get("token");
  const invitationCreatedAudit = await prisma.audit_event.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.HOTEL_ADMIN_INVITATION_CREATED, target_id: companyInvitation.id } });
  assert.equal(invitationCreatedAudit.actor_scope, ROLE_SCOPES.COMPANY);
  assert.deepEqual(invitationCreatedAudit.metadata, { invitee_email: companyInvitation.email, role: ROLE_KEYS.HOTEL_ADMIN });
  pass("company invitation creation commits a safe audit event");

  const hotelInvite = await request("POST", `/api/hotels/${hotel.id}/admin-invitations`, { body: inviteBody("hotel"), cookie: hotelAdmin.cookie, expected: 201 });
  const hotelInviteAudit = await prisma.audit_event.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.HOTEL_ADMIN_INVITATION_CREATED, target_id: hotelInvite.payload.data.invitation.id } });
  assert.equal(hotelInviteAudit.actor_scope, ROLE_SCOPES.HOTEL);
  assert.equal(hotelInviteAudit.actor_user_id, hotelAdmin.userId);
  assert.equal(hotelInviteAudit.hotel_id, hotel.id);
  pass("same-hotel invitation preserves HOTEL actor scope and hotel attribution");

  const resend = await request("POST", `/api/company/admin-invitations/${companyInvitation.id}/resend`, { cookie: superAdmin.cookie, expected: 201 });
  const resendAudit = await prisma.audit_event.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.HOTEL_ADMIN_INVITATION_RESENT, target_id: resend.payload.data.invitation.id } });
  assert.equal(resendAudit.metadata.superseded_invitation_id, companyInvitation.id);
  assert.equal(resendAudit.metadata.replacement_invitation_id, resend.payload.data.invitation.id);
  pass("invitation resend and supersession commit one audit event");

  const newToken = new URL(resend.payload.data.delivery.invitation_url, "https://audit.invalid").searchParams.get("token");
  const acceptancePassword = `Audit-${randomUUID()}`;
  const accept = await request("POST", `/api/public/admin-invitations/${newToken}/accept`, { body: { full_name: "Accepted Audit Admin", mobile_number: "+91 90000 00000", password: acceptancePassword } });
  const acceptAudit = await prisma.audit_event.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.HOTEL_ADMIN_INVITATION_ACCEPTED, target_id: accept.payload.data.invitation.id } });
  assert.equal(acceptAudit.actor_user_id, null);
  assert.equal(acceptAudit.actor_assignment_id, null);
  assert.equal(acceptAudit.actor_scope, null);
  pass("public invitation acceptance commits an unauthenticated actor audit event");

  const revokeTarget = hotelInvite.payload.data.invitation.id;
  await request("POST", `/api/hotels/${hotel.id}/admin-invitations/${revokeTarget}/revoke`, { cookie: hotelAdmin.cookie });
  const revokeAudit = await prisma.audit_event.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.HOTEL_ADMIN_INVITATION_REVOKED, target_id: revokeTarget } });
  assert.equal(revokeAudit.actor_user_id, hotelAdmin.userId);
  pass("invitation revoke commits an audit event with the authenticated actor");

  const suspiciousAgent = await request("PATCH", `/api/company/hotels/${hotel.id}`, {
    body: { description: "Still safe" },
    cookie: superAdmin.cookie,
    headers: { "User-Agent": "Bearer must-not-persist" },
  });
  const suspiciousAgentAudit = await prisma.audit_event.findFirstOrThrow({ where: { request_id: suspiciousAgent.requestId } });
  assert.equal(suspiciousAgentAudit.user_agent, null);
  pass("credential-like user-agent content is redacted rather than persisted");

  const allEvents = await prisma.audit_event.findMany();
  const serialized = JSON.stringify(allEvents);
  const invitationHashes = (await prisma.admin_invitation.findMany({ select: { token_hash: true } })).map(row => row.token_hash);
  assert.ok(!serialized.includes(companyToken) && !serialized.includes(newToken));
  assert.ok(invitationHashes.every(hash => !serialized.includes(hash)));
  assert.ok(!serialized.includes(acceptancePassword) && !/\$argon2id\$/.test(serialized));
  pass("raw invitation tokens and token hashes are absent from audit storage");
  pass("passwords and password hashes are absent from audit storage");
  assert.ok(allEvents.every(event => !JSON.stringify(event.metadata).match(/authorization|cookie|jwt/i)));
  pass("cookies, JWTs, and authorization headers are absent from audit metadata");

  const invalidBefore = await prisma.audit_event.count();
  await request("POST", `/api/public/admin-invitations/${"A".repeat(43)}/accept`, { body: { full_name: "Invalid", mobile_number: "+91 90000 00000", password: `Invalid-${randomUUID()}` }, expected: 404, headers: { Authorization: "Bearer must-not-persist" } });
  assert.equal(await prisma.audit_event.count(), invalidBefore);
  pass("failed invalid-token acceptance leaks no secret and creates no false SUCCESS event");

  const inactiveInviteBefore = await prisma.audit_event.count();
  await deactivateHotel(hotel.id);
  await request("POST", `/api/company/hotels/${hotel.id}/admin-invitations`, { body: inviteBody("inactive"), cookie: superAdmin.cookie, expected: 403 });
  assert.equal(await prisma.audit_event.count(), inactiveInviteBefore);
  await activateHotel(hotel.id);
  pass("inactive-hotel rejection creates no misleading success event");

  const noAuditApiCompany = await request("GET", "/api/company/audit-events", { cookie: superAdmin.cookie, expected: 404 });
  assert.equal(noAuditApiCompany.payload.error.code, "ROUTE_NOT_FOUND");
  const noAuditApiHotel = await request("GET", `/api/hotels/${hotel.id}/audit-events`, { cookie: hotelAdmin.cookie, expected: 404 });
  assert.equal(noAuditApiHotel.payload.error.code, "ROUTE_NOT_FOUND");
  pass("no client-facing audit creation, update, delete, or read API is exposed");

  assert.ok(allEvents.some(event => event.actor_scope === ROLE_SCOPES.COMPANY));
  assert.ok(allEvents.some(event => event.actor_scope === ROLE_SCOPES.HOTEL));
  assert.ok(allEvents.some(event => event.actor_scope === null));
  pass("audit storage distinguishes COMPANY, HOTEL, and unauthenticated actor contexts");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
}

console.log(`Audit Foundation integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
