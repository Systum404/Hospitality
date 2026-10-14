// Explicit local-only integration test. Every committed fixture is removed in finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { ASSIGNMENT_STATUSES, ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { deleteHotelFixtures } from "./helpers/hotelFixtureCleanup.js";

const database = new URL(environment.databaseUrl);
const isolatedControlPlane = process.env.AAZIRA_ISOLATED_CONTROL_PLANE_TEST === "1" && database.pathname.startsWith("/hms_phase5_control_");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && (database.pathname === "/hms" || isolatedControlPlane), "Local hms only");

const trackedModels = ["hotel", "users", "role", "user_role", "room", "qr_code", "notification"];
const counts = async () => Object.fromEntries(await Promise.all(trackedModels.map(async model => [model, await prisma[model].count()])));
const before = await counts();
const fixture = { hotelIds: [], userIds: [] };
const results = [];
const pass = name => results.push(name);
let server;

const validHotel = suffix => ({
  name: `Phase 3 Hotel ${suffix}`,
  type: "Hotel",
  address_line: "1 Foundation Road",
  city: "Pune",
  state_province: "Maharashtra",
  country: "India",
  postal_code: "411001",
  phone: "+91 98765 43210",
  official_email: `phase3-${suffix}@example.invalid`,
  timezone: "Asia/Kolkata",
  currency_code: "inr",
  logo_url: "https://example.invalid/logo.png",
  website: "https://example.invalid",
  tax_registration_number: "GST-PHASE3",
  description: "Temporary Phase 3 integration fixture",
  check_in_time: "14:00",
  check_out_time: "11:00",
});

async function actor(role, hotelId = null) {
  const userId = randomUUID();
  const userRoleId = randomUUID();
  fixture.userIds.push(userId);
  await prisma.users.create({ data: { id: userId, email: `${userId}@phase3.invalid`, name: role.system_key, password_hash: await argon2.hash(randomUUID()) } });
  await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: role.id, role_scope: role.scope, status: ASSIGNMENT_STATUSES.ACTIVE, hotel_id: hotelId } });
  return { token: await createAuthenticationToken({ userId, userRoleId }, 900), userId };
}

