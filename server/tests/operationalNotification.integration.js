// Explicit local-only, rollback-only PostgreSQL integration test. Never runs on startup.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { createRoomBooking, updateRoomBooking, updateRoomBookingStatus } from "../services/roomBookingService.js";
import { createRoomOrder, updateRoomOrderStatus } from "../services/roomOrderService.js";
import { createCaptainOrder } from "../services/captainService.js";
import { createBill, recordPayment, refreshBill, voidBill } from "../services/billingService.js";
import { notifyActiveReceptionUsers } from "../services/operationalNotificationService.js";
import { updateKitchenOrderStatus } from "../services/kitchenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";

const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Local hms only");

const models = ["hotel", "users", "user_role", "room", "room_booking", "menu_item", "dining_area", "dining_table", "orders", "order_item", "bill", "bill_item", "payment", "notification"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const originalTransaction = prisma.$transaction.bind(prisma);
const saved = {};
const rollback = new Error("ROLLBACK_OPERATIONAL_NOTIFICATION_FIXTURES");
const results = [];
const pass = name => results.push(name);

function localDateRange(timeZone = "Asia/Kolkata") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  const start = new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`);
  return { from: start, to: new Date(start.getTime() + 86400000) };
}

try {
  await originalTransaction(async tx => {
    for (const name of [...models, "$queryRaw"]) { saved[name] = prisma[name]; prisma[name] = tx[name]; }
    let serial = 0;
    const savepoint = async work => {
      const name = `notification_test_${++serial}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
      try { const value = await work(tx); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); return value; }
      catch (error) { await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); throw error; }
    };
    prisma.$transaction = savepoint;

    const hotelId = randomUUID();
    const otherHotelId = randomUUID();
    await tx.hotel.createMany({ data: [
      { id: hotelId, name: `Operational notification ${hotelId}`, status: "ACTIVE", timezone: "Asia/Kolkata" },
      { id: otherHotelId, name: `Operational notification ${otherHotelId}`, status: "ACTIVE", timezone: "America/New_York" },
    ].map(entitledHotelFixture) });

    const roles = Object.fromEntries(await Promise.all(["Reception", "Manager", "Admin", "Captain", "Kitchen"].map(async name => [name, await tx.role.findUniqueOrThrow({ where: { name } })])));
    const password_hash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
    const addUser = async (label, assignments, { active = true } = {}) => {
      const id = randomUUID();
      await tx.users.create({ data: { id, email: `${id}@operational-notification.invalid`, name: label, password_hash, is_active: active } });
      for (const [roleName, tenant = hotelId] of assignments) await tx.user_role.create({ data: { id: randomUUID(), user_id: id, role_id: roles[roleName].id, hotel_id: tenant } });
      return id;
    };
    const receptionOne = await addUser("Reception one", [["Reception"]]);
    const receptionTwo = await addUser("Reception two", [["Reception"]]);
    const multiRoleReception = await addUser("Reception manager", [["Reception"], ["Manager"]]);
    const inactiveReception = await addUser("Inactive reception", [["Reception"]], { active: false });
    const otherReception = await addUser("Other hotel reception", [["Reception", otherHotelId]]);
    const manager = await addUser("Manager only", [["Manager"]]);
    const inactiveManager = await addUser("Inactive manager", [["Manager"]], { active: false });
    const otherManager = await addUser("Other hotel manager", [["Manager", otherHotelId]]);
    const admin = await addUser("Admin only", [["Admin"]]);
    const captain = await addUser("Captain only", [["Captain"]]);
    const kitchen = await addUser("Kitchen only", [["Kitchen"]]);
    const kitchenTwo = await addUser("Kitchen two", [["Kitchen"]]);
    const inactiveKitchen = await addUser("Inactive kitchen", [["Kitchen"]], { active: false });
    const otherKitchen = await addUser("Other hotel kitchen", [["Kitchen", otherHotelId]]);
    const recipients = [receptionOne, receptionTwo, multiRoleReception].sort();
    const managerRecipients = [manager, multiRoleReception].sort();
    const kitchenRecipients = [kitchen, kitchenTwo].sort();

    const room = await tx.room.create({ data: { id: randomUUID(), hotel_id: hotelId, room_number: "NOTIFY-101", status: "active", capacity: 2, base_price: "100.00" } });
    const menu = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Notification meal", price: "25.00" } });
    const area = await tx.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Notification area", status: "active" } });
    const table = await tx.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelId, dining_area_id: area.id, table_number: "NOTIFY-T1", capacity: 2, status: "available" } });
    const range = localDateRange();
    let bookingSerial = 0;
    const bookingInput = status => ({ room_id: room.id, customer_name: "Notification Guest", customer_phone: "0000000000", adults: 1, children: 0, booking_from: new Date(range.from.getTime() + bookingSerial++ * 2 * 86400000), booking_to: new Date(range.to.getTime() + (bookingSerial - 1) * 2 * 86400000), status });
    const notificationRows = () => tx.notification.findMany({ where: { hotel_id: hotelId }, orderBy: [{ created_at: "asc" }, { id: "asc" }] });
    const eventRows = title => tx.notification.findMany({ where: { hotel_id: hotelId, title }, orderBy: { user_id: "asc" } });
    const keyedRows = eventKey => tx.notification.findMany({ where: { hotel_id: hotelId, event_key: eventKey }, orderBy: { user_id: "asc" } });
    const assertManagerKey = async (eventKey, title) => {
      const managerRows = await keyedRows(eventKey);
      assert.equal(managerRows.length, 2);
      assert.deepEqual(managerRows.map(row => row.user_id).sort(), managerRecipients);
      assert.ok(managerRows.every(row => row.type === "manager_operational" && row.title === title && !row.is_read && row.action_url === null));
      assert.ok(!managerRows.some(row => [inactiveManager, otherManager].includes(row.user_id)));
      return managerRows;
    };
    const assertRecipients = async (title, expectedCount = 3) => {
      const rows = await eventRows(title);
      assert.equal(rows.length, expectedCount);
      assert.deepEqual(rows.map(row => row.user_id).sort(), recipients);
      assert.ok(rows.every(row => !row.is_read && row.action_url === null && row.event_key));
      return rows;
    };

    const reserved = await createRoomBooking(hotelId, bookingInput("reserved"));
    let rows = await assertRecipients("New Room Booking");
    assert.ok(rows.every(row => row.type === "booking" && row.message === `Booking ${reserved.booking_number} has been created for Room ${room.room_number}.`));
    pass("reserved booking creates exact New Room Booking notifications");
    assert.ok(!(await notificationRows()).some(row => [inactiveReception, otherReception, manager, admin, captain, kitchen].includes(row.user_id)));
    pass("only active same-hotel Reception users receive notifications");
    assert.equal(rows.filter(row => row.user_id === multiRoleReception).length, 1);
    pass("multi-role Reception user receives exactly one notification");

    const dedupeEvent = { eventKey: `test-event:${randomUUID()}`, type: "system", title: "Deduplication Test", message: "Stable event identity." };
    assert.equal(await notifyActiveReceptionUsers(tx, hotelId, dedupeEvent), 3);
    assert.equal(await notifyActiveReceptionUsers(tx, hotelId, dedupeEvent), 0);
    assert.equal((await eventRows("Deduplication Test")).length, 3);
    pass("same event and recipient cannot create a duplicate notification");
    assert.equal(await notifyActiveReceptionUsers(tx, hotelId, { ...dedupeEvent, eventKey: `${dedupeEvent.eventKey}:second` }), 3);
    assert.equal((await eventRows("Deduplication Test")).length, 6);
    pass("different events for the same entity and recipients remain possible");
    const duplicate = (await eventRows("Deduplication Test"))[0];
    await assert.rejects(savepoint(() => tx.notification.create({ data: { id: randomUUID(), hotel_id: hotelId, user_id: duplicate.user_id, title: "Constraint Test", message: "Must fail", type: "system", event_key: duplicate.event_key } })), error => error.code === "P2002");
    assert.equal((await eventRows("Deduplication Test")).length, 6);
    pass("database unique constraint enforces recipient-scoped event identity");

    const confirmedAtCreation = await createRoomBooking(hotelId, bookingInput("confirmed"));
    rows = await eventRows("New Room Booking");
    assert.equal(rows.length, 6);
    assert.equal((await eventRows("Booking Confirmed")).length, 0);
    assert.equal(rows.filter(row => row.message === `Booking ${confirmedAtCreation.booking_number} has been created for Room ${room.room_number}.`).length, 3);
    pass("initial confirmed booking creates only New Room Booking notifications");

    const beforeConfirm = (await notificationRows()).length;
    await updateRoomBookingStatus(hotelId, reserved.id, "confirmed");
    rows = await assertRecipients("Booking Confirmed");
    assert.ok(rows.every(row => row.type === "booking" && row.message === `Booking ${reserved.booking_number} for Room ${room.room_number} has been confirmed.`));
    pass("reserved to confirmed creates exact notifications");
    await updateRoomBookingStatus(hotelId, reserved.id, "confirmed");
    assert.equal((await notificationRows()).length, beforeConfirm + 3);
    pass("repeated confirmation creates no duplicate");

    await updateRoomBookingStatus(hotelId, reserved.id, "checked-in");
    rows = await assertRecipients("Guest Checked In");
    assert.ok(rows.every(row => row.message === `Guest checked in for Booking ${reserved.booking_number}, Room ${room.room_number}.`));
    pass("confirmed to checked-in creates exact notifications");
    const afterCheckIn = (await notificationRows()).length;
    await updateRoomBookingStatus(hotelId, reserved.id, "checked-in");
    assert.equal((await notificationRows()).length, afterCheckIn);
    pass("repeated check-in creates no duplicate");

    await updateRoomBookingStatus(hotelId, reserved.id, "checked-out");
    rows = await assertRecipients("Guest Checked Out");
    assert.ok(rows.every(row => row.message === `Guest checked out from Booking ${reserved.booking_number}, Room ${room.room_number}.`));
    pass("checked-in to checked-out creates exact notifications");
    const afterCheckOut = (await notificationRows()).length;
    await updateRoomBookingStatus(hotelId, reserved.id, "checked-out");
    assert.equal((await notificationRows()).length, afterCheckOut);
    pass("repeated checkout creates no duplicate");

    const editable = await createRoomBooking(hotelId, bookingInput("reserved"));
    const beforeEdit = (await notificationRows()).length;
    await updateRoomBooking(hotelId, editable.id, { notes: "No operational notification" });
    await updateRoomBookingStatus(hotelId, editable.id, "cancelled");
    assert.equal((await notificationRows()).length, beforeEdit);
    pass("booking edits and cancellation create no notification");

    const checkedIn = await createRoomBooking(hotelId, { ...bookingInput("confirmed"), booking_from: range.from, booking_to: range.to });
    await updateRoomBookingStatus(hotelId, checkedIn.id, "checked-in");
    const beforeRoomOrder = (await notificationRows()).length;
    const roomOrder = await createRoomOrder(hotelId, { room_booking_id: checkedIn.id, items: [{ menu_item_id: menu.id, quantity: 1, special_instructions: null }], status: "pending", payment_status: "pending", notes: null });
    rows = await eventRows("New Room-Service Order");
    assert.equal(rows.length, 3);
    assert.ok(rows.every(row => row.type === "room_order" && row.message === `New room-service order received for Room ${room.room_number}.`));
    await assertManagerKey(`manager-order-created:${roomOrder.id}`, "New Order");
    assert.equal((await notificationRows()).length, beforeRoomOrder + 5);
    pass("room-service creation creates exact notifications");
    assert.equal((await eventRows("New Restaurant Order")).length, 0);
    pass("room-service creation does not emit a Kitchen restaurant-order notification");
    for (const status of ["preparing", "ready", "completed"]) await updateRoomOrderStatus(hotelId, roomOrder.id, status);
    assert.equal((await notificationRows()).length, beforeRoomOrder + 5);
    pass("room-service status changes create no notification");

    const beforeCaptain = (await notificationRows()).length;
    const captainOrder = await createCaptainOrder(hotelId, captain, { table_id: table.id, customer_name: "Dining Guest", customer_phone: "0000000000", customer_email: null, notes: null, items: [{ menu_item_id: menu.id, quantity: 1, special_instructions: null }] });
    const createdKey = `restaurant-order-created:${captainOrder.id}`;
    rows = await keyedRows(createdKey);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(row => row.user_id).sort(), kitchenRecipients);
    assert.ok(rows.every(row => row.type === "restaurant_order" && row.title === "New Restaurant Order" && row.message === `Restaurant order ${captainOrder.order_number} requires preparation.` && row.action_url === null));
    assert.ok(!rows.some(row => [inactiveKitchen, otherKitchen, captain, manager, admin, ...recipients].includes(row.user_id)));
    pass("Captain restaurant-order creation notifies only active same-hotel Kitchen users");
    rows = await assertManagerKey(`manager-order-created:${captainOrder.id}`, "New Order");
    assert.ok(rows.every(row => row.message === `Restaurant order ${captainOrder.order_number} was created.`));
    pass("Captain restaurant-order creation notifies only active same-hotel Managers");
    await updateKitchenOrderStatus(hotelId, captainOrder.id, "preparing");
    await updateKitchenOrderStatus(hotelId, captainOrder.id, "ready");
    const readyKey = `restaurant-order-ready:${captainOrder.id}`;
    rows = await keyedRows(readyKey);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, captain);
    assert.equal(rows[0].title, "Order Ready");
    assert.equal(rows[0].message, `Restaurant order ${captainOrder.order_number} is ready.`);
    assert.equal(rows[0].action_url, null);
    pass("Kitchen READY transition notifies only the persisted assigned Captain");
    await updateKitchenOrderStatus(hotelId, captainOrder.id, "ready");
    assert.equal((await keyedRows(readyKey)).length, 1);
    pass("repeated READY transition creates no duplicate Captain notification");
    const beforeInvalidTransition = (await notificationRows()).length;
    await assert.rejects(updateKitchenOrderStatus(hotelId, captainOrder.id, "preparing"), error => error.code === "INVALID_ORDER_STATUS_TRANSITION");
    assert.equal((await notificationRows()).length, beforeInvalidTransition);
    pass("invalid backward Kitchen transition creates no notification");
    await updateKitchenOrderStatus(hotelId, captainOrder.id, "completed");
    assert.equal((await notificationRows()).length, beforeCaptain + 5);
    pass("Captain/Kitchen event counts remain exact through completion");

    const unassignedOrder = await tx.orders.create({ data: { id: randomUUID(), hotel_id: hotelId, table_id: table.id, captain_id: null, order_number: `ORD-${randomUUID()}`, source: "dining_table_qr", customer_name: "Unassigned QR Guest", customer_phone: "009", status: "pending", subtotal: "25.00", total_amount: "25.00", payment_status: "pending" } });
    await assert.rejects(updateKitchenOrderStatus(hotelId, unassignedOrder.id, "preparing"), error => error.code === "KITCHEN_ORDER_NOT_FOUND");
    assert.equal((await keyedRows(`restaurant-order-ready:${unassignedOrder.id}`)).length, 0);
    pass("unassigned dining-table QR order cannot bypass Captain handoff through Kitchen");

    const beforeBilling = (await notificationRows()).length;
    let roomBill = await createBill({ hotelId, userId: manager, role: "Manager" }, "ROOM", checkedIn.id);
    assert.equal((await notificationRows()).length, beforeBilling);
    roomBill = await refreshBill({ hotelId, userId: manager, role: "Manager" }, roomBill.id);
    assert.equal((await notificationRows()).length, beforeBilling);
    roomBill = await refreshBill({ hotelId, userId: manager, role: "Manager" }, roomBill.id, true);
    rows = await assertManagerKey(`manager-bill-finalized:${roomBill.id}`, "Bill Finalized");
    assert.ok(rows.every(row => row.message === `Invoice ${roomBill.invoice_number} was finalized.`));
    const afterRoomFinalization = (await notificationRows()).length;
    await assert.rejects(refreshBill({ hotelId, userId: manager, role: "Manager" }, roomBill.id, true), error => error.code === "BILL_SNAPSHOT_LOCKED");
    assert.equal((await notificationRows()).length, afterRoomFinalization);
    pass("ROOM draft creation/recalculation emits none and finalization emits exactly one per Manager");
    const beforePayment = (await notificationRows()).length;
    const managerCountBeforePayment = await tx.notification.count({ where: { hotel_id: hotelId, type: "manager_operational" } });
    const firstRoomPayment = { amount: "1.00", method: "Cash", reference: null, notes: null, idempotency_key: randomUUID() };
    roomBill = await recordPayment({ hotelId, userId: manager, role: "Manager" }, roomBill.id, firstRoomPayment);
    assert.equal(roomBill.status, "PARTIALLY_PAID");
    const finalRoomPayment = { amount: roomBill.balance_due, method: "Cash", reference: null, notes: null, idempotency_key: randomUUID() };
    roomBill = await recordPayment({ hotelId, userId: manager, role: "Manager" }, roomBill.id, finalRoomPayment);
    assert.equal(roomBill.status, "PAID");
    rows = await eventRows("Payment Recorded");
    assert.equal(rows.length, 6);
    assert.ok(rows.every(row => row.type === "payment" && row.message === `Payment recorded for Invoice ${roomBill.invoice_number}.`));
    assert.equal((await notificationRows()).length, beforePayment + 6);
    assert.equal(await tx.notification.count({ where: { hotel_id: hotelId, type: "manager_operational" } }), managerCountBeforePayment);
    pass("partial and paid ROOM transitions create Reception notifications but no Manager notification");
    await recordPayment({ hotelId, userId: manager, role: "Manager" }, roomBill.id, finalRoomPayment);
    assert.equal((await notificationRows()).length, beforePayment + 6);
    pass("transactional payment retry creates no duplicate notification");

    let captainBill = await createBill({ hotelId, userId: manager, role: "Manager" }, "CAPTAIN", captainOrder.id);
    const beforeCaptainFinalize = (await notificationRows()).length;
    captainBill = await refreshBill({ hotelId, userId: manager, role: "Manager" }, captainBill.id, true);
    await assertManagerKey(`manager-bill-finalized:${captainBill.id}`, "Bill Finalized");
    assert.equal((await notificationRows()).length, beforeCaptainFinalize + 2);
    const beforeCaptainPayment = (await notificationRows()).length;
    const managerCountBeforeCaptainPayment = await tx.notification.count({ where: { hotel_id: hotelId, type: "manager_operational" } });
    await recordPayment({ hotelId, userId: manager, role: "Manager" }, captainBill.id, { amount: captainBill.balance_due, method: "Cash", reference: null, notes: null, idempotency_key: randomUUID() });
    assert.equal((await notificationRows()).length, beforeCaptainPayment);
    assert.equal(await tx.notification.count({ where: { hotel_id: hotelId, type: "manager_operational" } }), managerCountBeforeCaptainPayment);
    pass("CAPTAIN finalization notifies Managers while its payment creates no new notification");

    const voidOrder = await tx.orders.create({ data: { id: randomUUID(), hotel_id: hotelId, table_id: table.id, order_number: `CAP-${randomUUID()}`, source: "captain", captain_id: captain, customer_name: "Void Guest", customer_phone: "010", status: "completed", subtotal: "25.00", total_amount: "25.00", payment_status: "pending", completed_at: new Date(), order_item: { create: { id: randomUUID(), menu_item_id: menu.id, item_name: menu.name, quantity: 1, unit_price: "25.00", subtotal: "25.00", status: "completed" } } } });
    const managerCountBeforeVoid = await tx.notification.count({ where: { hotel_id: hotelId, type: "manager_operational" } });
    const voidBillDraft = await createBill({ hotelId, userId: manager, role: "Manager" }, "CAPTAIN", voidOrder.id);
    await voidBill({ hotelId, userId: manager, role: "Manager" }, voidBillDraft.id);
    assert.equal(await tx.notification.count({ where: { hotel_id: hotelId, type: "manager_operational" } }), managerCountBeforeVoid);
    pass("DRAFT bill void creates no Manager notification");

    const beforeFailure = (await notificationRows()).length;
    await assert.rejects(createRoomBooking(hotelId, { ...bookingInput("reserved"), room_id: randomUUID() }));
    assert.equal((await notificationRows()).length, beforeFailure);
    pass("failed business operation leaves no notification");

    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  prisma.$transaction = originalTransaction;
  for (const [name, delegate] of Object.entries(saved)) prisma[name] = delegate;
  const after = await counts();
  assert.deepEqual(after, before);
  console.log(JSON.stringify({ checks: results.length, results, countsBefore: before, countsAfter: after, cleanup: "All operational notification fixtures rolled back." }));
  await prisma.$disconnect();
}
