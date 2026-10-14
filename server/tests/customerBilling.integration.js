// Local-only, rollback-only HTTP/PostgreSQL coverage for public customer billing.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { createBill, recordPayment, refreshBill, voidBill } from "../services/billingService.js";
import { buildCustomerReceiptLayout } from "../services/customerBillingPdfService.js";

const database = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && database.pathname === "/hms", "Customer billing tests are local hms only");

const models = ["hotel", "users", "room", "room_booking", "orders", "order_item", "menu_item", "dining_area", "dining_table", "qr_code", "bill", "bill_item", "payment"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const originalTransaction = prisma.$transaction.bind(prisma);
const saved = {};
const rollback = new Error("ROLLBACK_CUSTOMER_BILLING");
const secret = () => randomBytes(32).toString("base64url");
const digest = value => createHash("sha256").update(value, "utf8").digest("hex");
let server;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };

try {
  await originalTransaction(async tx => {
    for (const name of [...models, "notification", "role", "user_role", "$queryRaw"]) { saved[name] = prisma[name]; prisma[name] = tx[name]; }
    let serial = 0;
    prisma.$transaction = async work => {
      const name = `customer_billing_${++serial}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
      try { const result = await work(tx); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); return result; }
      catch (error) { await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); throw error; }
    };

    const hotelA = randomUUID(), hotelB = randomUUID();
    await tx.hotel.createMany({ data: [
      { id: hotelA, name: "Customer Billing Hotel", address: "1 Safe Street", phone: "100", email: "billing@example.invalid", timezone: "Asia/Kolkata", status: "ACTIVE" },
      { id: hotelB, name: "Foreign Billing Hotel", timezone: "UTC", status: "ACTIVE" },
    ] });
    const actorId = randomUUID();
    await tx.users.create({ data: { id: actorId, name: "Billing actor", email: `${actorId}@customer-billing.invalid`, password_hash: await argon2.hash(randomUUID()) } });
    const authA = { hotelId: hotelA, userId: actorId, roleKey: "MANAGER" };
    const menuA = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "Persisted Meal", price: "25.00", is_available: true } });
    const menuB = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelB, name: "Foreign Meal", price: "30.00", is_available: true } });
    const areaA = await tx.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "Main Hall", status: "active" } });
    const areaB = await tx.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelB, name: "Foreign Hall", status: "active" } });
    const tableA = await tx.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelA, dining_area_id: areaA.id, table_number: "CB-1", capacity: 4, status: "occupied" } });
    const tableB = await tx.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelB, dining_area_id: areaB.id, table_number: "CB-X", capacity: 4, status: "occupied" } });
    const qr = await tx.qr_code.create({ data: { id: randomUUID(), hotel_id: hotelA, code: secret(), type: "dining_table", dining_table_id: tableA.id } });
    const tableOrder = async (hotelId, tableId, menu, capability, status = "completed") => tx.orders.create({ data: {
      id: randomUUID(), hotel_id: hotelId, table_id: tableId, order_number: `ORD-${randomUUID()}`, source: "dining_table_qr",
      customer_name: "Private Customer", customer_phone: "919999999999", customer_email: "private@example.invalid",
      status, payment_status: "pending", subtotal: "50.00", total_amount: "50.00",
      tracking_capability_hash: digest(capability), tracking_capability_created_at: new Date(), notes: "Private staff note",
      order_item: { create: { id: randomUUID(), menu_item_id: menu.id, item_name: menu.name, quantity: 2, unit_price: "25.00", subtotal: "50.00", status } },
    } });

    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, capability, expected = 200, accept = "json") => {
      const response = await fetch(`${origin}${path}`, { headers: { "X-Order-Tracking-Capability": capability } });
      const payload = accept === "pdf" && response.ok ? Buffer.from(await response.arrayBuffer()) : await response.json();
      assert.equal(response.status, expected, `${path}: ${JSON.stringify(payload)}`); checks++;
      return { response, payload };
    };

    const noBillCapability = secret();
    await tableOrder(hotelA, tableA.id, menuA, noBillCapability);
    check((await request("/api/public/order-billing", noBillCapability)).payload.data.billing.available === false, "order without a bill returns the safe unavailable state");

    const tableCapability = secret();
    const table = await tableOrder(hotelA, tableA.id, menuA, tableCapability);
    let tableBill = await createBill(authA, "CAPTAIN", table.id);
    check((await request("/api/public/order-billing", tableCapability)).payload.data.billing.available === false, "draft restaurant bill is not exposed");
    tableBill = await refreshBill(authA, tableBill.id, {}, true);
    let visible = (await request("/api/public/order-billing", tableCapability)).payload.data.billing;
    check(visible.document_type === "invoice" && visible.status === "FINALIZED" && visible.invoice_number === tableBill.invoice_number, "finalized table bill is exposed as its authorized invoice");
    check(visible.items.length === 1 && visible.items[0].subtotal === "50.00" && visible.total_amount === "50.00", "table invoice uses persisted authoritative lines and totals");
    tableBill = await recordPayment(authA, tableBill.id, { amount: "20.00", method: "UPI", reference: "SAFE-EXTERNAL-REFERENCE", notes: "Private payment note", idempotency_key: randomUUID() });
    visible = (await request("/api/public/order-billing", tableCapability)).payload.data.billing;
    check(visible.status === "PARTIALLY_PAID" && visible.amount_paid === "20.00" && visible.balance_due === "30.00" && visible.payments[0].method === "UPI", "partial table payment is projected read-only");
    check(!JSON.stringify(visible).includes("SAFE-EXTERNAL-REFERENCE") && !JSON.stringify(visible).includes(actorId), "payment projection excludes external references and staff identities");
    tableBill = await recordPayment(authA, tableBill.id, { amount: "30.00", method: "Cash", reference: null, notes: null, idempotency_key: randomUUID() });
    visible = (await request("/api/public/order-billing", tableCapability)).payload.data.billing;
    check(visible.document_type === "receipt" && visible.status === "PAID" && visible.balance_due === "0.00", "paid table bill is exposed as a receipt");
    const pdf = await request("/api/public/order-billing/pdf", tableCapability, 200, "pdf");
    check(pdf.response.headers.get("content-type") === "application/pdf" && pdf.payload.subarray(0, 5).toString() === "%PDF-", "paid receipt downloads as a PDF");
    check(pdf.response.headers.get("cache-control")?.includes("private") && pdf.response.headers.get("cache-control")?.includes("no-store") && pdf.response.headers.get("referrer-policy") === "no-referrer" && !pdf.response.headers.get("set-cookie"), "PDF response remains private, no-store, no-referrer, and cookie-free");
    const pdfLayoutText = buildCustomerReceiptLayout(visible).pages.flat().map(line => line.text).join("\n");
    const serializedPdf = pdf.payload.toString("latin1");
    check(pdfLayoutText.includes(tableBill.invoice_number) && pdfLayoutText.includes("INR 50.00") && !serializedPdf.includes(table.id) && !serializedPdf.includes(tableCapability), "PDF uses authoritative receipt values without internal IDs or capabilities");
    const unsupportedCapability = secret();
    await tx.hotel.update({ where: { id: hotelA }, data: { name: "Unsupported emoji 😀" } });
    const unsupportedOrder = await tableOrder(hotelA, tableA.id, menuA, unsupportedCapability);
    let unsupportedBill = await createBill(authA, "CAPTAIN", unsupportedOrder.id);
    unsupportedBill = await refreshBill(authA, unsupportedBill.id, {}, true);
    await recordPayment(authA, unsupportedBill.id, { amount: "50.00", method: "Cash", reference: null, notes: null, idempotency_key: randomUUID() });
    check((await request("/api/public/order-billing/pdf", unsupportedCapability, 422)).payload.error.code === "RECEIPT_PDF_UNSUPPORTED_TEXT", "unsupported glyphs fail deliberately without silent substitution");
    await tx.hotel.update({ where: { id: hotelA }, data: { name: "Customer Billing Hotel" } });

    const unpaidPdfCapability = secret();
    const unpaidOrder = await tableOrder(hotelA, tableA.id, menuA, unpaidPdfCapability);
    const unpaidBill = await createBill(authA, "CAPTAIN", unpaidOrder.id);
    await refreshBill(authA, unpaidBill.id, {}, true);
    await request("/api/public/order-billing/pdf", unpaidPdfCapability, 409);

    const voidCapability = secret();
    const voidOrder = await tableOrder(hotelA, tableA.id, menuA, voidCapability);
    const draftVoid = await createBill(authA, "CAPTAIN", voidOrder.id);
    await voidBill(authA, draftVoid.id);
    check((await request("/api/public/order-billing", voidCapability)).payload.data.billing.available === false, "void bill returns the safe unavailable state");

    const room = await tx.room.create({ data: { id: randomUUID(), hotel_id: hotelA, room_number: "CB-R1", status: "active", base_price: "100.00" } });
    const booking = await tx.room_booking.create({ data: {
      id: randomUUID(), hotel_id: hotelA, room_id: room.id, booking_number: `BK-${randomUUID()}`,
      customer_name: "Room Customer", customer_phone: "100", customer_email: "room-private@example.invalid",
      status: "checked-in", payment_status: "pending", room_rate: "100.00", total_amount: "200.00",
      booking_from: new Date("2026-09-01T00:00:00.000Z"), booking_to: new Date("2026-09-03T00:00:00.000Z"),
    } });
    const roomCapability = secret();
    const roomOrder = await tx.orders.create({ data: {
      id: randomUUID(), hotel_id: hotelA, room_booking_id: booking.id, order_number: `ORD-${randomUUID()}`, source: "room_qr",
      customer_name: "Room Customer", customer_phone: "100", status: "completed", payment_status: "pending", subtotal: "25.00", total_amount: "25.00",
      tracking_capability_hash: digest(roomCapability), tracking_capability_created_at: new Date(),
      order_item: { create: { id: randomUUID(), menu_item_id: menuA.id, item_name: "Room Meal", quantity: 1, unit_price: "25.00", subtotal: "25.00", status: "completed" } },
    } });
    await tx.orders.create({ data: {
      id: randomUUID(), hotel_id: hotelA, room_booking_id: booking.id, order_number: `ORD-${randomUUID()}`, source: "room_qr",
      customer_name: "Room Customer", customer_phone: "100", status: "completed", payment_status: "pending", subtotal: "50.00", total_amount: "50.00",
      order_item: { create: { id: randomUUID(), menu_item_id: menuA.id, item_name: "Second Room Meal", quantity: 2, unit_price: "25.00", subtotal: "50.00", status: "completed" } },
    } });
    let roomBill = await createBill(authA, "ROOM", booking.id);
    roomBill = await refreshBill(authA, roomBill.id, {}, true);
    let roomVisible = (await request("/api/public/order-billing", roomCapability)).payload.data.billing;
    check(roomVisible.status === "FINALIZED" && roomVisible.items.length === 3 && roomVisible.total_amount === "275.00", "room capability resolves the complete authorized stay bill with accommodation and both room orders");
    check(roomVisible.context.room_number === "CB-R1" && !JSON.stringify(roomVisible).includes(booking.id) && !JSON.stringify(roomVisible).includes(roomOrder.id), "room projection contains safe stay context without booking/order IDs");
    roomBill = await recordPayment(authA, roomBill.id, { amount: "75.00", method: "Cash", reference: null, notes: null, idempotency_key: randomUUID() });
    roomVisible = (await request("/api/public/order-billing", roomCapability)).payload.data.billing;
    check(roomVisible.status === "PARTIALLY_PAID" && roomVisible.balance_due === "200.00", "partial room payment is visible");
    await recordPayment(authA, roomBill.id, { amount: "200.00", method: "UPI", reference: null, notes: null, idempotency_key: randomUUID() });
    check((await request("/api/public/order-billing", roomCapability)).payload.data.billing.document_type === "receipt", "paid room bill is exposed as a receipt");

    const foreignCapability = secret();
    const foreignOrder = await tableOrder(hotelB, tableB.id, menuB, foreignCapability);
    check((await request(`/api/public/order-billing?billId=${roomBill.id}`, foreignCapability, 400)).payload.error.code === "INVALID_CUSTOMER_BILLING_REQUEST", "arbitrary bill substitution through query input is rejected");
    check((await request(`/api/public/order-billing?bookingId=${booking.id}`, tableCapability, 400)).payload.error.code === "INVALID_CUSTOMER_BILLING_REQUEST", "arbitrary booking substitution through query input is rejected");
    check((await request(`/api/public/order-billing?orderId=${table.id}`, roomCapability, 400)).payload.error.code === "INVALID_CUSTOMER_BILLING_REQUEST", "arbitrary order substitution through query input is rejected");
    check((await request("/api/public/order-billing", foreignCapability)).payload.data.billing.available === false, "foreign capability cannot reveal another hotel's issued bill");
    await request("/api/public/order-billing", secret(), 404);
    await request("/api/public/order-billing", roomBill.id, 400);
    check(true, "unknown capability and arbitrary internal UUID do not authorize billing");
    void foreignOrder;

    const financialBefore = { bills: await tx.bill.count(), payments: await tx.payment.count(), status: (await tx.bill.findUniqueOrThrow({ where: { id: roomBill.id } })).status };
    await request("/api/public/order-billing", roomCapability);
    await request("/api/public/order-billing", roomCapability);
    const financialAfter = { bills: await tx.bill.count(), payments: await tx.payment.count(), status: (await tx.bill.findUniqueOrThrow({ where: { id: roomBill.id } })).status };
    check(JSON.stringify(financialAfter) === JSON.stringify(financialBefore), "customer billing reads do not create bills/payments or mutate billing state");

    const serialized = JSON.stringify(roomVisible);
    for (const forbidden of [hotelA, booking.id, roomOrder.id, actorId, roomCapability, digest(roomCapability), "room-private@example.invalid", "customer_id", "created_by", "finalized_by", "voided_by", "idempotency_key", "staff note"]) {
      check(!serialized.includes(forbidden), `customer projection excludes ${forbidden.includes("@") ? "unnecessary PII" : "internal or sensitive data"}`);
    }

    await tx.hotel.update({ where: { id: hotelA }, data: { status: "INACTIVE" } });
    check((await request("/api/public/order-billing", roomCapability)).payload.data.billing.document_type === "receipt", "issued room receipt remains accessible after hotel deactivation");
    check((await request("/api/public/order-billing", tableCapability)).payload.data.billing.document_type === "receipt", "issued table receipt remains accessible after hotel deactivation");
    await request(`/api/public/qr/${qr.code}`, tableCapability, 404);
    check(true, "inactive hotel still blocks new public QR ordering context");

    const response = await request("/api/public/order-billing", roomCapability);
    check(response.response.headers.get("cache-control")?.includes("private") && response.response.headers.get("cache-control")?.includes("no-store") && response.response.headers.get("referrer-policy") === "no-referrer", "customer billing response is private, no-store, and no-referrer");
    throw rollback;
  }, { timeout: 120000 });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  for (const [name, delegate] of Object.entries(saved)) prisma[name] = delegate;
  prisma.$transaction = originalTransaction;
  try {
    assert.deepEqual(await counts(), before, "Customer billing fixtures were not fully rolled back");
    console.log(`Customer billing integration: ${checks}/${checks} passed`);
    console.log(JSON.stringify({ countsBeforeAndAfter: before, cleanup: "Every customer billing fixture rolled back; all tracked table counts unchanged." }));
  } finally { await prisma.$disconnect(); }
}