try {
  const existingHotel = await prisma.hotel.findFirstOrThrow({ orderBy: { created_at: "asc" } });
  const existingIdentity = { id: existingHotel.id, name: existingHotel.name, phone: existingHotel.phone, email: existingHotel.email, timezone: existingHotel.timezone, status: existingHotel.status };
  const roles = Object.fromEntries((await prisma.role.findMany()).map(role => [role.system_key, role]));
  const superAdmin = await actor(roles[ROLE_KEYS.SUPER_ADMIN]);
  const scopedActors = {};
  for (const key of [ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION, ROLE_KEYS.CAPTAIN, ROLE_KEYS.KITCHEN]) {
    scopedActors[key] = await actor(roles[key], existingHotel.id);
  }

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

  assert.equal((await request("GET", "/api/company/hotels", { expected: 401 })).error.code, "UNAUTHENTICATED");
  pass("unauthenticated company hotel access is rejected");
  for (const key of [ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION, ROLE_KEYS.CAPTAIN, ROLE_KEYS.KITCHEN]) {
    const rejection = await request("GET", "/api/company/hotels", { expected: 403, token: scopedActors[key].token });
    assert.equal(rejection.error.code, "COMPANY_SCOPE_REQUIRED");
    pass(`${key} hotel scope is rejected from company hotel access`);
  }
  const forbiddenBaseline = await counts();
  assert.equal((await request("GET", `/api/company/hotels/${existingHotel.id}`, { expected: 403, token: scopedActors[ROLE_KEYS.HOTEL_ADMIN].token })).error.code, "COMPANY_SCOPE_REQUIRED");
  assert.equal((await request("POST", "/api/company/hotels", { body: validHotel("forbidden"), expected: 403, token: scopedActors[ROLE_KEYS.HOTEL_ADMIN].token })).error.code, "COMPANY_SCOPE_REQUIRED");
  assert.equal((await request("PATCH", `/api/company/hotels/${existingHotel.id}`, { body: { name: "Forbidden rename" }, expected: 403, token: scopedActors[ROLE_KEYS.HOTEL_ADMIN].token })).error.code, "COMPANY_SCOPE_REQUIRED");
  assert.deepEqual(await counts(), forbiddenBaseline);
  pass("Hotel Admin cannot list, read, create, or update company hotels and causes no mutation");

  const list = await request("GET", "/api/company/hotels?page=1&pageSize=25", { token: superAdmin.token });
  assert.equal(list.data.total, before.hotel);
  assert.equal(list.data.items.find(hotel => hotel.id === existingHotel.id).room_count, await prisma.room.count({ where: { hotel_id: existingHotel.id } }));
  pass("company Super Admin can list hotels with authoritative derived room count");

  const detail = await request("GET", `/api/company/hotels/${existingHotel.id}`, { token: superAdmin.token });
  assert.equal(detail.data.hotel.code, existingHotel.code);
  assert.deepEqual(Object.keys(detail.data.hotel).sort(), ["address_line", "check_in_time", "check_out_time", "city", "code", "country", "created_at", "currency_code", "description", "entitlement", "id", "logo_url", "name", "official_email", "phone", "plan", "postal_code", "room_count", "state_province", "status", "tax_registration_number", "timezone", "type", "updated_at", "website"].sort());
  pass("company detail returns only the safe hotel metadata projection");

  const sideEffectsBefore = await counts();
  const createdPayload = await request("POST", "/api/company/hotels", { body: validHotel("create"), expected: 201, token: superAdmin.token });
  const created = createdPayload.data.hotel;
  fixture.hotelIds.push(created.id);
  assert.match(created.code, /^HTL-\d+$/);
  assert.equal(created.status, "ACTIVE");
  assert.equal(created.currency_code, "INR");
  assert.equal(created.official_email, "phase3-create@example.invalid");
  assert.equal(created.room_count, 0);
  const sideEffectsAfter = await counts();
  assert.equal(sideEffectsAfter.hotel, sideEffectsBefore.hotel + 1);
  for (const model of ["users", "user_role", "room", "qr_code", "notification"]) assert.equal(sideEffectsAfter[model], sideEffectsBefore[model]);
  pass("valid creation generates code, defaults ACTIVE, normalizes metadata, and creates no placeholders");

  for (const [field, value] of [["name", undefined], ["type", undefined], ["address_line", undefined]]) {
    const body = validHotel(`missing-${field}`); delete body[field];
    assert.equal((await request("POST", "/api/company/hotels", { body, expected: 400, token: superAdmin.token })).error.code, "INVALID_HOTEL_METADATA");
    pass(`creation rejects missing ${field}`);
  }
  for (const [field, value] of [["official_email", "bad"], ["timezone", "Not/AZone"], ["currency_code", "RUPEES"], ["phone", "12"]]) {
    assert.equal((await request("POST", "/api/company/hotels", { body: { ...validHotel(`invalid-${field}`), [field]: value }, expected: 400, token: superAdmin.token })).error.code, "INVALID_HOTEL_METADATA");
    pass(`creation rejects invalid ${field}`);
  }
  for (const field of ["code", "id", "total_rooms", "number_of_rooms", "room_count", "status", "created_at"]) {
    const body = { ...validHotel(`protected-${field}`), [field]: field === "status" ? "INACTIVE" : "client-value" };
    assert.equal((await request("POST", "/api/company/hotels", { body, expected: 400, token: superAdmin.token })).error.code, "UNSUPPORTED_HOTEL_FIELD");
    pass(`creation rejects client-controlled ${field}`);
  }

  const originalCode = created.code;
  const updated = (await request("PATCH", `/api/company/hotels/${created.id}`, { body: { name: "Renamed Phase 3 Hotel", currency_code: "usd", city: "Mumbai", website: null }, token: superAdmin.token })).data.hotel;
  assert.equal(updated.name, "Renamed Phase 3 Hotel");
  assert.equal(updated.currency_code, "USD");
  assert.equal(updated.website, null);
  assert.equal(updated.code, originalCode);
  pass("Super Admin updates allowed metadata without changing hotel code");

  for (const field of ["code", "id", "room_count", "total_rooms", "status", "created_at"]) {
    assert.equal((await request("PATCH", `/api/company/hotels/${created.id}`, { body: { [field]: "blocked" }, expected: 400, token: superAdmin.token })).error.code, "UNSUPPORTED_HOTEL_FIELD");
    pass(`metadata PATCH rejects protected ${field}`);
  }
  assert.equal((await request("PATCH", `/api/company/hotels/${created.id}`, { body: {}, expected: 400, token: superAdmin.token })).error.code, "EMPTY_HOTEL_UPDATE");
  pass("empty metadata PATCH is rejected");

  await assert.rejects(() => prisma.hotel.update({ where: { id: created.id }, data: { code: "HTL-999999999" } }), error => `${error.message}`.includes("HOTEL_CODE_IMMUTABLE"));
  assert.equal((await prisma.hotel.findUniqueOrThrow({ where: { id: created.id } })).code, originalCode);
  pass("database trigger enforces hotel code immutability");

  const roomA = randomUUID();
  const roomB = randomUUID();
  await prisma.room.createMany({ data: [
    { id: roomA, hotel_id: created.id, room_number: "P3-01", status: "active" },
    { id: roomB, hotel_id: created.id, room_number: "P3-02", status: "active" },
  ] });
  assert.equal((await request("GET", `/api/company/hotels/${created.id}`, { token: superAdmin.token })).data.hotel.room_count, 2);
  await prisma.room.delete({ where: { id: roomB } });
  assert.equal((await request("GET", `/api/company/hotels/${created.id}`, { token: superAdmin.token })).data.hotel.room_count, 1);
  await prisma.room.delete({ where: { id: roomA } });
  pass("room count follows actual Room insertions and deletions without a stored counter");

  const concurrent = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
    const hotel = (await request("POST", "/api/company/hotels", { body: validHotel(`concurrent-${index}`), expected: 201, token: superAdmin.token })).data.hotel;
    fixture.hotelIds.push(hotel.id);
    return hotel;
  }));
  assert.equal(new Set(concurrent.map(hotel => hotel.code)).size, concurrent.length);
  assert.equal(await prisma.hotel.count({ where: { id: { in: concurrent.map(hotel => hotel.id) } } }), concurrent.length);
  pass("concurrent creation produces unique database-generated codes with no partial hotel");

  const paged = await request("GET", "/api/company/hotels?page=2&pageSize=2", { token: superAdmin.token });
  assert.equal(paged.data.page, 2); assert.equal(paged.data.pageSize, 2); assert.equal(paged.data.items.length, 2);
  assert.ok(paged.data.total >= before.hotel + 7);
  pass("hotel list is bounded and paginated");
  assert.equal((await request("GET", "/api/company/hotels?page=0", { expected: 400, token: superAdmin.token })).error.code, "INVALID_PAGINATION");
  pass("invalid pagination is rejected");
  assert.equal((await request("GET", "/api/company/hotels/not-a-uuid", { expected: 400, token: superAdmin.token })).error.code, "INVALID_HOTEL_ID");
  assert.equal((await request("GET", `/api/company/hotels/${randomUUID()}`, { expected: 404, token: superAdmin.token })).error.code, "HOTEL_NOT_FOUND");
  pass("invalid and unknown hotel identifiers return controlled errors");

  const preserved = await prisma.hotel.findUniqueOrThrow({ where: { id: existingHotel.id } });
  assert.deepEqual({ id: preserved.id, name: preserved.name, phone: preserved.phone, email: preserved.email, timezone: preserved.timezone, status: preserved.status }, existingIdentity);
  pass("existing hotel identity, contact semantics, timezone, and ACTIVE lifecycle remain unchanged");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await deleteHotelFixtures(fixture.hotelIds);
  if (fixture.userIds.length) await prisma.user_role.deleteMany({ where: { user_id: { in: fixture.userIds } } });
  if (fixture.userIds.length) await prisma.users.deleteMany({ where: { id: { in: fixture.userIds } } });
  assert.deepEqual(await counts(), before, "Phase 3 fixtures were not completely removed");
  await prisma.$disconnect();
}

console.log(`Company Hotel integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
