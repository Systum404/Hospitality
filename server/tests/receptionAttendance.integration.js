// Explicit local-only integration test. Every temporary record is removed in finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { hotelAttendanceDateKey } from "../services/receptionAttendanceService.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";
import { deleteHotelFixtures } from "./helpers/hotelFixtureCleanup.js";

const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Local hms only");
const trackedModels = ["hotel", "users", "user_role", "attendance", "room_booking", "orders", "bill", "payment"];
const counts = async () => Object.fromEntries(await Promise.all(trackedModels.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const protectedBillBefore = await prisma.bill.findFirst({ orderBy: { created_at: "asc" }, include: { payments: true } });
const hotelId = randomUUID();
const otherHotelId = randomUUID();
const userIds = [];
const results = [];
const pass = name => results.push(name);
let server;

const addDays = (key, days) => {
  const value = new Date(`${key}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

try {
  await prisma.hotel.createMany({ data: [
    { id: hotelId, name: `Attendance test ${hotelId}`, status: "ACTIVE", timezone: "America/New_York" },
    { id: otherHotelId, name: `Attendance isolation ${otherHotelId}`, status: "ACTIVE", timezone: "Pacific/Auckland" },
  ].map(entitledHotelFixture) });
  const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
  const actors = {};
  for (const roleName of ["Reception", "Manager", "Admin", "Captain", "Kitchen"]) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    const userId = randomUUID();
    const userRoleId = randomUUID();
    userIds.push(userId);
    await prisma.users.create({ data: { id: userId, email: `${userId}@attendance-test.invalid`, name: `${roleName} Attendance Test`, password_hash: passwordHash, phone: "9000000000" } });
    await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: role.id, hotel_id: hotelId } });
    actors[roleName] = { userId, userRoleId, token: await createAuthenticationToken({ userId, userRoleId }, 600) };
  }
  const otherRole = await prisma.role.findUniqueOrThrow({ where: { name: "Reception" } });
  const otherUserId = randomUUID();
  const otherUserRoleId = randomUUID();
  userIds.push(otherUserId);
  await prisma.users.create({ data: { id: otherUserId, email: `${otherUserId}@attendance-test.invalid`, name: "Other Hotel User", password_hash: passwordHash } });
  await prisma.user_role.create({ data: { id: otherUserRoleId, user_id: otherUserId, role_id: otherRole.id, hotel_id: otherHotelId } });
  const otherToken = await createAuthenticationToken({ userId: otherUserId, userRoleId: otherUserRoleId }, 600);

  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const today = hotelAttendanceDateKey(new Date(), "America/New_York");
  const otherToday = hotelAttendanceDateKey(new Date(), "Pacific/Auckland");
  const request = async ({ role = "Reception", tenant = hotelId, method = "GET", query = `?date=${today}`, body, token: explicitToken, headers = {} } = {}) => {
    const token = explicitToken ?? actors[role]?.token;
    const response = await fetch(`${origin}/api/hotels/${tenant}/reception/attendance${query}`, {
      method,
      headers: { ...(token ? { Cookie: `aazira_auth=${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  const write = (role, userId, status = "present", attendanceDate = today) => request({ role, method: "PUT", query: "", body: { userId, attendanceDate, status } });

  assert.equal((await request({ token: "", role: "" })).status, 401); pass("unauthenticated read rejected");
  const initial = await request();
  assert.equal(initial.status, 200); pass("Reception can retrieve attendance");
  assert.equal(initial.body.data.date, today); pass("selected date returned");
  assert.equal(initial.body.data.timezone, "America/New_York"); pass("stored hotel timezone returned");
  assert.equal(initial.body.data.users.length, 5); pass("active hotel users returned");
  assert.ok(initial.body.data.users.every(row => row.attendanceStatus === "unmarked")); pass("missing records remain unmarked");
  assert.ok(!JSON.stringify(initial.body).includes(otherUserId)); pass("other-hotel user excluded");
  assert.ok(!JSON.stringify(initial.body).includes("password_hash") && !JSON.stringify(initial.body).includes(passwordHash)); pass("password hashes excluded");
  assert.ok(!JSON.stringify(initial.body).includes("last_login") && !JSON.stringify(initial.body).includes("9000000000")); pass("unnecessary private fields excluded");
  assert.equal((await request({ query: "?date=2026-02-30" })).status, 400); pass("invalid read date rejected");
  assert.equal((await request({ tenant: otherHotelId })).status, 403); pass("cross-hotel URL read rejected");
  assert.equal((await request({ role: "Captain" })).status, 403); pass("Captain read rejected");
  assert.equal((await request({ role: "Kitchen" })).status, 403); pass("Kitchen read rejected");
  assert.equal((await request({ role: "Manager" })).status, 200); pass("Manager can view attendance");
  assert.equal((await request({ role: "Admin" })).status, 200); pass("Admin can view attendance");
  assert.equal((await request({ method: "PUT", query: "", body: { userId: actors.Manager.userId, attendanceDate: today, status: "present" }, headers: { Origin: "https://untrusted.example" } })).status, 403); pass("untrusted-origin attendance write rejected");
  assert.equal((await request({ tenant: otherHotelId, token: otherToken, query: "" })).body.data.date, otherToday); pass("default date follows each hotel timezone");
  assert.equal(hotelAttendanceDateKey(new Date("2026-01-01T05:01:00.000Z"), "America/New_York"), "2026-01-01");
  assert.equal(hotelAttendanceDateKey(new Date("2026-01-01T04:59:00.000Z"), "America/New_York"), "2025-12-31"); pass("local-midnight boundary is correct");
  assert.equal(hotelAttendanceDateKey(new Date("2026-01-01T18:31:00.000Z"), "Asia/Kolkata"), "2026-01-02"); pass("different IANA timezone boundary is correct");

  assert.equal((await write("Reception", actors.Manager.userId)).status, 200); pass("Reception can record valid attendance");
  let persisted = await prisma.attendance.findFirst({ where: { hotel_id: hotelId, user_id: actors.Manager.userId, attendance_date: new Date(`${today}T00:00:00.000Z`) } });
  assert.equal(persisted.status, "present"); pass("attendance persists in PostgreSQL");
  assert.equal(persisted.recorded_by, actors.Reception.userId); pass("acting user is preserved");
  assert.equal((await write("Reception", actors.Manager.userId)).status, 200);
  assert.equal(await prisma.attendance.count({ where: { hotel_id: hotelId, user_id: actors.Manager.userId, attendance_date: persisted.attendance_date } }), 1); pass("repeated write does not duplicate");
  assert.equal((await write("Reception", actors.Manager.userId, "absent")).status, 403); pass("Reception cannot correct an existing mark");
  assert.equal((await write("Manager", actors.Manager.userId, "absent")).status, 200); pass("Manager can correct attendance");
  persisted = await prisma.attendance.findUniqueOrThrow({ where: { id: persisted.id } });
  assert.equal(persisted.status, "absent"); assert.equal(persisted.recorded_by, actors.Manager.userId); pass("Manager correction and actor persist");
  assert.equal((await write("Admin", actors.Manager.userId, "present")).status, 200); pass("Admin can correct attendance");
  assert.equal((await write("Captain", actors.Kitchen.userId)).status, 403); pass("unauthorized role cannot record/correct");
  assert.equal((await write("Kitchen", actors.Kitchen.userId)).status, 403); pass("Kitchen cannot record/correct");
  assert.equal((await write("Reception", randomUUID())).status, 404); pass("unknown user rejected");
  assert.equal((await write("Reception", otherUserId)).status, 404); pass("cross-hotel user rejected");
  assert.equal((await write("Reception", actors.Kitchen.userId, "late")).status, 400); pass("invalid status rejected");
  assert.equal((await write("Reception", actors.Kitchen.userId, "present", "2026-02-30")).status, 400); pass("invalid write date rejected");
  assert.equal((await write("Reception", actors.Kitchen.userId, "present", addDays(today, 1))).status, 400); pass("future hotel-local write rejected");
  assert.equal((await request({ method: "PUT", query: "", body: { userId: "bad", attendanceDate: today, status: "present" } })).status, 400); pass("invalid user UUID rejected");
  assert.equal((await request({ tenant: "bad" })).status, 400); pass("invalid hotel UUID rejected");

  await write("Manager", actors.Captain.userId, "absent");
  await prisma.users.update({ where: { id: actors.Captain.userId }, data: { is_active: false } });
  const historical = await request();
  assert.ok(historical.body.data.users.some(row => row.id === actors.Captain.userId && !row.isActive && row.attendanceStatus === "absent")); pass("inactive historical user remains visible when marked");
  await prisma.users.update({ where: { id: actors.Captain.userId }, data: { is_active: true } });

  const concurrent = await Promise.all([write("Manager", actors.Kitchen.userId), write("Manager", actors.Kitchen.userId)]);
  assert.ok(concurrent.every(result => result.status === 200));
  assert.equal(await prisma.attendance.count({ where: { hotel_id: hotelId, user_id: actors.Kitchen.userId } }), 1); pass("concurrent same-user/day writes create one row");
  await assert.rejects(() => prisma.attendance.create({ data: { id: randomUUID(), hotel_id: hotelId, user_id: actors.Kitchen.userId, user_role_id: actors.Kitchen.userRoleId, attendance_date: new Date(`${today}T00:00:00.000Z`), status: "present", recorded_by: actors.Manager.userId } }), error => error.code === "P2002"); pass("database unique constraint enforced");
  await assert.rejects(() => prisma.attendance.create({ data: { id: randomUUID(), hotel_id: hotelId, user_id: otherUserId, user_role_id: actors.Kitchen.userRoleId, attendance_date: new Date(`${today}T00:00:00.000Z`), status: "present", recorded_by: actors.Manager.userId } }), error => error.code === "P2003"); pass("database assignment foreign key rejects cross-hotel user pairing");
  assert.equal(await prisma.attendance.count({ where: { hotel_id: otherHotelId } }), 0); pass("Hotel B attendance remains unchanged");
  assert.deepEqual(await prisma.bill.findFirst({ orderBy: { created_at: "asc" }, include: { payments: true } }), protectedBillBefore); pass("unrelated financial records unchanged");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma.attendance.deleteMany({ where: { hotel_id: { in: [hotelId, otherHotelId] } } });
  await prisma.users.deleteMany({ where: { id: { in: userIds } } });
  await deleteHotelFixtures([hotelId, otherHotelId]);
  const after = await counts();
  assert.deepEqual(after, before);
  assert.deepEqual(await prisma.bill.findFirst({ orderBy: { created_at: "asc" }, include: { payments: true } }), protectedBillBefore);
  console.log(JSON.stringify({ checks: results.length, results, countsBeforeAndAfter: after, cleanup: "All Reception Attendance fixtures removed.", unrelatedFinancialRecords: "unchanged" }));
  await prisma.$disconnect();
}
