// Explicit local-only PostgreSQL integration test. Fixtures are uniquely identified and removed in finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import pg from "pg";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { createBill, refreshBill } from "../services/billingService.js";

const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Local hms only");

const models = ["hotel", "users", "user_role", "room", "room_booking", "orders", "bill", "bill_item", "payment", "inventory", "notification"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const historicalNotificationsBefore = await prisma.notification.findMany({ orderBy: { id: "asc" } });
const fixture = { hotelIds: [], userIds: [], roomIds: [], bookingIds: [], billIds: [] };
const results = [];
const pass = name => results.push(name);

async function addUser(hotelId, roleId, password_hash, { active = true, role = true } = {}) {
  const userId = randomUUID();
  fixture.userIds.push(userId);
  await prisma.users.create({ data: { id: userId, email: `${userId}@notification-hardening.invalid`, name: "Notification hardening", password_hash, is_active: active } });
  if (role) await prisma.user_role.create({ data: { id: randomUUID(), user_id: userId, role_id: roleId, hotel_id: hotelId } });
  return userId;
}

async function cleanFixtures() {
  const client = new pg.Client({ connectionString: environment.databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    if (fixture.billIds.length) {
      await client.query("DELETE FROM payment WHERE bill_id = ANY($1::uuid[])", [fixture.billIds]);
      await client.query("DELETE FROM bill_item WHERE bill_id = ANY($1::uuid[])", [fixture.billIds]);
      await client.query("DELETE FROM bill WHERE id = ANY($1::uuid[])", [fixture.billIds]);
    }
    if (fixture.bookingIds.length) await client.query("DELETE FROM room_booking WHERE id = ANY($1::uuid[])", [fixture.bookingIds]);
    if (fixture.roomIds.length) await client.query("DELETE FROM room WHERE id = ANY($1::uuid[])", [fixture.roomIds]);
    if (fixture.hotelIds.length) {
      await client.query("DELETE FROM notification WHERE hotel_id = ANY($1::uuid[])", [fixture.hotelIds]);
      await client.query("DELETE FROM user_role WHERE hotel_id = ANY($1::uuid[])", [fixture.hotelIds]);
      await client.query("DELETE FROM hotel WHERE id = ANY($1::uuid[])", [fixture.hotelIds]);
    }
    if (fixture.userIds.length) await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [fixture.userIds]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

try {
  const managerRole = await prisma.role.findUniqueOrThrow({ where: { name: "Manager" } });
  const password_hash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
  const hotelId = randomUUID();
  fixture.hotelIds.push(hotelId);
  await prisma.hotel.create({ data: { id: hotelId, name: `Notification hardening ${hotelId}`, status: "ACTIVE", timezone: "Asia/Kolkata" } });
  const managerOne = await addUser(hotelId, managerRole.id, password_hash);
  const managerTwo = await addUser(hotelId, managerRole.id, password_hash);
  const inactiveManager = await addUser(hotelId, managerRole.id, password_hash, { active: false });

  const roomId = randomUUID();
  fixture.roomIds.push(roomId);
  await prisma.room.create({ data: { id: roomId, hotel_id: hotelId, room_number: "NOTIFICATION-HARDENING", status: "active", capacity: 2, base_price: "100.00" } });
  const billingBookingId = randomUUID();
  fixture.bookingIds.push(billingBookingId);
  await prisma.room_booking.create({ data: {
    id: billingBookingId, hotel_id: hotelId, room_id: roomId, booking_number: `NH-${randomUUID()}`,
    customer_name: "Concurrency Guest", customer_phone: "0000000000", adults: 1, children: 0,
    booking_from: new Date("2035-01-01T00:00:00.000Z"), booking_to: new Date("2035-01-02T00:00:00.000Z"),
    status: "checked-in", room_rate: "100.00", total_amount: "100.00", paid_amount: "0.00", payment_status: "pending", checked_in_at: new Date(),
  } });
  const auth = { hotelId, userId: managerOne, role: "Manager" };
  const draft = await createBill(auth, "ROOM", billingBookingId);
  fixture.billIds.push(draft.id);

  const finalizationResults = await Promise.allSettled([
    refreshBill(auth, draft.id, {}, true),
    refreshBill(auth, draft.id, {}, true),
  ]);
  assert.equal(finalizationResults.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(finalizationResults.filter(result => result.status === "rejected" && result.reason?.code === "BILL_SNAPSHOT_LOCKED").length, 1);
  assert.equal((await prisma.bill.findUniqueOrThrow({ where: { id: draft.id } })).status, "FINALIZED");
  const finalizationNotifications = await prisma.notification.findMany({ where: { hotel_id: hotelId, event_key: `manager-bill-finalized:${draft.id}` }, orderBy: { user_id: "asc" } });
  assert.equal(finalizationNotifications.length, 2);
  assert.deepEqual(finalizationNotifications.map(row => row.user_id), [managerOne, managerTwo].sort());
  assert.ok(!finalizationNotifications.some(row => row.user_id === inactiveManager));
  assert.ok(finalizationNotifications.every(row => row.title === "Bill Finalized" && row.type === "manager_operational"));
  pass("concurrent bill finalization leaves one valid FINALIZED bill and exactly one notification per active Manager");

  const userCascadeId = await addUser(hotelId, managerRole.id, password_hash, { role: false });
  const userCascadeNotificationId = randomUUID();
  await prisma.notification.create({ data: { id: userCascadeNotificationId, hotel_id: hotelId, user_id: userCascadeId, title: "User cascade", message: "User cascade fixture", type: "system", event_key: `user-cascade:${randomUUID()}` } });
  await prisma.users.delete({ where: { id: userCascadeId } });
  assert.equal(await prisma.notification.findUnique({ where: { id: userCascadeNotificationId } }), null);
  pass("user deletion removes that user's notifications through the existing foreign-key cascade");

  const hotelCascadeId = randomUUID();
  fixture.hotelIds.push(hotelCascadeId);
  await prisma.hotel.create({ data: { id: hotelCascadeId, name: `Notification hotel cascade ${hotelCascadeId}`, status: "ACTIVE", timezone: "UTC" } });
  const hotelCascadeUserId = await addUser(hotelCascadeId, managerRole.id, password_hash, { role: false });
  const hotelCascadeNotificationId = randomUUID();
  await prisma.notification.create({ data: { id: hotelCascadeNotificationId, hotel_id: hotelCascadeId, user_id: hotelCascadeUserId, title: "Hotel cascade", message: "Hotel cascade fixture", type: "system", event_key: `hotel-cascade:${randomUUID()}` } });
  await assert.rejects(
    () => prisma.hotel.delete({ where: { id: hotelCascadeId } }),
    error => ["P2003", "P2039"].includes(error?.code),
  );
  assert.ok(await prisma.notification.findUnique({ where: { id: hotelCascadeNotificationId } }));
  pass("hotel deletion is restricted and preserves that hotel's notifications");

  const sourceBookingId = randomUUID();
  fixture.bookingIds.push(sourceBookingId);
  await prisma.room_booking.create({ data: {
    id: sourceBookingId, hotel_id: hotelId, room_id: roomId, booking_number: `NH-SOURCE-${randomUUID()}`,
    customer_name: "Historical Source", customer_phone: "0000000001", adults: 1, children: 0,
    booking_from: new Date("2040-01-01T00:00:00.000Z"), booking_to: new Date("2040-01-02T00:00:00.000Z"),
    status: "reserved", room_rate: "100.00", total_amount: "100.00", paid_amount: "0.00", payment_status: "pending",
  } });
  const sourceNotificationId = randomUUID();
  await prisma.notification.create({ data: { id: sourceNotificationId, hotel_id: hotelId, user_id: managerOne, title: "Historical source", message: "Historical source fixture", type: "system", event_key: `booking-created:${sourceBookingId}` } });
  await prisma.room_booking.delete({ where: { id: sourceBookingId } });
  assert.ok(await prisma.notification.findUnique({ where: { id: sourceNotificationId } }));
  pass("normal source deletion preserves its textual historical notification");
} finally {
  await cleanFixtures();
  const after = await counts();
  assert.deepEqual(after, before);
  const historicalNotificationsAfter = await prisma.notification.findMany({ orderBy: { id: "asc" } });
  assert.deepEqual(JSON.parse(JSON.stringify(historicalNotificationsAfter)), JSON.parse(JSON.stringify(historicalNotificationsBefore)));
  console.log(JSON.stringify({ checks: results.length, results, countsBefore: before, countsAfter: after, cleanup: "All notification hardening fixtures removed; historical notifications unchanged." }));
  await prisma.$disconnect();
}
