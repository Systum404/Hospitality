// Explicit local-only integration test. Fixtures are isolated and removed in finally.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { ROLE_KEYS } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";
import { deleteHotelFixtures } from "./helpers/hotelFixtureCleanup.js";
import { notifyActiveHotelRoleUsers } from "../services/operationalNotificationService.js";

const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Local hms only");

const models = ["hotel", "users", "user_role", "dining_area", "dining_table", "menu_item", "orders", "order_item", "notification"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async (name) => [name, await prisma[name].count()])));
const before = await counts();
const fixture = { hotelIds: [], userIds: [] };
const results = [];
const pass = (name) => results.push(name);
let server;

try {
  const hotelA = randomUUID();
  const hotelB = randomUUID();
  fixture.hotelIds.push(hotelA, hotelB);
  await prisma.hotel.createMany({ data: [
  { id: hotelA, name: `Captain table-status test A ${hotelA}`, status: "ACTIVE" },
  { id: hotelB, name: `Captain table-status test B ${hotelB}`, status: "ACTIVE" },
  ].map(entitledHotelFixture) });

  const roles = Object.fromEntries(await Promise.all(["Captain", "Kitchen", "Manager"].map(async (name) => [name, await prisma.role.findUniqueOrThrow({ where: { name } })])));
  const tokens = {}, actorIds = {};
  const addActor = async (role, hotelId) => {
    const userId = randomUUID();
    const userRoleId = randomUUID();
    fixture.userIds.push(userId);
    await prisma.users.create({ data: { id: userId, name: `${role} lifecycle test`, email: `${userId}@captain-table-test.invalid`, password_hash: "temporary-integration-test-hash" } });
    await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: roles[role].id, hotel_id: hotelId } });
    tokens[`${role}:${hotelId}`] = await createAuthenticationToken({ userId, userRoleId }, 900);
    actorIds[`${role}:${hotelId}`] = userId;
  };
  await addActor("Captain", hotelA);
  await addActor("Captain", hotelB);
  await addActor("Kitchen", hotelA);
  await addActor("Manager", hotelA);

  const area = await prisma.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelA, name: `Status-${randomUUID().slice(0, 8)}`, status: "active" } });
  const table = async (label) => prisma.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelA, dining_area_id: area.id, table_number: `${label}-${randomUUID().slice(0, 8)}`, capacity: 4, status: "available" } });
  const captainTable = await table("CAP");
  const qrTable = await table("QR");
  const multipleTable = await table("MULTI");
  const deleteTable = await table("DELETE");
  const concurrencyTable = await table("RACE");
  const orderConcurrencyTable = await table("ORDER-RACE");
  const billingConcurrencyTable = await table("BILL-RACE");
  const readyConcurrencyTable = await table("READY-RACE");
  const item = await prisma.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelA, name: `Captain status item ${randomUUID()}`, price: "10.00", is_available: true } });

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const rawRequest = async (method, hotelId, path, { body, role = "Captain", tokenHotel = hotelId } = {}) => {
    const token = role ? tokens[`${role}:${tokenHotel}`] : null;
    const response = await fetch(`${origin}/api/hotels/${hotelId}${path}`, {
      method,
      headers: { ...(token ? { Cookie: `aazira_auth=${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  const request = async (method, hotelId, path, { expected = 200, ...options } = {}) => {
    const response = await rawRequest(method, hotelId, path, options);
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(response.body)}`);
    return response.body;
  };
  const createCaptainOrder = async (targetTable) => (await request("POST", hotelA, "/captain/orders", {
    expected: 201,
    body: { table_id: targetTable.id, customer_name: "Lifecycle guest", customer_phone: "000", items: [{ menu_item_id: item.id, quantity: 1 }] },
  })).data.order;

  const concurrentEventKey = `restaurant-order-created:${randomUUID()}`;
  await Promise.all([
    prisma.$transaction(tx => notifyActiveHotelRoleUsers(tx, hotelA, ROLE_KEYS.KITCHEN, { eventKey: concurrentEventKey, type: "restaurant_order", title: "New Restaurant Order", message: "Concurrent notification attempt." })),
    prisma.$transaction(tx => notifyActiveHotelRoleUsers(tx, hotelA, ROLE_KEYS.KITCHEN, { eventKey: concurrentEventKey, type: "restaurant_order", title: "New Restaurant Order", message: "Concurrent notification attempt." })),
  ]);
  assert.equal(await prisma.notification.count({ where: { hotel_id: hotelA, event_key: concurrentEventKey } }), 1);
  pass("concurrent logical event attempts create one Kitchen notification per recipient");

  const rollbackEventKey = `restaurant-order-created:${randomUUID()}`;
  const forcedRollback = new Error("ROLLBACK_NOTIFICATION");
  await assert.rejects(prisma.$transaction(async tx => {
    await notifyActiveHotelRoleUsers(tx, hotelA, ROLE_KEYS.KITCHEN, { eventKey: rollbackEventKey, type: "restaurant_order", title: "New Restaurant Order", message: "Must roll back." });
    throw forcedRollback;
  }), error => error === forcedRollback);
  assert.equal(await prisma.notification.count({ where: { hotel_id: hotelA, event_key: rollbackEventKey } }), 0);
  pass("rolled-back business transaction leaves no notification");
  const patchTable = async (targetTable, status, expected = 200) => request("PATCH", hotelA, `/captain/tables/${targetTable.id}/status`, { body: { status }, expected });
  const assertConflict = async (targetTable, status) => {
    const payload = await patchTable(targetTable, status, 409);
    assert.equal(payload.error.code, "CAPTAIN_TABLE_HAS_ACTIVE_ORDER");
    assert.equal((await prisma.dining_table.findUniqueOrThrow({ where: { id: targetTable.id } })).status, "occupied");
  };
  const createQrOrder = async (targetTable, status = "pending") => {
    const id = randomUUID();
    const key = randomUUID();
    await prisma.orders.create({ data: {
      id, hotel_id: hotelA, table_id: targetTable.id, captain_id: actorIds[`Captain:${hotelA}`], order_number: `QR-${randomUUID()}`, source: "dining_table_qr",
      customer_name: "QR lifecycle guest", customer_phone: "001", status, subtotal: "10.00", total_amount: "10.00",
      payment_status: "pending", idempotency_key: key, idempotency_fingerprint: createHash("sha256").update(key).digest("hex"),
    } });
    await prisma.dining_table.update({ where: { id: targetTable.id }, data: { status: "occupied" } });
    return id;
  };

  const captainOrder = await createCaptainOrder(captainTable);
  const originalTable = await prisma.dining_table.findUniqueOrThrow({ where: { id: captainTable.id } });
  const originalOrder = await prisma.orders.findUniqueOrThrow({ where: { id: captainOrder.id } });
  await assertConflict(captainTable, "available");
  pass("active Captain order blocks available and preserves occupied status");

  await assertConflict(captainTable, "reserved");
  pass("active Captain order blocks reserved and preserves occupied status");

  const idempotentOccupied = await patchTable(captainTable, "occupied");
  assert.equal(idempotentOccupied.data.dining_table.status, "occupied");
  pass("active-order table may remain occupied idempotently");

  await request("PATCH", hotelA, `/captain/orders/${captainOrder.id}`, { body: { status: "preparing" } });
  let synchronizedOrder = await prisma.orders.findUniqueOrThrow({ where: { id: captainOrder.id }, include: { order_item: true } });
  assert.equal(synchronizedOrder.status, "preparing");
  assert.ok(synchronizedOrder.order_item.every(row => row.status === "preparing"));
  pass("Captain status-only transition synchronizes existing item statuses");

  const explicitItems = (await request("PATCH", hotelA, `/captain/orders/${captainOrder.id}`, {
    body: { items: [{ menu_item_id: item.id, quantity: 2 }] },
  })).data.order;
  assert.equal(explicitItems.status, "preparing");
  assert.deepEqual(explicitItems.items.map(row => ({ quantity: row.quantity, status: row.status })), [{ quantity: 2, status: "preparing" }]);
  pass("Captain explicit item replacement preserves the effective order status");

  await request("PATCH", hotelA, `/captain/orders/${captainOrder.id}`, { role: "Manager", body: { status: "ready" }, expected: 403 });
  await request("PATCH", hotelA, `/captain/orders/${captainOrder.id}`, { tokenHotel: hotelB, body: { status: "ready" }, expected: 403 });
  synchronizedOrder = await prisma.orders.findUniqueOrThrow({ where: { id: captainOrder.id }, include: { order_item: true } });
  assert.equal(synchronizedOrder.status, "preparing");
  assert.ok(synchronizedOrder.order_item.every(row => row.status === "preparing"));
  pass("Captain order status synchronization preserves role authorization and hotel isolation");

  await assertConflict(captainTable, "available");
  await request("PATCH", hotelA, `/captain/orders/${captainOrder.id}`, { body: { status: "ready" } });
  synchronizedOrder = await prisma.orders.findUniqueOrThrow({ where: { id: captainOrder.id }, include: { order_item: true } });
  assert.equal(synchronizedOrder.status, "ready");
  assert.equal(synchronizedOrder.completed_at, null);
  assert.ok(synchronizedOrder.order_item.every(row => row.status === "ready"));
  await assertConflict(captainTable, "reserved");
  pass("pending, preparing, and ready Captain orders are all treated as active");

  const unchangedTable = await prisma.dining_table.findUniqueOrThrow({ where: { id: captainTable.id } });
  const unchangedOrder = await prisma.orders.findUniqueOrThrow({ where: { id: captainOrder.id } });
  assert.equal(unchangedTable.table_number, originalTable.table_number);
  assert.equal(unchangedTable.capacity, originalTable.capacity);
  assert.equal(unchangedOrder.customer_name, originalOrder.customer_name);
  assert.equal(unchangedOrder.status, "ready");
  pass("rejected status mutations do not change unrelated table or order fields");

  await request("PATCH", hotelA, `/kitchen/orders/${captainOrder.id}/status`, { role: "Kitchen", body: { status: "completed" } });
  const firstCompletion = await prisma.orders.findUniqueOrThrow({ where: { id: captainOrder.id }, include: { order_item: true } });
  assert.ok(firstCompletion.completed_at);
  assert.ok(firstCompletion.order_item.every(row => row.status === "completed"));
  await new Promise(resolve => setTimeout(resolve, 20));
  await request("PATCH", hotelA, `/kitchen/orders/${captainOrder.id}/status`, { role: "Kitchen", body: { status: "completed" } });
  const repeatedCompletion = await prisma.orders.findUniqueOrThrow({ where: { id: captainOrder.id }, include: { order_item: true } });
  assert.equal(repeatedCompletion.completed_at.getTime(), firstCompletion.completed_at.getTime());
  assert.ok(repeatedCompletion.order_item.every(row => row.status === "completed"));
  pass("Kitchen ready-to-completed sets completed_at once and repeated completion preserves it");

  assert.equal((await prisma.dining_table.findUniqueOrThrow({ where: { id: captainTable.id } })).status, "available");
  const completedTransition = await patchTable(captainTable, "reserved");
  assert.equal(completedTransition.data.dining_table.status, "reserved");
  pass("completing the last active order releases the table and completed history does not block status changes");

  const qrOrder = await createQrOrder(qrTable);
  await assertConflict(qrTable, "available");
  await assertConflict(qrTable, "reserved");
  assert.equal((await prisma.orders.findUniqueOrThrow({ where: { id: qrOrder } })).status, "pending");
  pass("active dining-table QR orders block available and reserved statuses");

  const first = await createQrOrder(multipleTable);
  const second = await createQrOrder(multipleTable);
  for (const status of ["preparing", "ready", "completed"]) {
    await request("PATCH", hotelA, `/kitchen/orders/${first}/status`, { role: "Kitchen", body: { status } });
  }
  assert.equal((await prisma.dining_table.findUniqueOrThrow({ where: { id: multipleTable.id } })).status, "occupied");
  await assertConflict(multipleTable, "available");
  assert.equal((await prisma.orders.findUniqueOrThrow({ where: { id: second } })).status, "pending");
  pass("completing one of multiple active orders preserves occupied status");

  const deletable = await createCaptainOrder(deleteTable);
  await request("DELETE", hotelA, `/captain/orders/${deletable.id}`);
  assert.equal((await prisma.dining_table.findUniqueOrThrow({ where: { id: deleteTable.id } })).status, "available");
  pass("deleting the last mutable active order preserves existing table release behavior");

  await request("PATCH", hotelA, `/captain/tables/${deleteTable.id}/status`, { role: null, body: { status: "reserved" }, expected: 401 });
  pass("authentication remains required");

  await request("PATCH", hotelA, `/captain/tables/${deleteTable.id}/status`, { role: "Manager", body: { status: "reserved" }, expected: 403 });
  pass("Captain table-status authorization remains Captain-only");

  await request("PATCH", hotelA, `/captain/tables/${deleteTable.id}/status`, { tokenHotel: hotelB, body: { status: "reserved" }, expected: 403 });
  pass("hotel scope remains enforced");

  await request("PATCH", hotelA, "/captain/tables/not-a-uuid/status", { body: { status: "reserved" }, expected: 400 });
  await request("PATCH", hotelA, `/captain/tables/${randomUUID()}/status`, { body: { status: "reserved" }, expected: 404 });
  pass("invalid UUID and missing-table behavior remain unchanged");

  const createPromise = rawRequest("POST", hotelA, "/captain/orders", {
    body: { table_id: concurrencyTable.id, customer_name: "Concurrent guest", customer_phone: "002", items: [{ menu_item_id: item.id, quantity: 1 }] },
  });
  const statusPromise = rawRequest("PATCH", hotelA, `/captain/tables/${concurrencyTable.id}/status`, { body: { status: "available" } });
  const [concurrentCreate, concurrentStatus] = await Promise.all([createPromise, statusPromise]);
  assert.equal(concurrentCreate.status, 201, JSON.stringify(concurrentCreate.body));
  assert.ok([200, 409].includes(concurrentStatus.status), JSON.stringify(concurrentStatus.body));
  assert.equal((await prisma.dining_table.findUniqueOrThrow({ where: { id: concurrencyTable.id } })).status, "occupied");
  assert.equal(await prisma.orders.count({ where: { hotel_id: hotelA, table_id: concurrencyTable.id, status: { in: ["pending", "preparing", "ready"] } } }), 1);
  pass("concurrent order creation and available-status mutation cannot commit an inconsistent final state");

  const concurrentOrder = await createCaptainOrder(orderConcurrencyTable);
  const [captainEdit, kitchenProgress] = await Promise.all([
    rawRequest("PATCH", hotelA, `/captain/orders/${concurrentOrder.id}`, { body: { items: [{ menu_item_id: item.id, quantity: 2 }], notes: "Concurrent Captain edit" } }),
    rawRequest("PATCH", hotelA, `/kitchen/orders/${concurrentOrder.id}/status`, { role: "Kitchen", body: { status: "preparing" } }),
  ]);
  assert.equal(captainEdit.status, 200, JSON.stringify(captainEdit.body));
  assert.equal(kitchenProgress.status, 200, JSON.stringify(kitchenProgress.body));
  const storedConcurrentOrder = await prisma.orders.findUniqueOrThrow({ where: { id: concurrentOrder.id }, include: { order_item: true } });
  assert.equal(storedConcurrentOrder.status, "preparing");
  assert.equal(storedConcurrentOrder.notes, "Concurrent Captain edit");
  assert.equal(storedConcurrentOrder.total_amount.toString(), "20");
  assert.deepEqual(storedConcurrentOrder.order_item.map(row => ({ quantity: row.quantity, status: row.status })), [{ quantity: 2, status: "preparing" }]);
  pass("concurrent Captain item replacement and Kitchen progress serialize without item/order desynchronization");

  const readyConcurrentOrder = await createCaptainOrder(readyConcurrencyTable);
  await request("PATCH", hotelA, `/kitchen/orders/${readyConcurrentOrder.id}/status`, { role: "Kitchen", body: { status: "preparing" } });
  const readyTransitions = await Promise.all([
    rawRequest("PATCH", hotelA, `/kitchen/orders/${readyConcurrentOrder.id}/status`, { role: "Kitchen", body: { status: "ready" } }),
    rawRequest("PATCH", hotelA, `/kitchen/orders/${readyConcurrentOrder.id}/status`, { role: "Kitchen", body: { status: "ready" } }),
  ]);
  assert.ok(readyTransitions.every(result => result.status === 200), JSON.stringify(readyTransitions));
  assert.equal((await prisma.orders.findUniqueOrThrow({ where: { id: readyConcurrentOrder.id } })).status, "ready");
  assert.equal(await prisma.notification.count({ where: { hotel_id: hotelA, event_key: `restaurant-order-ready:${readyConcurrentOrder.id}` } }), 1);
  pass("concurrent READY retries serialize under the order lock and create one assigned-Captain notification");

  const concurrentBillingOrder = await createCaptainOrder(billingConcurrencyTable);
  const [captainBillingEdit, unfinishedBilling] = await Promise.all([
    rawRequest("PATCH", hotelA, `/captain/orders/${concurrentBillingOrder.id}`, { body: { items: [{ menu_item_id: item.id, quantity: 2 }], notes: "Concurrent billing edit" } }),
    rawRequest("POST", hotelA, `/orders/${concurrentBillingOrder.id}/bill`, { role: "Manager", body: {} }),
  ]);
  assert.equal(captainBillingEdit.status, 200, JSON.stringify(captainBillingEdit.body));
  assert.equal(unfinishedBilling.status, 409, JSON.stringify(unfinishedBilling.body));
  assert.equal(unfinishedBilling.body.error.code, "RESTAURANT_ORDER_UNFINISHED");
  assert.equal(await prisma.bill.count({ where: { order_id: concurrentBillingOrder.id } }), 0);
  const storedBillingRaceOrder = await prisma.orders.findUniqueOrThrow({ where: { id: concurrentBillingOrder.id }, include: { order_item: true } });
  assert.equal(storedBillingRaceOrder.status, "pending");
  assert.equal(storedBillingRaceOrder.notes, "Concurrent billing edit");
  assert.equal(storedBillingRaceOrder.order_item[0].quantity, 2);
  pass("concurrent Captain mutation cannot make an unfinished restaurant order billable");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixture.hotelIds.length) {
    await prisma.order_item.deleteMany({ where: { orders: { hotel_id: { in: fixture.hotelIds } } } });
    await prisma.orders.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.menu_item.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.dining_table.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.dining_area.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.user_role.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  }
  if (fixture.userIds.length) await prisma.users.deleteMany({ where: { id: { in: fixture.userIds } } });
  await deleteHotelFixtures(fixture.hotelIds);
  assert.deepEqual(await counts(), before, "Temporary Captain table-status fixtures were not completely removed");
  await prisma.$disconnect();
}

console.log(`Captain table-status integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
