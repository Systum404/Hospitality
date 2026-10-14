// Explicit local-only integration test. Every committed fixture is removed in finally.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { HOTEL_STATUSES } from "../config/hotelLifecycle.js";
import { ASSIGNMENT_STATUSES, ROLE_KEYS } from "../config/roles.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { activateHotel, deactivateHotel } from "../services/hotelLifecycleService.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";

const database = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && database.pathname === "/hms", "Local hms only");

const models = ["hotel", "users", "role", "user_role", "room", "dining_area", "dining_table", "menu_category", "menu_item", "vendor", "inventory", "customer", "room_booking", "orders", "order_item", "bill", "bill_item", "payment", "qr_code", "attendance", "notification"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async model => [model, await prisma[model].count()])));
const before = await counts();
const results = [];
const pass = name => results.push(name);
const ids = { hotel: randomUUID(), user: randomUUID(), assignment: randomUUID(), area: randomUUID(), table: randomUUID(), category: randomUUID(), item: randomUUID(), qr: randomUUID() };
const password = `Lifecycle-${randomUUID()}`;
const email = `${randomUUID()}@hotel-lifecycle-test.invalid`;
let server;
let hotelStatusRestored = false;

async function request(origin, method, path, { body, cookie, expected = 200 } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(method === "POST" && /^\/api\/public\/qr\/[^/]+\/orders$/.test(path)
        ? { "X-Order-Tracking-Capability": randomBytes(32).toString("base64url") }
        : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return { payload, response };
}

try {
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { system_key: ROLE_KEYS.HOTEL_ADMIN } });
  await prisma.hotel.create({ data: entitledHotelFixture({ id: ids.hotel, name: `Lifecycle ${ids.hotel}` }) });
  assert.equal((await prisma.hotel.findUniqueOrThrow({ where: { id: ids.hotel } })).status, HOTEL_STATUSES.ACTIVE);
  pass("new and migrated hotels use the ACTIVE enum state");

  await prisma.users.create({ data: { id: ids.user, name: "Lifecycle Admin", email, password_hash: await argon2.hash(password, { type: argon2.argon2id }) } });
  await prisma.user_role.create({ data: { id: ids.assignment, hotel_id: ids.hotel, user_id: ids.user, role_id: adminRole.id, role_scope: adminRole.scope, status: ASSIGNMENT_STATUSES.ACTIVE } });
  await prisma.dining_area.create({ data: { id: ids.area, hotel_id: ids.hotel, name: "Lifecycle Area", status: "active" } });
  await prisma.dining_table.create({ data: { id: ids.table, hotel_id: ids.hotel, dining_area_id: ids.area, table_number: "L-1", capacity: 2, status: "available" } });
  await prisma.menu_category.create({ data: { id: ids.category, hotel_id: ids.hotel, name: "Lifecycle Menu", display_order: 0 } });
  await prisma.menu_item.create({ data: { id: ids.item, hotel_id: ids.hotel, category_id: ids.category, name: "Lifecycle Item", price: "10.00", is_available: true } });
  const qrToken = `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
  await prisma.qr_code.create({ data: { id: ids.qr, hotel_id: ids.hotel, code: qrToken, type: "dining_table", dining_table_id: ids.table } });

  const token = await createAuthenticationToken({ userId: ids.user, userRoleId: ids.assignment }, 600);
  const cookie = `aazira_auth=${token}`;
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const login = await request(origin, "POST", "/api/auth/login", { body: { identifier: email, password }, expected: 200 });
  assert.match(login.response.headers.get("set-cookie") || "", /aazira_auth=/);
  await request(origin, "GET", "/api/auth/session", { cookie, expected: 200 });
  pass("ACTIVE hotel login and session hydration succeed");

  const activeOrderKey = randomUUID();
  const activeOrder = await request(origin, "POST", `/api/public/qr/${qrToken}/orders`, {
    body: { idempotency_key: activeOrderKey, customer_name: "Lifecycle Guest", customer_phone: `9${Date.now()}`.slice(0, 20), items: [{ menu_item_id: ids.item, quantity: 1 }] },
    expected: 201,
  });
  assert.equal(activeOrder.payload.data.order.total_amount, "10.00");
  pass("ACTIVE hotel public QR ordering remains operational");

  const concurrentDeactivate = await Promise.all([deactivateHotel(ids.hotel), deactivateHotel(ids.hotel)]);
  assert.deepEqual(concurrentDeactivate.map(result => result.changed).sort(), [false, true]);
  assert.equal((await prisma.hotel.findUniqueOrThrow({ where: { id: ids.hotel } })).status, HOTEL_STATUSES.INACTIVE);
  pass("concurrent deactivation is row-locked and idempotent");

  const inactiveLogin = await request(origin, "POST", "/api/auth/login", { body: { identifier: email, password }, expected: 403 });
  assert.equal(inactiveLogin.payload.error.code, "HOTEL_INACTIVE");
  assert.equal(inactiveLogin.response.headers.get("set-cookie"), null);
  const inactiveSession = await request(origin, "GET", "/api/auth/session", { cookie, expected: 403 });
  assert.equal(inactiveSession.payload.error.code, "HOTEL_INACTIVE");
  pass("INACTIVE hotel rejects login and already-issued sessions without issuing a cookie");

  const blockedName = `Blocked ${randomUUID()}`;
  const beforeBlockedWrite = await prisma.menu_category.count({ where: { hotel_id: ids.hotel } });
  const blockedWrite = await request(origin, "POST", `/api/hotels/${ids.hotel}/menu-categories`, { body: { name: blockedName, display_order: 1, is_active: true }, cookie, expected: 403 });
  assert.equal(blockedWrite.payload.error.code, "HOTEL_INACTIVE");
  assert.equal(await prisma.menu_category.count({ where: { hotel_id: ids.hotel } }), beforeBlockedWrite);
  pass("existing session cannot mutate an INACTIVE hotel and leaves no partial row");

  await assert.rejects(
    () => prisma.menu_category.create({ data: { id: randomUUID(), hotel_id: ids.hotel, name: blockedName, display_order: 2 } }),
    error => `${error.message ?? ""} ${JSON.stringify(error.meta ?? {})}`.includes("HOTEL_INACTIVE"),
  );
  assert.equal(await prisma.menu_category.count({ where: { hotel_id: ids.hotel } }), beforeBlockedWrite);
  pass("database lifecycle guard rejects service-level operational writes after deactivation");

  const inactivePublic = await request(origin, "POST", `/api/public/qr/${qrToken}/orders`, {
    body: { idempotency_key: randomUUID(), customer_name: "Blocked Guest", customer_phone: `8${Date.now()}`.slice(0, 20), items: [{ menu_item_id: ids.item, quantity: 1 }] },
    expected: 404,
  });
  assert.equal(inactivePublic.payload.error.code, "QR_NOT_AVAILABLE");
  assert.equal(await prisma.orders.count({ where: { hotel_id: ids.hotel } }), 1);
  pass("INACTIVE hotel public QR uses the established unavailable response and creates nothing");

  const absentLifecycleRoute = await request(origin, "PATCH", `/api/hotels/${ids.hotel}/lifecycle`, { body: { status: "ACTIVE" }, cookie, expected: 404 });
  assert.equal(absentLifecycleRoute.payload.error.code, "ROUTE_NOT_FOUND");
  pass("Hotel Admin has no lifecycle mutation endpoint");

  const concurrentActivate = await Promise.all([activateHotel(ids.hotel), activateHotel(ids.hotel)]);
  hotelStatusRestored = true;
  assert.deepEqual(concurrentActivate.map(result => result.changed).sort(), [false, true]);
  pass("concurrent activation is row-locked and idempotent");

  const restoredWrite = await request(origin, "POST", `/api/hotels/${ids.hotel}/menu-categories`, { body: { name: `Restored ${randomUUID()}`, display_order: 1, is_active: true }, cookie, expected: 201 });
  assert.ok(restoredWrite.payload.data);
  pass("the same operational path succeeds again after reactivation");

  await assert.rejects(
    () => prisma.hotel.delete({ where: { id: ids.hotel } }),
    error => ["P2003", "P2039"].includes(error?.code),
  );
  assert.equal(await prisma.hotel.count({ where: { id: ids.hotel } }), 1);
  assert.equal(await prisma.orders.count({ where: { hotel_id: ids.hotel } }), 1);
  pass("RESTRICT foreign keys preserve populated hotel history from deletion");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  const hotel = await prisma.hotel.findUnique({ where: { id: ids.hotel }, select: { status: true } });
  if (hotel?.status === HOTEL_STATUSES.INACTIVE) {
    await activateHotel(ids.hotel);
    hotelStatusRestored = true;
  }
  if (hotelStatusRestored || hotel?.status === HOTEL_STATUSES.ACTIVE) {
    await prisma.order_item.deleteMany({ where: { orders: { hotel_id: ids.hotel } } });
    await prisma.orders.deleteMany({ where: { hotel_id: ids.hotel } });
    await prisma.qr_code.deleteMany({ where: { hotel_id: ids.hotel } });
    await prisma.menu_item.deleteMany({ where: { hotel_id: ids.hotel } });
    await prisma.menu_category.deleteMany({ where: { hotel_id: ids.hotel } });
    await prisma.dining_table.deleteMany({ where: { hotel_id: ids.hotel } });
    await prisma.dining_area.deleteMany({ where: { hotel_id: ids.hotel } });
    await prisma.customer.deleteMany({ where: { hotel_id: ids.hotel } });
    await prisma.user_role.deleteMany({ where: { hotel_id: ids.hotel } });
    await prisma.users.deleteMany({ where: { id: ids.user } });
    await prisma.hotel.deleteMany({ where: { id: ids.hotel } });
  }
  assert.deepEqual(await counts(), before, "Hotel lifecycle fixtures were not completely removed");
  await prisma.$disconnect();
}

console.log(`Hotel Lifecycle integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
