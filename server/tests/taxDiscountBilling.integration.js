// Local-only, rollback-only HTTP/PostgreSQL integration coverage for tax/discount billing.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { prisma } from "../db/prisma.js";
import { environment } from "../config/environment.js";
import { app } from "../app.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";

const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Local hms only");
const models = ["hotel", "users", "role", "user_role", "room", "room_booking", "orders", "order_item", "menu_category", "menu_item", "dining_area", "dining_table", "tax_slab", "discount", "discount_menu_category", "discount_menu_item", "bill", "bill_item", "payment"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const origin = `http://127.0.0.1:${server.address().port}`;
const rollback = new Error("ROLLBACK_TAX_DISCOUNT_BILLING");
const originalTransaction = prisma.$transaction.bind(prisma);
const saved = {};
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };

try {
  await originalTransaction(async tx => {
    for (const name of [...models, "$queryRaw"]) { saved[name] = prisma[name]; prisma[name] = tx[name]; }
    let serial = 0;
    prisma.$transaction = async work => {
      const name = `tax_discount_billing_${++serial}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
      try { const result = await work(tx); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); return result; }
      catch (error) { await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); throw error; }
    };

    const hotelA = randomUUID(), hotelB = randomUUID();
    await tx.hotel.createMany({ data: [{ id: hotelA, name: "Adjustment A", status: "ACTIVE", timezone: "Asia/Kolkata" }, { id: hotelB, name: "Adjustment B", status: "ACTIVE", timezone: "America/New_York" }].map(entitledHotelFixture) });
    const password_hash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
    const tokens = {};
    for (const roleName of ["Admin", "Manager", "Reception", "Captain", "Kitchen"]) {
      const role = await tx.role.findUniqueOrThrow({ where: { name: roleName } });
      const userId = randomUUID(), assignmentId = randomUUID();
      await tx.users.create({ data: { id: userId, name: `${roleName} adjustments`, email: `${userId}@adjustments.invalid`, password_hash } });
      await tx.user_role.create({ data: { id: assignmentId, user_id: userId, role_id: role.id, hotel_id: hotelA } });
      tokens[roleName] = await createAuthenticationToken({ userId, userRoleId: assignmentId }, 300);
    }
    const request = async (method, path, body, expected = 200, role = "Manager", tenant = hotelA) => {
      const response = await fetch(`${origin}/api/hotels/${tenant}${path}`, { method, headers: { ...(role ? { Cookie: `aazira_auth=${tokens[role]}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const payload = await response.json();
      assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`); checks++;
      return payload.data?.bill ?? payload;
    };
    const tax = (hotel_id, name, rate, is_active = true) => tx.tax_slab.create({ data: { id: randomUUID(), hotel_id, name, rate, applicable_on: "Manual", is_active } });
    const discount = async (hotel_id, name, type, value, applicable_on = "all", extra = {}) => {
      const row = await tx.discount.create({ data: { id: randomUUID(), hotel_id, name, discount_type: type, discount_value: value, min_order_amount: "0.00", end_date: new Date("2099-12-31T00:00:00.000Z"), is_active: true, applicable_on, ...extra } });
      return row;
    };
    const tax10 = await tax(hotelA, "GST 10", "10.00");
    const tax125 = await tax(hotelA, "GST 12.5", "12.50");
    const inactiveTax = await tax(hotelA, "Inactive", "5.00", false);
    const foreignTax = await tax(hotelB, "Foreign", "9.00");
    const all10 = await discount(hotelA, "All 10", "percentage", "10.00");
    const fixed700 = await discount(hotelA, "Fixed 700", "fixed_amount", "700.00");
    const capped = await discount(hotelA, "Capped", "percentage", "50.00", "all", { max_discount_amount: "25.00" });
    const minimum = await discount(hotelA, "Minimum", "fixed_amount", "10.00", "all", { min_order_amount: "999.00" });
    const inactiveDiscount = await discount(hotelA, "Inactive discount", "percentage", "5.00", "all", { is_active: false });
    const futureDiscount = await discount(hotelA, "Future discount", "percentage", "5.00", "all", { start_date: new Date("2099-01-01T00:00:00.000Z") });
    const expiredDiscount = await discount(hotelA, "Expired discount", "percentage", "5.00", "all", { end_date: new Date("2000-01-01T00:00:00.000Z") });
    const foreignDiscount = await discount(hotelB, "Foreign discount", "percentage", "5.00");
    const category = await tx.menu_category.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "Eligible", display_order: 1, is_active: true } });
    const otherCategory = await tx.menu_category.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "Other", display_order: 2, is_active: true } });
    const menu = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelA, category_id: category.id, name: "Eligible meal", price: "100.00", is_available: true } });
    const otherMenu = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelA, category_id: otherCategory.id, name: "Other meal", price: "50.00", is_available: true } });
    const categoryDiscount = await discount(hotelA, "Category 10", "percentage", "10.00", "categories");
    await tx.discount_menu_category.create({ data: { discount_id: categoryDiscount.id, category_id: category.id } });
    const itemDiscount = await discount(hotelA, "Item 10", "percentage", "10.00", "specific_items");
    await tx.discount_menu_item.create({ data: { discount_id: itemDiscount.id, menu_item_id: menu.id } });
    const area = await tx.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "Billing area", status: "active" } });
    const table = await tx.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelA, dining_area_id: area.id, table_number: "ADJ", capacity: 4, status: "occupied" } });
    let sequence = 0;
    const newOrder = async ({ source = "captain", items = [[menu, 1]], room_booking_id = null } = {}) => {
      const subtotal = items.reduce((sum, [item, quantity]) => sum + Number(item.price) * quantity, 0).toFixed(2);
      return tx.orders.create({ data: { id: randomUUID(), hotel_id: hotelA, table_id: source === "room_qr" ? null : table.id, room_booking_id, order_number: `ADJ-${++sequence}`, source, customer_name: "Adjustment Guest", customer_phone: "0000000000", status: "completed", payment_status: "pending", subtotal, total_amount: subtotal, order_item: { create: items.map(([item, quantity]) => ({ id: randomUUID(), menu_item_id: item.id, item_name: item.name, quantity, unit_price: item.price, subtotal: (Number(item.price) * quantity).toFixed(2), status: "completed" })) } }, include: { order_item: true } });
    };
    const room = await tx.room.create({ data: { id: randomUUID(), hotel_id: hotelA, room_number: "ADJ", status: "active", base_price: "100.00" } });
    const newBooking = async () => tx.room_booking.create({ data: { id: randomUUID(), hotel_id: hotelA, room_id: room.id, booking_number: `BOOK-${++sequence}`, customer_name: "Room Adjustment", customer_phone: "0000000000", booking_from: new Date("2026-09-01T00:00:00.000Z"), booking_to: new Date("2026-09-03T00:00:00.000Z"), status: "checked-in", room_rate: "100.00", total_amount: "200.00", payment_status: "pending" } });

    await request("GET", "/billing-options", undefined, 401, null);
    await request("GET", "/billing-options", undefined, 403, "Captain");
    await request("GET", "/billing-options", undefined, 403, "Kitchen");
    await request("GET", "/billing-options", undefined, 403, "Manager", hotelB);
    const options = await request("GET", "/billing-options");
    check(options.data.tax_slabs.some(row => row.id === tax10.id), "active tax is listed");
    check(!options.data.tax_slabs.some(row => row.id === inactiveTax.id), "inactive tax is hidden");
    check(options.data.discounts.some(row => row.id === all10.id), "active discount is listed");
    check(!options.data.discounts.some(row => row.id === inactiveDiscount.id), "inactive discount is hidden");
    await request("GET", "/billing-options", undefined, 200, "Reception");
    await request("GET", "/billing-options", undefined, 200, "Admin");

    const noAdjustmentOrder = await newOrder();
    let bill = await request("POST", `/orders/${noAdjustmentOrder.id}/bill`, {}, 201);
    check(bill.subtotal === "100.00", "no-adjustment subtotal"); check(bill.discount_amount === "0.00", "no discount"); check(bill.tax_amount === "0.00", "no tax"); check(bill.total_amount === "100.00", "no-adjustment total"); check(bill.tax_snapshot === null && bill.discount_snapshot === null, "no adjustment snapshots");

    const adjustedOrder = await newOrder({ items: [[menu, 1], [otherMenu, 2]] });
    bill = await request("POST", `/orders/${adjustedOrder.id}/bill`, { tax_slab_id: tax10.id, discount_id: all10.id }, 201);
    check(bill.subtotal === "200.00", "combined subtotal"); check(bill.discount_amount === "20.00", "percentage discount"); check(bill.taxable_subtotal === "180.00", "discount precedes tax"); check(bill.tax_amount === "18.00", "tax follows discount"); check(bill.total_amount === "198.00", "adjusted total");
    check(bill.items.reduce((sum, item) => sum + Number(item.discount_amount), 0) === 20, "item discounts reconcile"); check(bill.items.reduce((sum, item) => sum + Number(item.tax_amount), 0) === 18, "item tax reconciles"); check(bill.items.reduce((sum, item) => sum + Number(item.total_amount), 0) === 198, "item totals reconcile");
    check(bill.tax_snapshot.name === tax10.name && bill.tax_snapshot.rate === "10.00", "tax terms snapshotted"); check(bill.discount_snapshot.name === all10.name && bill.discount_snapshot.applicability === "all", "discount terms snapshotted");

    const categoryOrder = await newOrder({ items: [[menu, 1], [otherMenu, 1]] });
    let categoryBill = await request("POST", `/orders/${categoryOrder.id}/bill`, { discount_id: categoryDiscount.id }, 201);
    check(categoryBill.subtotal === "150.00" && categoryBill.discount_amount === "10.00" && categoryBill.total_amount === "140.00", "category discount only uses eligible lines");
    check(categoryBill.items.find(item => item.menu_item_id === menu.id).discount_eligible, "eligible category line resolved"); check(!categoryBill.items.find(item => item.menu_item_id === otherMenu.id).discount_eligible, "other category excluded");
    const itemOrder = await newOrder({ items: [[menu, 1], [otherMenu, 1]] });
    const itemBill = await request("POST", `/orders/${itemOrder.id}/bill`, { discount_id: itemDiscount.id }, 201);
    check(itemBill.discount_amount === "10.00", "specific item discount"); check(itemBill.discount_snapshot.eligible_subtotal === "100.00", "specific item eligible subtotal snapshotted");

    const roomBooking = await newBooking(); await newOrder({ source: "room_qr", room_booking_id: roomBooking.id, items: [[menu, 1], [otherMenu, 1]] });
    const roomBill = await request("POST", `/room-bookings/${roomBooking.id}/bill`, { tax_slab_id: tax10.id, discount_id: categoryDiscount.id }, 201, "Reception");
    check(roomBill.subtotal === "350.00", "room and service subtotal"); check(roomBill.discount_amount === "10.00", "room category discount excludes accommodation"); check(roomBill.taxable_subtotal === "340.00" && roomBill.tax_amount === "34.00" && roomBill.total_amount === "374.00", "tax applies to full post-discount room bill"); check(!roomBill.items[0].discount_eligible, "accommodation is not category eligible");

    const capOrder = await newOrder(); const capBill = await request("POST", `/orders/${capOrder.id}/bill`, { discount_id: capped.id }, 201);
    check(capBill.discount_amount === "25.00", "maximum discount cap");
    const minOrder = await newOrder(); const minBill = await request("POST", `/orders/${minOrder.id}/bill`, { discount_id: minimum.id }, 201);
    check(minBill.discount_amount === "0.00" && minBill.discount_snapshot.configuration_id === minimum.id, "minimum failure retains zero-applied snapshot");
    const fixedOrder = await newOrder(); const fixedBill = await request("POST", `/orders/${fixedOrder.id}/bill`, { tax_slab_id: tax10.id, discount_id: fixed700.id }, 201);
    check(fixedBill.discount_amount === "100.00" && fixedBill.taxable_subtotal === "0.00" && fixedBill.tax_amount === "0.00" && fixedBill.total_amount === "0.00", "fixed discount cannot make total negative");

    await request("POST", `/orders/${(await newOrder()).id}/bill`, { tax_slab_id: inactiveTax.id }, 409);
    await request("POST", `/orders/${(await newOrder()).id}/bill`, { tax_slab_id: foreignTax.id }, 404);
    await request("POST", `/orders/${(await newOrder()).id}/bill`, { discount_id: inactiveDiscount.id }, 409);
    await request("POST", `/orders/${(await newOrder()).id}/bill`, { discount_id: futureDiscount.id }, 409);
    await request("POST", `/orders/${(await newOrder()).id}/bill`, { discount_id: expiredDiscount.id }, 409);
    await request("POST", `/orders/${(await newOrder()).id}/bill`, { discount_id: foreignDiscount.id }, 404);
    await request("POST", `/orders/${(await newOrder()).id}/bill`, { tax_slab_id: [tax10.id, tax125.id] }, 400);
    await request("POST", `/orders/${(await newOrder()).id}/bill`, { discount_id: [all10.id, capped.id] }, 400);
    await request("POST", `/orders/${(await newOrder()).id}/bill`, { tax_amount: "1.00" }, 400);

    const fractionalMenu = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelA, category_id: category.id, name: "Fractional", price: "0.05", is_available: true } });
    const fractionalOrder = await newOrder({ items: [[fractionalMenu, 1]] });
    const fractionalBill = await request("POST", `/orders/${fractionalOrder.id}/bill`, { tax_slab_id: tax125.id, discount_id: all10.id }, 201);
    check(fractionalBill.discount_amount === "0.01", "discount rounds half up"); check(fractionalBill.taxable_subtotal === "0.04", "fractional taxable subtotal"); check(fractionalBill.tax_amount === "0.01" && fractionalBill.total_amount === "0.05", "fractional tax rounds half up and reconciles");

    await tx.tax_slab.update({ where: { id: tax10.id }, data: { rate: "20.00" } });
    bill = await request("POST", `/bills/${bill.id}/recalculate`, {});
    check(bill.tax_snapshot.rate === "20.00" && bill.tax_amount === "36.00" && bill.total_amount === "216.00", "draft revalidates current selected tax without substitution");
    await tx.discount.update({ where: { id: all10.id }, data: { discount_value: "20.00" } });
    bill = await request("POST", `/bills/${bill.id}/recalculate`, {});
    check(bill.discount_amount === "40.00" && bill.taxable_subtotal === "160.00" && bill.tax_amount === "32.00" && bill.total_amount === "192.00", "draft revalidates current selected discount");
    bill = await request("POST", `/bills/${bill.id}/finalize`, {});
    check(bill.status === "FINALIZED", "adjusted bill finalized");
    const frozen = JSON.stringify(bill);
    await tx.tax_slab.update({ where: { id: tax10.id }, data: { rate: "30.00" } });
    await tx.discount.delete({ where: { id: all10.id } });
    const frozenBill = await request("GET", `/bills/${bill.id}`);
    check(frozenBill.total_amount === "192.00" && frozenBill.tax_snapshot.rate === "20.00" && frozenBill.discount_snapshot.configured_value === "20.00", "finalized snapshots survive source mutation/deletion");
    check(JSON.parse(frozen).items.length === frozenBill.items.length, "finalized line snapshot preserved");
    await request("POST", `/bills/${bill.id}/recalculate`, { tax_slab_id: tax125.id }, 409);
    await request("POST", `/bills/${bill.id}/finalize`, { discount_id: null }, 409);
    bill = await request("POST", `/bills/${bill.id}/payments`, { amount: "10.00", method: "Cash", idempotency_key: randomUUID(), reference: null, notes: null }, 201);
    check(bill.status === "PARTIALLY_PAID" && bill.balance_due === "182.00", "partial payment uses adjusted total");
    await request("POST", `/bills/${bill.id}/recalculate`, {}, 409);
    await request("POST", `/bills/${bill.id}/payments`, { amount: "183.00", method: "Cash", idempotency_key: randomUUID() }, 409);
    bill = await request("POST", `/bills/${bill.id}/payments`, { amount: "182.00", method: "UPI", idempotency_key: randomUUID(), reference: null, notes: null }, 201);
    check(bill.status === "PAID" && bill.balance_due === "0.00" && bill.amount_paid === "192.00", "full payment reconciles adjusted total");
    await request("POST", `/bills/${bill.id}/recalculate`, {}, 409);
    await request("POST", `/bills/${bill.id}/void`, {}, 409);

    const clearOrder = await newOrder(); let clearBill = await request("POST", `/orders/${clearOrder.id}/bill`, { tax_slab_id: tax125.id, discount_id: capped.id }, 201);
    clearBill = await request("POST", `/bills/${clearBill.id}/recalculate`, { tax_slab_id: null, discount_id: null });
    check(clearBill.tax_snapshot === null && clearBill.discount_snapshot === null && clearBill.total_amount === clearBill.subtotal, "draft selections can be explicitly cleared");
    clearBill = await request("POST", `/bills/${clearBill.id}/void`, {});
    check(clearBill.status === "VOID" && clearBill.tax_snapshot === null, "void preserves snapshot state");
    await request("POST", `/bills/${clearBill.id}/recalculate`, {}, 409);

    await request("POST", `/orders/${(await newOrder()).id}/bill`, {}, 403, "Reception");
    await request("POST", `/orders/${(await newOrder()).id}/bill`, {}, 403, "Captain");
    await request("POST", `/orders/${(await newOrder()).id}/bill`, {}, 401, null);
    check(checks >= 66, `expected at least 66 focused checks, received ${checks}`);
    throw rollback;
  }, { timeout: 120000 });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  for (const [name, delegate] of Object.entries(saved)) prisma[name] = delegate;
  prisma.$transaction = originalTransaction;
  try {
    assert.deepEqual(await counts(), before, "Tax/discount billing fixtures were not fully rolled back");
    console.log(JSON.stringify({ checks, countsBeforeAndAfter: before, cleanup: "Every fixture rolled back; all table counts unchanged." }));
  } finally { await prisma.$disconnect(); }
}
