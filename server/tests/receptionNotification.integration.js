// Explicit local-only integration test. Every temporary record is removed in finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";
import { deleteHotelFixtures } from "./helpers/hotelFixtureCleanup.js";

const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Local hms only");

const trackedModels = ["hotel", "users", "user_role", "notification", "attendance", "room_booking", "orders", "bill", "payment"];
const counts = async () => Object.fromEntries(await Promise.all(trackedModels.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const protectedBillBefore = await prisma.bill.findFirst({ orderBy: { created_at: "asc" }, include: { payments: true } });
const hotelId = randomUUID();
const otherHotelId = randomUUID();
const userIds = [];
const notificationIds = [];
const results = [];
const pass = name => results.push(name);
let server;

try {
  await prisma.hotel.createMany({ data: [
    { id: hotelId, name: `Notification test ${hotelId}`, status: "ACTIVE", timezone: "America/New_York" },
    { id: otherHotelId, name: `Notification isolation ${otherHotelId}`, status: "ACTIVE", timezone: "Pacific/Auckland" },
  ].map(entitledHotelFixture) });
  const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
  const actors = {};
  for (const roleName of ["Reception", "Manager", "Admin", "Captain", "Kitchen"]) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    const userId = randomUUID();
    const userRoleId = randomUUID();
    userIds.push(userId);
    await prisma.users.create({ data: { id: userId, email: `${userId}@notification-test.invalid`, name: `${roleName} Notification Test`, password_hash: passwordHash } });
    await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: role.id, hotel_id: hotelId } });
    actors[roleName] = { userId, token: await createAuthenticationToken({ userId, userRoleId }, 600) };
  }

  const receptionRole = await prisma.role.findUniqueOrThrow({ where: { name: "Reception" } });
  for (const [name, tenant] of [["Same Hotel Reception", hotelId], ["Other Hotel Reception", otherHotelId], ["Empty Reception", hotelId]]) {
    const userId = randomUUID();
    const userRoleId = randomUUID();
    userIds.push(userId);
    await prisma.users.create({ data: { id: userId, email: `${userId}@notification-test.invalid`, name, password_hash: passwordHash } });
    await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: receptionRole.id, hotel_id: tenant } });
    actors[name] = { userId, token: await createAuthenticationToken({ userId, userRoleId }, 600), hotelId: tenant };
  }

  const createNotification = async (userId, tenant, title, isRead, createdAt, eventKey = null) => {
    const id = randomUUID();
    notificationIds.push(id);
    await prisma.notification.create({ data: { id, hotel_id: tenant, user_id: userId, title, message: `${title} message`, type: "system", event_key: eventKey, is_read: isRead, action_url: "/internal/not-exposed", created_at: createdAt } });
    return id;
  };
  const oldestUnread = await createNotification(actors.Reception.userId, hotelId, "Old unread", false, new Date("2026-01-01T12:00:00.000Z"));
  const readId = await createNotification(actors.Reception.userId, hotelId, "Already read", true, new Date("2026-01-02T12:00:00.000Z"));
  const newestUnread = await createNotification(actors.Reception.userId, hotelId, "Newest unread", false, new Date("2026-01-03T12:00:00.000Z"));
  const sameHotelOtherUserId = await createNotification(actors["Same Hotel Reception"].userId, hotelId, "Other user", false, new Date("2026-01-04T12:00:00.000Z"));
  const otherHotelNotificationId = await createNotification(actors["Other Hotel Reception"].userId, otherHotelId, "Other hotel", false, new Date("2026-01-05T12:00:00.000Z"));
  const legacyUnscopedId = await createNotification(actors.Reception.userId, null, "Unscoped legacy", false, new Date("2026-01-06T12:00:00.000Z"));
  const roleNotificationIds = {};
  for (const roleName of ["Manager", "Admin", "Captain", "Kitchen"]) {
    roleNotificationIds[roleName] = await createNotification(actors[roleName].userId, hotelId, `${roleName} persisted`, false, new Date("2026-01-07T12:00:00.000Z"), `test-role:${roleName.toLowerCase()}`);
  }

  for (let index = 0; index < 51; index += 1) {
    await createNotification(actors.Kitchen.userId, hotelId, `Kitchen page ${index}`, false, new Date(Date.UTC(2026, 1, 1, 0, index)), `test-kitchen-page:${index}`);
  }

  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async ({ role = "Reception", tenant = hotelId, method = "GET", suffix = "", token: explicitToken } = {}) => {
    const token = explicitToken ?? actors[role]?.token;
    const response = await fetch(`${origin}/api/hotels/${tenant}/notifications${suffix}`, {
      method,
      headers: token ? { Cookie: `aazira_auth=${token}` } : {},
    });
    return { status: response.status, body: await response.json() };
  };

  assert.equal((await request({ token: "", role: "" })).status, 401); pass("unauthenticated list rejected");
  assert.equal((await request({ token: "", role: "", method: "PATCH", suffix: `/${newestUnread}/read` })).status, 401); pass("unauthenticated mutation rejected");
  const initial = await request();
  assert.equal(initial.status, 200); pass("Reception can list notifications");
  assert.equal(initial.body.data.timezone, "America/New_York"); pass("hotel timezone returned for presentation");
  assert.deepEqual(initial.body.data.notifications.map(row => row.id), [newestUnread, readId, oldestUnread]); pass("notifications ordered newest first");
  assert.equal(initial.body.data.unreadCount, 2); pass("unread count is server-derived");
  assert.ok(initial.body.data.notifications.every(row => Object.keys(row).sort().join(",") === "createdAt,id,isRead,message,title,type")); pass("response contains only the safe contract");
  assert.ok(!JSON.stringify(initial.body).includes("password_hash") && !JSON.stringify(initial.body).includes("action_url")); pass("private and internal fields excluded");
  assert.ok(!JSON.stringify(initial.body).includes(sameHotelOtherUserId)); pass("same-hotel other-user notification excluded");
  assert.ok(!JSON.stringify(initial.body).includes(otherHotelNotificationId)); pass("other-hotel notification excluded");
  assert.ok(!JSON.stringify(initial.body).includes(legacyUnscopedId)); pass("unscoped legacy notification excluded");
  for (const roleName of ["Manager", "Admin", "Captain"]) {
    const roleResult = await request({ role: roleName });
    assert.equal(roleResult.status, 200);
    assert.deepEqual(roleResult.body.data.notifications.map(row => row.id), [roleNotificationIds[roleName]]);
    assert.equal(roleResult.body.data.unreadCount, 1);
    pass(`${roleName} retrieves only own persisted notifications`);
  }
  const kitchenResult = await request({ role: "Kitchen" });
  assert.equal(kitchenResult.status, 200);
  assert.equal(kitchenResult.body.data.notifications.length, 50);
  assert.equal(kitchenResult.body.data.unreadCount, 52);
  assert.ok(kitchenResult.body.data.notifications.every(row => row.id !== roleNotificationIds.Manager));
  pass("Kitchen retrieves latest 50 own notifications with full unread count");
  assert.equal((await request({ tenant: otherHotelId })).status, 403); pass("cross-hotel URL rejected");
  assert.equal((await request({ tenant: "bad" })).status, 400); pass("invalid hotel UUID rejected");
  assert.equal((await request({ method: "PATCH", suffix: "/bad/read" })).status, 400); pass("invalid notification UUID rejected");
  assert.equal((await request({ method: "PATCH", suffix: `/${randomUUID()}/read` })).status, 404); pass("unknown notification rejected");
  assert.equal((await request({ method: "PATCH", suffix: `/${sameHotelOtherUserId}/read` })).status, 404); pass("same-hotel cross-user mutation rejected");
  assert.equal((await request({ method: "PATCH", suffix: `/${otherHotelNotificationId}/read` })).status, 404); pass("cross-hotel notification mutation rejected");

  const managerCrossUser = await request({ role: "Manager", method: "PATCH", suffix: `/${roleNotificationIds.Admin}/read` });
  assert.equal(managerCrossUser.status, 404);
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: roleNotificationIds.Admin } })).is_read, false);
  pass("shared read-one cannot mutate another staff user's notification");
  const managerMarked = await request({ role: "Manager", method: "PATCH", suffix: `/${roleNotificationIds.Manager}/read` });
  assert.equal(managerMarked.status, 200);
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: roleNotificationIds.Manager } })).is_read, true);
  pass("shared read-one updates the authenticated recipient only");

  const marked = await request({ method: "PATCH", suffix: `/${newestUnread}/read` });
  assert.equal(marked.status, 200); assert.equal(marked.body.data.notification.isRead, true); pass("single notification marked read");
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: newestUnread } })).is_read, true); pass("single read persists in PostgreSQL");
  assert.equal((await request()).body.data.unreadCount, 1); pass("refetch returns updated unread count");
  assert.equal((await request({ method: "PATCH", suffix: `/${newestUnread}/read` })).status, 200); pass("single read is idempotent");
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: readId } })).is_read, true); pass("unrelated read notification unchanged");
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: sameHotelOtherUserId } })).is_read, false); pass("other user's notification unchanged");

  const all = await request({ method: "PATCH", suffix: "/read-all" });
  assert.equal(all.status, 200); assert.equal(all.body.data.updatedCount, 1); pass("mark-all updates only remaining scoped unread rows");
  assert.equal((await request()).body.data.unreadCount, 0); pass("mark-all persists across refetch");
  assert.equal((await request({ method: "PATCH", suffix: "/read-all" })).body.data.updatedCount, 0); pass("mark-all is idempotent");
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: otherHotelNotificationId } })).is_read, false); pass("other-hotel state unchanged");
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: legacyUnscopedId } })).is_read, false); pass("unscoped legacy state unchanged");

  const adminAll = await request({ role: "Admin", method: "PATCH", suffix: "/read-all" });
  assert.equal(adminAll.status, 200); assert.equal(adminAll.body.data.updatedCount, 1);
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: roleNotificationIds.Captain } })).is_read, false);
  pass("shared read-all updates only the authenticated recipient's hotel-scoped rows");

  const legacyResponse = await fetch(`${origin}/api/hotels/${hotelId}/reception/notifications`, { headers: { Cookie: `aazira_auth=${actors.Reception.token}` } });
  assert.equal(legacyResponse.status, 200); pass("Reception compatibility URL preserves the established API");
  const legacyManagerResponse = await fetch(`${origin}/api/hotels/${hotelId}/reception/notifications`, { headers: { Cookie: `aazira_auth=${actors.Manager.token}` } });
  assert.equal(legacyManagerResponse.status, 403); pass("Reception compatibility URL remains Reception-only");

  const empty = await request({ token: actors["Empty Reception"].token });
  assert.equal(empty.status, 200); assert.deepEqual(empty.body.data.notifications, []); assert.equal(empty.body.data.unreadCount, 0); pass("empty state returns an empty PostgreSQL-backed list");
  const countBeforeRead = await prisma.notification.count();
  await request({ token: actors["Empty Reception"].token });
  assert.equal(await prisma.notification.count(), countBeforeRead); pass("reads do not create fake notifications");

  await prisma.notification.update({ where: { id: oldestUnread }, data: { is_read: false } });
  const concurrent = await Promise.all([
    request({ method: "PATCH", suffix: `/${oldestUnread}/read` }),
    request({ method: "PATCH", suffix: `/${oldestUnread}/read` }),
  ]);
  assert.ok(concurrent.every(result => result.status === 200));
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: oldestUnread } })).is_read, true); pass("concurrent duplicate read requests are safe and deterministic");
  assert.deepEqual(await prisma.bill.findFirst({ orderBy: { created_at: "asc" }, include: { payments: true } }), protectedBillBefore); pass("unrelated financial records unchanged");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } });
  await prisma.users.deleteMany({ where: { id: { in: userIds } } });
  await deleteHotelFixtures([hotelId, otherHotelId]);
  const after = await counts();
  assert.deepEqual(after, before);
  assert.deepEqual(await prisma.bill.findFirst({ orderBy: { created_at: "asc" }, include: { payments: true } }), protectedBillBefore);
  console.log(JSON.stringify({ checks: results.length, results, countsBeforeAndAfter: after, cleanup: "All Reception Notification fixtures removed.", unrelatedFinancialRecords: "unchanged" }));
  await prisma.$disconnect();
}
