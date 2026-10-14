// Explicit local-only, rollback-only HTTP/PostgreSQL integration test. Never runs on startup.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import pg from "pg";
import { ROLE_DEFINITIONS } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { environment } from "../config/environment.js";
import { app } from "../app.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";
import { createPublicQrOrder } from "../services/publicQrOrderService.js";

const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Local hms only");
const models = ["hotel", "users", "role", "user_role", "customer", "room", "room_booking", "orders", "order_item", "menu_item", "dining_area", "dining_table", "qr_code", "notification", "bill", "bill_item", "payment"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const constraints = await prisma.$queryRaw`SELECT conname, contype::text AS contype FROM pg_constraint WHERE conrelid IN ('bill'::regclass,'bill_item'::regclass,'payment'::regclass)`;
assert.equal(constraints.filter(c => c.contype === "f").length, 6);
assert.equal(constraints.filter(c => c.contype === "p").length, 3);
assert.equal(constraints.filter(c => c.contype === "c").length, 10);
const triggers = await prisma.$queryRaw`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('booking_billing_guard','order_billing_guard','order_item_billing_guard','bill_history_guard','bill_item_history_guard','payment_history_guard','payment_balance_update')`;
assert.equal(triggers.length, 7);
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const rollback = new Error("ROLLBACK_TEST_FIXTURES");
const originalTransaction = prisma.$transaction.bind(prisma);
const saved = {};
let checks = 0;
try {
  await originalTransaction(async tx => {
    // Route handlers and session resolution use this real transaction, not fake delegates/data.
    for (const name of [...models, "$queryRaw"]) { saved[name] = prisma[name]; prisma[name] = tx[name]; }
    let serial = 0;
    const savepoint = async work => {
      const name = `billing_test_${++serial}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
      try { const result = await work(tx); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); return result; }
      catch (error) { await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); throw error; }
    };
    prisma.$transaction = savepoint;
    const hotelId = randomUUID(), otherHotelId = randomUUID();
    await tx.hotel.createMany({ data: [hotelId, otherHotelId].map(id => entitledHotelFixture({ id, name: `Billing rollback test ${id}`, status: "ACTIVE", timezone: "Asia/Kolkata" })) });
    const password_hash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
    const tokens = {};
    for (const name of ["Admin", "Manager", "Reception", "Captain", "Kitchen"]) {
      const roleDefinition = Object.entries(ROLE_DEFINITIONS).find(([, definition]) => definition.displayName === name);
      assert.ok(roleDefinition, `Missing role definition for ${name}`);
      const [systemKey, definition] = roleDefinition;
      const role = await tx.role.upsert({
        where: { name },
        create: { name, system_key: systemKey, scope: definition.scope, is_protected: true },
        update: {},
      });
      const id = randomUUID(), assignmentId = randomUUID();
      await tx.users.create({ data: { id, email: `${id}@billing-test.invalid`, name: "Rollback test", password_hash } });
      await tx.user_role.create({ data: { id: assignmentId, user_id: id, role_id: role.id, hotel_id: hotelId } });
      tokens[name] = await createAuthenticationToken({ userId: id, userRoleId: assignmentId }, 300);
    }
    const request = async (method, path, data, expected = 200, role = "Manager", tenant = hotelId) => {
      const response = await fetch(`${origin}/api/hotels/${tenant}${path}`, { method, headers: { ...(role ? { Cookie: `aazira_auth=${tokens[role] || "invalid"}` } : {}), "Content-Type": "application/json" }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
      const result = await response.json();
      assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
      checks++;
      return result.data?.bill ?? result;
    };
    const verify = (condition, message) => { assert.ok(condition, message); checks++; };
    await request("GET", "/bills", undefined, 401, null);
    await request("GET", "/bills", undefined, 401, "tampered");
    for (const role of ["Captain", "Kitchen"]) await request("GET", "/bills", undefined, 403, role);
    await request("GET", "/bills", undefined, 403, "Manager", otherHotelId);
    await request("GET", "/bills/not-a-uuid", undefined, 400);
    await request("GET", `/bills/${randomUUID()}`, undefined, 404);
    const room = await tx.room.create({ data: { id: randomUUID(), hotel_id: hotelId, room_number: "TEST", status: "active", base_price: "999.00" } });
    const bookingData = { hotel_id: hotelId, room_id: room.id, customer_name: "Rollback Guest", customer_phone: "0000000000", status: "checked-in", room_rate: "100.25", payment_status: "pending" };
    let bookingSequence = 0;
    const newBooking = (extra = {}) => { const offset = bookingSequence++ * 3; return tx.room_booking.create({ data: { ...bookingData, id: randomUUID(), booking_number: `TEST-${randomUUID()}`, booking_from: new Date(Date.UTC(2026, 8, 1 + offset)), booking_to: new Date(Date.UTC(2026, 8, 3 + offset)), ...extra } }); };
    const booking = await newBooking();
    const roomCapability = randomBytes(32).toString("base64url");
    await tx.room_booking.update({ where: { id: booking.id }, data: { ordering_capability_hash: createHash("sha256").update(roomCapability).digest("hex"), ordering_capability_created_at: new Date() } });
    const roomQr = await tx.qr_code.create({ data: { id: randomUUID(), hotel_id: hotelId, code: randomBytes(32).toString("base64url"), type: "room", room_id: room.id } });
    const menu = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Rollback meal", price: "99.00" } });
    const area = await tx.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Rollback area", status: "active" } });
    const table = await tx.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelId, dining_area_id: area.id, table_number: "TEST", capacity: 2, status: "available" } });
    const newOrder = (extra = {}) => tx.orders.create({ data: { id: randomUUID(), hotel_id: hotelId, order_number: `TEST-${randomUUID()}`, source: "room_qr", room_booking_id: booking.id, customer_name: "Rollback Guest", customer_phone: "0000000000", status: "pending", payment_status: "pending", subtotal: "20.50", total_amount: "20.50", ...extra, order_item: { create: { id: randomUUID(), menu_item_id: menu.id, item_name: menu.name, quantity: 2, unit_price: "10.25", subtotal: "20.50", status: "pending" } } } });
    const order = await newOrder();
    let bill = await request("POST", `/room-bookings/${booking.id}/bill`, {}, 201, "Admin");
    assert.equal(bill.total_amount, "221.00");
    assert.equal(bill.tax_amount, "0.00"); assert.equal(bill.discount_amount, "0.00");
    assert.match(bill.invoice_number, /^INV-\d+$/);
    let workspace = await request("GET", "/bills", undefined, 200, "Reception");
    assert.equal(workspace.data.timezone, "Asia/Kolkata");
    verify(workspace.data.summary.total === "221.00", "draft bill contributes to total billed");
    verify(workspace.data.summary.collected === "0.00", "draft bill does not contribute to collected payments");
    await request("POST", `/room-bookings/${booking.id}/bill`, {}, 409);
    await request("POST", `/bills/${bill.id}/finalize`, {}, 409);
    for (const status of ["preparing", "ready"]) {
      await tx.orders.update({ where: { id: order.id }, data: { status } });
      await request("POST", `/bills/${bill.id}/finalize`, {}, 409);
    }
    await tx.orders.update({ where: { id: order.id }, data: { status: "completed" } });
    bill = await request("POST", `/bills/${bill.id}/finalize`, {}, 200, "Reception");
    assert.equal(bill.status, "FINALIZED");
    await assert.rejects(
      createPublicQrOrder(roomQr.code, roomCapability, randomBytes(32).toString("base64url"), { idempotency_key: randomUUID(), items: [{ menu_item_id: menu.id, quantity: 1 }] }),
      error => error?.code === "ROOM_ORDERING_UNAVAILABLE" && error?.statusCode === 409,
    ); checks++;
    workspace = await request("GET", "/bills", undefined, 200, "Reception");
    verify(workspace.data.summary.collected === "0.00", "finalized unpaid bill does not contribute to collected payments");
    verify(workspace.data.summary.pending === "221.00", "finalized unpaid balance remains pending");
    await request("POST", `/bills/${bill.id}/recalculate`, {}, 409);
    await request("POST", `/bills/${bill.id}/finalize`, {}, 409);
    await request("POST", `/bills/${bill.id}/void`, {}, 403, "Reception");
    await request("POST", "/room-orders", { room_booking_id: booking.id, status: "pending", payment_status: "pending", items: [{ menu_item_id: menu.id, quantity: 1 }] }, 409);
    await tx.menu_item.update({ where: { id: menu.id }, data: { price: "500.00" } });
    await tx.room.update({ where: { id: room.id }, data: { base_price: "5000.00" } });
    assert.equal((await request("GET", `/bills/${bill.id}`)).total_amount, "221.00");
    await assert.rejects(savepoint(() => tx.orders.update({ where: { id: order.id }, data: { total_amount: "999" } })), /BILLED_SOURCE_LOCKED/);
    await assert.rejects(savepoint(() => tx.bill.update({ where: { id: bill.id }, data: { total_amount: "999" } })), /BILL_SNAPSHOT_IMMUTABLE/);
    await assert.rejects(savepoint(() => tx.bill.delete({ where: { id: bill.id } })), /BILL_HISTORY_IMMUTABLE/);
    const payment = (extra = {}) => ({ amount: "10.00", method: "Cash", idempotency_key: randomUUID(), ...extra });
    for (const data of [payment({ method: "Cheque" }), payment({ amount: "0" }), payment({ amount: "-1" }), payment({ amount: "1.001" }), payment({ total_amount: "1" })]) await request("POST", `/bills/${bill.id}/payments`, data, 400);
    await request("POST", `/bills/${bill.id}/payments`, payment(), 403, "Manager", otherHotelId);
    await request("POST", `/bills/${bill.id}/payments`, payment({ amount: "222" }), 409);
    const partial = payment({ amount: "0.90" });
    bill = await request("POST", `/bills/${bill.id}/payments`, partial, 201);
    assert.equal(bill.payments[0].amount, "0.90"); assert.equal(bill.amount_paid, "0.90"); assert.equal(bill.balance_due, "220.10"); assert.equal(bill.status, "PARTIALLY_PAID");
    const [fractionalLedger] = await tx.$queryRaw`SELECT amount::text AS amount FROM payment WHERE bill_id = ${bill.id}::uuid`;
    assert.equal(fractionalLedger.amount, "0.90");
    workspace = await request("GET", "/bills", undefined, 200, "Reception");
    verify(workspace.data.summary.collected === "0.90", "fractional payment is collected without floating-point corruption");
    verify(workspace.data.summary.pending === "220.10", "fractional payment reduces the balance by exactly 0.90");
    bill = await request("POST", `/bills/${bill.id}/payments`, partial, 201);
    assert.equal(bill.payments.length, 1);
    assert.equal((await tx.payment.findFirst({ where: { bill_id: bill.id } })).created_by, bill.payments[0].created_by);
    await request("POST", `/bills/${bill.id}/payments`, { ...partial, amount: "11" }, 409);
    bill = await request("POST", `/bills/${bill.id}/payments`, payment({ amount: "20.10", method: "Card" }), 201);
    assert.equal(bill.amount_paid, "21.00"); assert.equal(bill.balance_due, "200.00");
    workspace = await request("GET", "/bills", undefined, 200, "Reception");
    verify(workspace.data.summary.collected === "21.00", "multiple recorded payments are summed once");
    await request("POST", `/bills/${bill.id}/void`, {}, 409);
    bill = await request("POST", `/bills/${bill.id}/payments`, payment({ amount: "200.00", method: "UPI" }), 201);
    assert.equal(bill.amount_paid, "221.00"); assert.equal(bill.balance_due, "0.00"); assert.equal(bill.status, "PAID");
    workspace = await request("GET", "/bills", undefined, 200, "Reception");
    verify(workspace.data.summary.collected === "221.00", "fully paid bill contributes the persisted payment total");
    verify(workspace.data.summary.pending === "0.00", "fully paid bill has no pending balance");
    await request("POST", `/bills/${bill.id}/payments`, payment(), 409);
    assert.equal((await request("GET", `/bills/${bill.id}/payments`)).data.payments.length, 3);
    await assert.rejects(savepoint(() => tx.payment.delete({ where: { id: bill.payments[0].id } })), /PAYMENT_HISTORY_IMMUTABLE/);
    const legacy = await newBooking({ paid_amount: "1.00" });
    assert.equal((await request("POST", `/room-bookings/${legacy.id}/bill`, {}, 409)).error.code, "LEGACY_PAYMENT_RECONCILIATION_REQUIRED");
    const laterLegacy = await newBooking();
    const laterBill = await request("POST", `/room-bookings/${laterLegacy.id}/bill`, {}, 201);
    await tx.room_booking.update({ where: { id: laterLegacy.id }, data: { paid_amount: "1.00" } });
    await request("POST", `/bills/${laterBill.id}/finalize`, {}, 409);
    assert.equal(String((await tx.room_booking.findUnique({ where: { id: laterLegacy.id } })).paid_amount), "1");
    const captain = await newOrder({ source: "captain", room_booking_id: null, table_id: table.id, status: "completed" });
    await tx.order_item.updateMany({ where: { order_id: captain.id }, data: { status: "completed" } });
    let captainBill = await request("POST", `/orders/${captain.id}/bill`, {}, 201);
    assert.equal(captainBill.total_amount, "20.50");
    assert.notEqual(captainBill.invoice_number, bill.invoice_number);
    const unpaidDraft = await newBooking();
    const draft = await request("POST", `/room-bookings/${unpaidDraft.id}/bill`, {}, 201);
    await request("POST", `/bills/${draft.id}/payments`, payment(), 409);
    await tx.room_booking.update({ where: { id: unpaidDraft.id }, data: { room_rate: "120.00" } });
    assert.equal((await request("POST", `/bills/${draft.id}/recalculate`, {})).total_amount, "240.00");
    await request("POST", `/bills/${draft.id}/finalize`, { total_amount: "1" }, 400);
    await request("GET", `/bills/${captainBill.id}`, undefined, 403, "Reception");
    await request("POST", `/orders/${captain.id}/bill`, {}, 403, "Reception");
    captainBill = await request("POST", `/bills/${captainBill.id}/finalize`, {});
    captainBill = await request("POST", `/bills/${captainBill.id}/void`, {});
    assert.equal(captainBill.status, "VOID");
    const publicTableOrder = await newOrder({ source: "dining_table_qr", room_booking_id: null, table_id: table.id, status: "completed" });
    await tx.order_item.updateMany({ where: { order_id: publicTableOrder.id }, data: { status: "completed" } });
    const publicTableBill = await request("POST", `/orders/${publicTableOrder.id}/bill`, {}, 201);
    assert.equal(publicTableBill.total_amount, "20.50"); checks++;
    await request("POST", `/bills/${captainBill.id}/payments`, payment(), 409);
    const managerWorkspace = await request("GET", "/bills", undefined, 200, "Manager");
    const managerNonVoidTotal = managerWorkspace.data.bills.filter(item => item.status !== "VOID").reduce((sum, item) => sum + Number(item.total_amount), 0).toFixed(2);
    verify(managerWorkspace.data.summary.total === managerNonVoidTotal, "void bill is excluded from total billed");
    verify(managerWorkspace.data.summary.collected === managerWorkspace.data.bills.reduce((sum, item) => sum + Number(item.amount_paid), 0).toFixed(2), "collection summary is derived from persisted payment balances");
    const all = await request("GET", "/bills", undefined, 200, "Reception");
    assert.ok(all.data.bills.every(b => b.type === "ROOM"));
    verify(all.data.summary.collected === "221.00", "Reception collection summary excludes another billing type");
    // Independent PostgreSQL connection proves the shared financial/source lock excludes another writer.
    const existing = await tx.hotel.findFirst({ where: { id: { notIn: [hotelId, otherHotelId] } } });
    if (existing) {
      await tx.$queryRaw`SELECT id FROM hotel WHERE id=${existing.id}::uuid FOR UPDATE`;
      const connection = new pg.Client({ connectionString: environment.databaseUrl });
      await connection.connect();
      try {
        await assert.rejects(connection.query("SELECT id FROM hotel WHERE id=$1 FOR UPDATE NOWAIT", [existing.id]), e => e.code === "55P03"); checks++;
        const numbers = await Promise.all([tx.$queryRaw`SELECT nextval('bill_invoice_sequence')::text AS number`, connection.query("SELECT nextval('bill_invoice_sequence')::text AS number")]);
        assert.notEqual(numbers[0][0].number, numbers[1].rows[0].number); checks++;
      }
      finally { await connection.end(); }
    }
    const health = await fetch(`${origin}/api/health`);
    assert.equal(health.status, 200); assert.equal((await health.json()).database, "connected");
    throw rollback;
  }, { timeout: 120000 });
} catch (error) { if (error !== rollback) throw error; }
finally {
  for (const [name, value] of Object.entries(saved)) prisma[name] = value;
  prisma.$transaction = originalTransaction;
  await new Promise(resolve => server.close(resolve));
  try { assert.deepEqual(await counts(), before); console.log(JSON.stringify({ checks, catalog: { foreignKeys: 6, primaryKeys: 3, checks: 10, triggers: 7 }, countsBeforeAndAfter: before, cleanup: "All table counts unchanged; every fixture rolled back. Invoice sequence gaps are intentionally retained." })); }
  finally { await prisma.$disconnect(); }
}
