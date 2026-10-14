// Explicit local-only, rollback-only HTTP/PostgreSQL integration test. Never runs on startup.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { prisma } from "../db/prisma.js";
import { environment } from "../config/environment.js";
import { app } from "../app.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";

const database = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && database.pathname === "/hms", "Manager Restaurant Billing tests are local hms only");
const models = ["hotel", "users", "role", "user_role", "room", "room_booking", "orders", "order_item", "menu_item", "dining_area", "dining_table", "bill", "bill_item", "payment"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const originalTransaction = prisma.$transaction.bind(prisma);
const saved = {};
const rollback = new Error("ROLLBACK_MANAGER_RESTAURANT_BILLING");
let server;
let checks = 0;

try {
  await originalTransaction(async tx => {
    for (const name of [...models, "$queryRaw"]) { saved[name] = prisma[name]; prisma[name] = tx[name]; }
    let serial = 0;
    prisma.$transaction = async work => {
      const name = `manager_restaurant_billing_${++serial}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
      try { const result = await work(tx); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); return result; }
      catch (error) { await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); throw error; }
    };

    const hotelA = randomUUID(), hotelB = randomUUID();
    await tx.hotel.createMany({ data: [{ id: hotelA, name: "Restaurant billing A", status: "ACTIVE" }, { id: hotelB, name: "Restaurant billing B", status: "ACTIVE" }].map(entitledHotelFixture) });
    const password_hash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
    const tokens = {};
    const addActor = async (key, roleName, hotelId) => {
      const role = await tx.role.findUniqueOrThrow({ where: { name: roleName } });
      const userId = randomUUID(), assignmentId = randomUUID();
      await tx.users.create({ data: { id: userId, name: `${roleName} billing test`, email: `${userId}@restaurant-billing.invalid`, password_hash } });
      await tx.user_role.create({ data: { id: assignmentId, user_id: userId, role_id: role.id, hotel_id: hotelId } });
      tokens[key] = await createAuthenticationToken({ userId, userRoleId: assignmentId }, 300);
    };
    await addActor("managerA", "Manager", hotelA);
    await addActor("managerB", "Manager", hotelB);
    for (const role of ["Admin", "Reception", "Captain", "Kitchen"]) await addActor(role, role, hotelA);

    const menu = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "Restaurant billing meal", price: "10.00", is_available: true } });
    const area = await tx.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "Restaurant billing area", status: "active" } });
    const table = await tx.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelA, dining_area_id: area.id, table_number: "RB-A", capacity: 4, status: "occupied" } });
    const foreignArea = await tx.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelB, name: "Foreign billing area", status: "active" } });
    const foreignTable = await tx.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelB, dining_area_id: foreignArea.id, table_number: "RB-B", capacity: 2, status: "occupied" } });
    const createOrder = (source, status = "pending") => tx.orders.create({ data: { id: randomUUID(), hotel_id: hotelA, table_id: table.id, order_number: `RB-${randomUUID()}`, source, customer_name: "Restaurant Guest", customer_phone: "0000000000", status, payment_status: "pending", subtotal: "20.00", total_amount: "20.00", order_item: { create: { id: randomUUID(), menu_item_id: menu.id, item_name: "Restaurant billing meal", quantity: 2, unit_price: "10.00", subtotal: "20.00", status } } } });
    const pendingOrder = await createOrder("captain", "pending");
    const preparingOrder = await createOrder("captain", "preparing");
    const readyOrder = await createOrder("dining_table_qr", "ready");
    const captainOrder = await createOrder("captain", "completed");
    const qrOrder = await createOrder("dining_table_qr", "completed");
    const voidOrder = await createOrder("captain", "completed");
    const foreignMenu = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelB, name: "Foreign meal", price: "10.00", is_available: true } });
    const foreignOrder = await tx.orders.create({ data: { id: randomUUID(), hotel_id: hotelB, table_id: foreignTable.id, order_number: `RB-${randomUUID()}`, source: "captain", customer_name: "Foreign Guest", customer_phone: "0000000000", status: "pending", payment_status: "pending", subtotal: "10.00", total_amount: "10.00", order_item: { create: { id: randomUUID(), menu_item_id: foreignMenu.id, item_name: "Foreign meal", quantity: 1, unit_price: "10.00", subtotal: "10.00", status: "pending" } } } });
    const room = await tx.room.create({ data: { id: randomUUID(), hotel_id: hotelA, room_number: "RB-ROOM", status: "active", base_price: "50.00" } });
    const booking = await tx.room_booking.create({ data: { id: randomUUID(), hotel_id: hotelA, room_id: room.id, booking_number: `RB-${randomUUID()}`, customer_name: "Room Guest", customer_phone: "0000000000", booking_from: new Date("2026-09-01T00:00:00.000Z"), booking_to: new Date("2026-09-02T00:00:00.000Z"), status: "checked-in", room_rate: "50.00", total_amount: "50.00", payment_status: "pending" } });

    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (method, path, { role = "managerA", hotelId = hotelA, body, expected = 200 } = {}) => {
      const response = await fetch(`${origin}/api/hotels/${hotelId}${path}`, { method, headers: { ...(role ? { Cookie: `aazira_auth=${tokens[role]}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const payload = await response.json();
      assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
      checks++;
      return payload;
    };
    const payment = (amount, method, key = randomUUID()) => ({ amount, method, idempotency_key: key, reference: null, notes: null });

    await request("GET", "/bills", { role: null, expected: 401 });
    await request("GET", "/bills", { role: "Captain", expected: 403 });
    await request("GET", "/bills", { role: "Kitchen", expected: 403 });
    await request("GET", "/bills", { hotelId: hotelB, expected: 403 });
    await request("POST", `/orders/${foreignOrder.id}/bill`, { body: {}, expected: 404 });
    const orderList = await request("GET", "/manager/restaurant-orders");
    const projected = orderList.data.restaurant_orders.find(order => order.id === captainOrder.id);
    assert.equal(projected.order_number, captainOrder.order_number); checks++;
    assert.ok(!JSON.stringify(projected).includes("idempotency_fingerprint")); checks++;
    await request("POST", "/manager/restaurant-orders", { body: {}, expected: 404 });

    const roomBill = (await request("POST", `/room-bookings/${booking.id}/bill`, { role: "Admin", body: {}, expected: 201 })).data.bill;
    for (const unfinished of [pendingOrder, preparingOrder, readyOrder]) {
      const rejected = await request("POST", `/orders/${unfinished.id}/bill`, { body: {}, expected: 409 });
      assert.equal(rejected.error.code, "RESTAURANT_ORDER_UNFINISHED"); checks++;
      assert.equal(await tx.bill.count({ where: { order_id: unfinished.id } }), 0); checks++;
    }
    let captainBill = (await request("POST", `/orders/${captainOrder.id}/bill`, { body: {}, expected: 201 })).data.bill;
    assert.equal(captainBill.type, "CAPTAIN"); checks++;
    assert.equal(captainBill.source_reference, captainOrder.order_number); checks++;
    assert.equal(captainBill.guest_snapshot.dining_area, area.name); checks++;
    assert.equal(captainBill.guest_snapshot.table_number, table.table_number); checks++;
    assert.equal(captainBill.tax_amount, "0.00"); assert.equal(captainBill.discount_amount, "0.00"); checks += 2;
    await tx.orders.update({ where: { id: captainOrder.id }, data: { status: "ready", completed_at: null } });
    await tx.order_item.updateMany({ where: { order_id: captainOrder.id }, data: { status: "ready" } });
    const unfinishedFinalize = await request("POST", `/bills/${captainBill.id}/finalize`, { body: {}, expected: 409 });
    assert.equal(unfinishedFinalize.error.code, "RESTAURANT_ORDER_UNFINISHED"); checks++;
    assert.equal((await tx.bill.findUniqueOrThrow({ where: { id: captainBill.id } })).status, "DRAFT"); checks++;
    await tx.orders.update({ where: { id: captainOrder.id }, data: { status: "completed", completed_at: new Date() } });
    await tx.order_item.updateMany({ where: { order_id: captainOrder.id }, data: { status: "completed" } });
    await request("POST", `/orders/${captainOrder.id}/bill`, { body: {}, expected: 409 });
    const qrBill = (await request("POST", `/orders/${qrOrder.id}/bill`, { body: {}, expected: 201 })).data.bill;
    assert.equal(qrBill.type, "CAPTAIN"); checks++;
    assert.equal(qrBill.status, "DRAFT"); checks++;
    assert.equal(qrBill.payments.length, 0); checks++;
    assert.equal(await tx.payment.count({ where: { bill_id: qrBill.id } }), 0); checks++;
    const duplicateQrBill = await request("POST", `/orders/${qrOrder.id}/bill`, { body: {}, expected: 409 });
    assert.equal(duplicateQrBill.error.code, "BILL_ALREADY_EXISTS"); checks++;
    const workspace = await request("GET", "/bills");
    assert.ok(workspace.data.bills.some(bill => bill.id === roomBill.id && bill.type === "ROOM")); checks++;
    assert.ok(workspace.data.bills.some(bill => bill.id === captainBill.id && bill.type === "CAPTAIN")); checks++;
    assert.ok(workspace.data.bills.filter(bill => bill.type === "CAPTAIN").every(bill => bill.type !== "ROOM")); checks++;
    assert.equal((await request("GET", `/bills/${captainBill.id}`)).data.bill.id, captainBill.id); checks++;
    await request("GET", `/bills/${captainBill.id}`, { role: "Reception", expected: 403 });
    await request("POST", `/orders/${captainOrder.id}/bill`, { role: "Reception", body: {}, expected: 403 });

    const completedMutation = await request("PATCH", `/captain/orders/${captainOrder.id}`, { role: "Captain", body: { notes: "Forbidden before finalization" }, expected: 409 });
    assert.equal(completedMutation.error.code, "RESTAURANT_ORDER_IMMUTABLE"); checks++;
    captainBill = (await request("POST", `/bills/${captainBill.id}/finalize`, { body: {} })).data.bill;
    assert.equal(captainBill.status, "FINALIZED"); checks++;
    assert.equal((await tx.orders.findUniqueOrThrow({ where: { id: captainOrder.id } })).status, "completed"); checks++;
    await request("POST", `/bills/${captainBill.id}/payments`, { body: payment("0", "Cash"), expected: 400 });
    await request("POST", `/bills/${captainBill.id}/payments`, { body: payment("21.00", "Cash"), expected: 409 });
    const cashKey = randomUUID();
    captainBill = (await request("POST", `/bills/${captainBill.id}/payments`, { body: payment("5.00", "Cash", cashKey), expected: 201 })).data.bill;
    assert.equal(captainBill.status, "PARTIALLY_PAID"); checks++;
    assert.equal(captainBill.balance_due, "15.00"); checks++;
    const idempotent = (await request("POST", `/bills/${captainBill.id}/payments`, { body: payment("5.00", "Cash", cashKey), expected: 201 })).data.bill;
    assert.equal(idempotent.payments.length, 1); checks++;
    await request("POST", `/bills/${captainBill.id}/payments`, { body: payment("6.00", "Cash", cashKey), expected: 409 });
    captainBill = (await request("POST", `/bills/${captainBill.id}/payments`, { body: payment("5.00", "UPI"), expected: 201 })).data.bill;
    assert.equal(captainBill.balance_due, "10.00"); checks++;
    captainBill = (await request("POST", `/bills/${captainBill.id}/payments`, { body: payment("10.00", "Card"), expected: 201 })).data.bill;
    assert.equal(captainBill.status, "PAID"); assert.equal(captainBill.balance_due, "0.00"); checks += 2;
    await request("POST", `/bills/${captainBill.id}/payments`, { body: payment("1.00", "Cash"), expected: 409 });
    await request("POST", `/bills/${captainBill.id}/void`, { body: {}, expected: 409 });
    const unpaid = (await request("POST", `/orders/${voidOrder.id}/bill`, { body: {}, expected: 201 })).data.bill;
    const voided = (await request("POST", `/bills/${unpaid.id}/void`, { body: {} })).data.bill;
    assert.equal(voided.status, "VOID"); checks++;
    throw rollback;
  }, { timeout: 120000 });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  for (const [name, delegate] of Object.entries(saved)) prisma[name] = delegate;
  prisma.$transaction = originalTransaction;
  try {
    assert.deepEqual(await counts(), before, "Manager Restaurant Billing fixtures were not fully rolled back");
    console.log(JSON.stringify({ checks, countsBeforeAndAfter: before, cleanup: "Every fixture rolled back; all table counts unchanged." }));
  } finally { await prisma.$disconnect(); }
}
