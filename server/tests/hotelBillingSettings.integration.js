// Local-only, rollback-only PostgreSQL/HTTP coverage for authoritative hotel billing settings.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { ROLE_DEFINITIONS } from "../config/roles.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";

const database = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && database.pathname === "/hms", "Local hms only");
const models = ["hotel", "hotel_billing_settings", "users", "role", "user_role", "tax_slab", "discount", "menu_item", "dining_area", "dining_table", "orders", "order_item", "room", "room_booking", "bill", "bill_item", "notification", "audit_event"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const originalTransaction = prisma.$transaction.bind(prisma);
const saved = {};
const rollback = new Error("ROLLBACK_HOTEL_BILLING_SETTINGS");
let server;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };

try {
  await originalTransaction(async tx => {
    for (const name of [...models, "$queryRaw"]) { saved[name] = prisma[name]; prisma[name] = tx[name]; }
    let serial = 0;
    prisma.$transaction = async work => {
      const name = `hotel_billing_settings_${++serial}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
      try { const result = await work(tx); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); return result; }
      catch (error) { await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); throw error; }
    };

    const hotelA = randomUUID(), hotelB = randomUUID();
    await tx.hotel.createMany({ data: [{ id: hotelA, name: "Settings A", status: "ACTIVE", timezone: "Asia/Kolkata" }, { id: hotelB, name: "Settings B", status: "ACTIVE", timezone: "UTC" }].map(entitledHotelFixture) });
    await tx.hotel_billing_settings.createMany({ data: [{ hotel_id: hotelA }, { hotel_id: hotelB }] });
    const passwordHash = await argon2.hash(randomUUID());
    const tokens = {};
    const identities = {};
    for (const roleName of ["Admin", "Manager", "Reception", "Captain", "Kitchen"]) {
      const [roleKey, definition] = Object.entries(ROLE_DEFINITIONS).find(([, item]) => item.displayName === roleName);
      const role = await tx.role.upsert({ where: { name: roleName }, create: { name: roleName, system_key: roleKey, scope: definition.scope, is_protected: true }, update: {} });
      const userId = randomUUID(), assignmentId = randomUUID();
      await tx.users.create({ data: { id: userId, email: `${userId}@settings.invalid`, name: `${roleName} Settings`, password_hash: passwordHash } });
      await tx.user_role.create({ data: { id: assignmentId, user_id: userId, role_id: role.id, hotel_id: hotelA } });
      tokens[roleName] = await createAuthenticationToken({ userId, userRoleId: assignmentId }, 300);
      identities[roleName] = { userId, assignmentId };
    }
    const tax10 = await tx.tax_slab.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "GST 10", rate: "10.00", applicable_on: "all", is_active: true } });
    const inactiveTax = await tx.tax_slab.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "Inactive", rate: "5.00", applicable_on: "all", is_active: false } });
    const foreignTax = await tx.tax_slab.create({ data: { id: randomUUID(), hotel_id: hotelB, name: "Foreign", rate: "8.00", applicable_on: "all", is_active: true } });
    const discount = await tx.discount.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "Ten percent", discount_type: "percentage", discount_value: "10.00", applicable_on: "all", is_active: true } });
    const menu = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "Meal", price: "100.00", is_available: true } });
    const area = await tx.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "Dining", status: "active" } });
    const table = await tx.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelA, dining_area_id: area.id, table_number: "SET-1", capacity: 4, status: "available" } });
    const room = await tx.room.create({ data: { id: randomUUID(), hotel_id: hotelA, room_number: "SET-ROOM", status: "active", base_price: "100.00" } });

    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (method, hotelId, path, body, expected = 200, role = "Admin") => {
      const response = await fetch(`${origin}/api/hotels/${hotelId}${path}`, { method, headers: { ...(role ? { Cookie: `aazira_auth=${tokens[role] || "invalid"}` } : {}), "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const payload = await response.json();
      assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`); checks++;
      return payload;
    };
    await request("GET", hotelA, "/settings", undefined, 401, null);
    await request("GET", hotelA, "/settings", undefined, 403, "Reception");
    check((await request("GET", hotelA, "/settings", undefined, 200, "Admin")).data.billing.service_charge_enabled === false, "Admin reads disabled default");
    check((await request("GET", hotelA, "/settings", undefined, 200, "Manager")).data.billing.default_tax_slab_id === null, "Manager reads settings");
    await request("PATCH", hotelA, "/settings/billing", { service_charge_enabled: true, service_charge_rate: "10.00" }, 403, "Manager");
    await request("GET", hotelB, "/settings", undefined, 403, "Admin");
    await request("PATCH", hotelA, "/settings/billing", { default_tax_slab_id: foreignTax.id }, 404);
    await request("PATCH", hotelA, "/settings/billing", { default_tax_slab_id: inactiveTax.id }, 409);
    await request("PATCH", hotelA, "/settings/billing", { service_charge_enabled: true, service_charge_rate: "0.00" }, 400);
    const updated = await request("PATCH", hotelA, "/settings/billing", { service_charge_enabled: true, service_charge_rate: "10.00", default_tax_slab_id: tax10.id });
    check(updated.data.billing.default_tax_slab_id === tax10.id && updated.data.billing.service_charge_rate === "10.00", "Admin persists billing settings");
    check(await tx.audit_event.count({ where: { hotel_id: hotelA, action: { in: ["HOTEL_BILLING_SETTINGS_UPDATED", "HOTEL_DEFAULT_TAX_UPDATED", "HOTEL_SERVICE_CHARGE_UPDATED"] } } }) === 3, "settings mutation writes three transactional audits");

    const order = async () => tx.orders.create({ data: { id: randomUUID(), hotel_id: hotelA, table_id: table.id, order_number: `SET-${randomUUID()}`, source: "captain", customer_name: "Settings Guest", customer_phone: "0000000000", status: "completed", payment_status: "pending", subtotal: "100.00", total_amount: "100.00", order_item: { create: { id: randomUUID(), menu_item_id: menu.id, item_name: menu.name, quantity: 1, unit_price: "100.00", subtotal: "100.00", status: "completed" } } } });
    let restaurantBill = (await request("POST", hotelA, `/orders/${(await order()).id}/bill`, { discount_id: discount.id }, 201, "Manager")).data.bill;
    check(restaurantBill.tax_snapshot.configuration_id === tax10.id, "default tax is preselected for new draft");
    check(restaurantBill.discount_amount === "10.00" && restaurantBill.service_charge_amount === "9.00", "service charge uses discounted restaurant base");
    check(restaurantBill.taxable_subtotal === "99.00" && restaurantBill.tax_amount === "9.90" && restaurantBill.total_amount === "108.90", "service charge is taxable with exact two-decimal math");
    check(restaurantBill.service_charge_snapshot.eligible_discounted_base === "90.00", "service charge terms are snapshotted separately");
    restaurantBill = (await request("POST", hotelA, `/bills/${restaurantBill.id}/recalculate`, { service_charge_rate: "0.00", tax_slab_id: null }, 200, "Manager")).data.bill;
    check(restaurantBill.service_charge_amount === "0.00" && restaurantBill.tax_snapshot === null, "draft staff can remove service charge and tax");
    await request("POST", hotelA, `/bills/${restaurantBill.id}/recalculate`, { service_charge_rate: "11.00" }, 409, "Manager");
    restaurantBill = (await request("POST", hotelA, `/bills/${restaurantBill.id}/recalculate`, { service_charge_rate: "10.00", tax_slab_id: tax10.id }, 200, "Manager")).data.bill;
    check(restaurantBill.service_charge_amount === "9.00" && restaurantBill.total_amount === "108.90", "draft staff can restore the configured service charge and tax exactly");

    const booking = await tx.room_booking.create({ data: { id: randomUUID(), hotel_id: hotelA, room_id: room.id, booking_number: `SET-${randomUUID()}`, customer_name: "Room Guest", customer_phone: "0000000000", booking_from: new Date("2026-09-01T00:00:00Z"), booking_to: new Date("2026-09-03T00:00:00Z"), status: "checked-in", room_rate: "100.00", total_amount: "200.00", payment_status: "pending" } });
    await tx.orders.create({ data: { id: randomUUID(), hotel_id: hotelA, room_booking_id: booking.id, order_number: `SET-${randomUUID()}`, source: "room_qr", customer_name: "Room Guest", customer_phone: "0000000000", status: "completed", payment_status: "pending", subtotal: "100.00", total_amount: "100.00", order_item: { create: { id: randomUUID(), menu_item_id: menu.id, item_name: menu.name, quantity: 1, unit_price: "100.00", subtotal: "100.00", status: "completed" } } } });
    const roomBill = (await request("POST", hotelA, `/room-bookings/${booking.id}/bill`, { discount_id: discount.id }, 201, "Reception")).data.bill;
    check(roomBill.subtotal === "300.00" && roomBill.service_charge_amount === "9.00", "mixed room bill excludes accommodation from service charge");
    check(roomBill.service_charge_snapshot.eligible_discounted_base === "90.00", "only discounted room-service food is eligible");

    let frozen = (await request("POST", hotelA, `/bills/${restaurantBill.id}/finalize`, {}, 200, "Manager")).data.bill;
    const frozenTotal = frozen.total_amount, frozenSnapshot = JSON.stringify(frozen.service_charge_snapshot);
    check(frozen.service_charge_amount === "9.00", "finalized bill persists the non-zero service-charge component");
    await request("PATCH", hotelA, "/settings/billing", { service_charge_enabled: true, service_charge_rate: "5.00" });
    frozen = (await request("GET", hotelA, `/bills/${restaurantBill.id}`, undefined, 200, "Manager")).data.bill;
    check(frozen.total_amount === frozenTotal && JSON.stringify(frozen.service_charge_snapshot) === frozenSnapshot, "finalized bill remains immutable after settings change");
    frozen = (await request("POST", hotelA, `/bills/${restaurantBill.id}/payments`, { amount: "0.90", method: "Cash", idempotency_key: randomUUID() }, 201, "Manager")).data.bill;
    check(frozen.status === "PARTIALLY_PAID" && frozen.amount_paid === "0.90" && frozen.balance_due === "108.00" && frozen.service_charge_amount === "9.00", "partially paid bill retains exact service-charge financials");
    await request("PATCH", hotelA, "/settings/billing", { service_charge_enabled: false, service_charge_rate: "0.00" });
    frozen = (await request("POST", hotelA, `/bills/${restaurantBill.id}/payments`, { amount: "108.00", method: "Card", idempotency_key: randomUUID() }, 201, "Manager")).data.bill;
    check(frozen.status === "PAID" && frozen.balance_due === "0.00" && frozen.total_amount === frozenTotal && JSON.stringify(frozen.service_charge_snapshot) === frozenSnapshot, "paid bill remains immutable after service charge is disabled");

    await request("PATCH", hotelA, `/tax-slabs/${tax10.id}/status`, { is_active: false }, 200, "Manager");
    const cleared = (await request("GET", hotelA, "/settings", undefined, 200, "Admin")).data.billing;
    check(cleared.default_tax_slab_id === null, "deactivating default tax clears configuration");
    check(await tx.notification.count({ where: { hotel_id: hotelA, user_id: identities.Admin.userId, event_key: `default-tax-cleared:${tax10.id}` } }) === 1, "Hotel Admin receives one default-tax notification");
    check(await tx.audit_event.count({ where: { hotel_id: hotelA, action: "HOTEL_DEFAULT_TAX_UPDATED" } }) === 2, "default-tax clear is audited");
    check(checks >= 28, `expected at least 28 checks, received ${checks}`);
    throw rollback;
  }, { timeout: 120000 });
} catch (error) { if (error !== rollback) throw error; }
finally {
  for (const [name, value] of Object.entries(saved)) prisma[name] = value;
  prisma.$transaction = originalTransaction;
  if (server) await new Promise(resolve => server.close(resolve));
  try { assert.deepEqual(await counts(), before); console.log(JSON.stringify({ checks, countsBeforeAndAfter: before, cleanup: "Every fixture rolled back; all tracked table counts unchanged." })); }
  finally { await prisma.$disconnect(); }
}
