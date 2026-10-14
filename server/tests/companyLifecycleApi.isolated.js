import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { AUDIT_ACTIONS } from "../config/audit.js";
import { ASSIGNMENT_STATUSES, ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { activateHotel } from "../services/hotelLifecycleService.js";
import { createAuthenticationToken } from "../services/tokenService.js";

const results = [];
const pass = name => results.push(name);
let server;

async function actor(role, hotelId = null) {
  const userId = randomUUID();
  const userRoleId = randomUUID();
  await prisma.users.create({
    data: {
      id: userId,
      email: `${userId}@phase6.invalid`,
      name: role.system_key,
      password_hash: await argon2.hash(randomUUID()),
    },
  });
  await prisma.user_role.create({
    data: {
      id: userRoleId,
      user_id: userId,
      role_id: role.id,
      role_scope: role.scope,
      status: ASSIGNMENT_STATUSES.ACTIVE,
      hotel_id: hotelId,
    },
  });
  return {
    context: {
      assignmentActive: true,
      hotelId,
      roleKey: role.system_key,
      scope: role.scope,
      userActive: true,
      userId,
      userRoleId,
    },
    cookie: `aazira_auth=${await createAuthenticationToken({ userId, userRoleId }, 900)}`,
    userId,
    userRoleId,
  };
}

try {
  const hotel = await prisma.hotel.findFirstOrThrow({ orderBy: { created_at: "asc" } });
  const originalHotel = await prisma.hotel.findUniqueOrThrow({ where: { id: hotel.id } });
  const originalUsers = await prisma.users.count();
  const originalAssignments = await prisma.user_role.count();
  const roles = Object.fromEntries((await prisma.role.findMany()).map(role => [role.system_key, role]));
  const superAdmin = await actor(roles[ROLE_KEYS.SUPER_ADMIN]);
  const hotelActors = {};
  for (const roleKey of [ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION, ROLE_KEYS.CAPTAIN, ROLE_KEYS.KITCHEN]) {
    hotelActors[roleKey] = await actor(roles[roleKey], hotel.id);
  }

  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, path, { body, cookie, expected = 200 } = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
    return { payload, requestId: response.headers.get("x-request-id") };
  };

  assert.equal((await request("POST", `/api/company/hotels/${hotel.id}/deactivate`, { expected: 401 })).payload.error.code, "UNAUTHENTICATED");
  pass("unauthenticated lifecycle mutation is rejected");

  for (const roleKey of Object.keys(hotelActors)) {
    const response = await request("POST", `/api/company/hotels/${hotel.id}/deactivate`, {
      cookie: hotelActors[roleKey].cookie,
      expected: 403,
    });
    assert.equal(response.payload.error.code, "COMPANY_SCOPE_REQUIRED");
  }
  assert.equal((await prisma.hotel.findUniqueOrThrow({ where: { id: hotel.id } })).status, "ACTIVE");
  pass("all HOTEL-scoped roles are rejected without mutating lifecycle state");

  assert.equal((await request("POST", "/api/company/hotels/not-a-uuid/deactivate", { cookie: superAdmin.cookie, expected: 400 })).payload.error.code, "INVALID_HOTEL_ID");
  assert.equal((await request("POST", `/api/company/hotels/${randomUUID()}/deactivate`, { cookie: superAdmin.cookie, expected: 404 })).payload.error.code, "HOTEL_NOT_FOUND");
  pass("invalid and unknown lifecycle targets return controlled errors");

  const spoof = await request("POST", `/api/company/hotels/${hotel.id}/deactivate`, {
    body: { actor_user_id: randomUUID() },
    cookie: superAdmin.cookie,
    expected: 400,
  });
  assert.equal(spoof.payload.error.code, "UNSUPPORTED_HOTEL_LIFECYCLE_FIELD");
  assert.equal((await prisma.hotel.findUniqueOrThrow({ where: { id: hotel.id } })).status, "ACTIVE");
  pass("lifecycle request body cannot spoof actor or lifecycle state");

  const deactivateResults = await Promise.all([
    request("POST", `/api/company/hotels/${hotel.id}/deactivate`, { cookie: superAdmin.cookie }),
    request("POST", `/api/company/hotels/${hotel.id}/deactivate`, { cookie: superAdmin.cookie }),
  ]);
  assert.deepEqual(deactivateResults.map(result => result.payload.data.changed).sort(), [false, true]);
  assert.equal((await prisma.hotel.findUniqueOrThrow({ where: { id: hotel.id } })).status, "INACTIVE");
  pass("concurrent deactivation is serialized and idempotent");

  const deactivationAudits = await prisma.audit_event.findMany({
    where: { action: AUDIT_ACTIONS.HOTEL_DEACTIVATED, target_id: hotel.id },
  });
  assert.equal(deactivationAudits.length, 1);
  assert.equal(deactivationAudits[0].actor_user_id, superAdmin.userId);
  assert.equal(deactivationAudits[0].actor_assignment_id, superAdmin.userRoleId);
  assert.equal(deactivationAudits[0].actor_scope, ROLE_SCOPES.COMPANY);
  assert.equal(deactivationAudits[0].hotel_id, hotel.id);
  assert.ok(deactivateResults.some(result => result.requestId === deactivationAudits[0].request_id));
  assert.deepEqual(deactivationAudits[0].metadata, { current_status: "INACTIVE", previous_status: "ACTIVE" });
  pass("deactivation audit uses authoritative company actor, hotel, request, and status metadata");

  const inactiveDetail = await request("GET", `/api/company/hotels/${hotel.id}`, { cookie: superAdmin.cookie });
  assert.equal(inactiveDetail.payload.data.hotel.status, "INACTIVE");
  pass("company read access preserves inactive hotel visibility");

  const inactiveHotelAccess = await request("GET", `/api/hotels/${hotel.id}/users`, {
    cookie: hotelActors[ROLE_KEYS.HOTEL_ADMIN].cookie,
    expected: 403,
  });
  assert.equal(inactiveHotelAccess.payload.error.code, "HOTEL_INACTIVE");
  pass("inactive hotel assignments cannot hydrate an operational session");

  await assert.rejects(
    () => activateHotel(hotel.id, {
      actor: superAdmin.context,
      requestContext: { ipAddress: null, requestId: "invalid", userAgent: null },
    }),
    /requestContext\.requestId/,
  );
  assert.equal((await prisma.hotel.findUniqueOrThrow({ where: { id: hotel.id } })).status, "INACTIVE");
  assert.equal(await prisma.audit_event.count({ where: { action: AUDIT_ACTIONS.HOTEL_ACTIVATED, target_id: hotel.id } }), 0);
  pass("audit failure rolls back lifecycle mutation without a false success event");

  const activateResults = await Promise.all([
    request("POST", `/api/company/hotels/${hotel.id}/activate`, { cookie: superAdmin.cookie }),
    request("POST", `/api/company/hotels/${hotel.id}/activate`, { cookie: superAdmin.cookie }),
  ]);
  assert.deepEqual(activateResults.map(result => result.payload.data.changed).sort(), [false, true]);
  assert.equal((await prisma.hotel.findUniqueOrThrow({ where: { id: hotel.id } })).status, "ACTIVE");
  pass("concurrent activation is serialized and idempotent");

  const activationAudits = await prisma.audit_event.findMany({
    where: { action: AUDIT_ACTIONS.HOTEL_ACTIVATED, target_id: hotel.id },
  });
  assert.equal(activationAudits.length, 1);
  assert.equal(activationAudits[0].actor_user_id, superAdmin.userId);
  assert.equal(activationAudits[0].actor_assignment_id, superAdmin.userRoleId);
  assert.equal(activationAudits[0].actor_scope, ROLE_SCOPES.COMPANY);
  assert.equal(activationAudits[0].hotel_id, hotel.id);
  assert.ok(activateResults.some(result => result.requestId === activationAudits[0].request_id));
  assert.deepEqual(activationAudits[0].metadata, { current_status: "ACTIVE", previous_status: "INACTIVE" });
  pass("activation audit uses authoritative company actor, hotel, request, and status metadata");

  const auditCount = await prisma.audit_event.count({ where: { target_id: hotel.id } });
  const idempotent = await request("POST", `/api/company/hotels/${hotel.id}/activate`, { cookie: superAdmin.cookie });
  assert.equal(idempotent.payload.data.changed, false);
  assert.equal(await prisma.audit_event.count({ where: { target_id: hotel.id } }), auditCount);
  pass("idempotent lifecycle request creates no duplicate mutation audit");

  const finalHotel = await prisma.hotel.findUniqueOrThrow({ where: { id: hotel.id } });
  for (const field of Object.keys(originalHotel)) {
    if (!["status", "updated_at"].includes(field)) assert.deepEqual(finalHotel[field], originalHotel[field], field);
  }
  assert.equal(await prisma.users.count(), originalUsers + 6);
  assert.equal(await prisma.user_role.count(), originalAssignments + 6);
  pass("lifecycle changes preserve hotel metadata, rooms, users, and assignments");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma["$disconnect"]();
}

console.log(`Company Lifecycle API integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
