// Explicit local-only, rollback-only Reception Dashboard integration test.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { getHotelDayBounds, getReceptionDashboard } from "../services/receptionDashboardService.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";

const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Local hms only");
const models = ["hotel", "users", "role", "user_role", "room", "room_booking", "orders", "order_item", "menu_item", "bill", "bill_item", "payment"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const protectedInvoiceBefore = await prisma.bill.findUnique({ where: { invoice_number: "INV-000000000021" }, include: { payments: { orderBy: { created_at: "asc" } } } });
const originalTransaction = prisma.$transaction.bind(prisma);
const saved = {};
const rollback = new Error("ROLLBACK_RECEPTION_DASHBOARD_FIXTURES");
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };

try {
  await originalTransaction(async tx => {
    for (const name of [...models, "$queryRaw"]) { saved[name] = prisma[name]; prisma[name] = tx[name]; }
    prisma.$transaction = work => work(tx);
    const hotelId = randomUUID(), otherHotelId = randomUUID();
    await tx.hotel.createMany({ data: [
      { id: hotelId, name: "Reception dashboard rollback hotel", status: "ACTIVE", timezone: "America/New_York" },
      { id: otherHotelId, name: "Reception dashboard isolation hotel", status: "ACTIVE", timezone: "Pacific/Auckland" },
    ].map(entitledHotelFixture) });
    const password_hash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
    const tokens = {};
    for (const roleName of ["Reception", "Manager", "Admin", "Captain", "Kitchen"]) {
      const role = await tx.role.findUniqueOrThrow({ where: { name: roleName } });
      const userId = randomUUID(), assignmentId = randomUUID();
      await tx.users.create({ data: { id: userId, email: `${userId}@reception-dashboard-test.invalid`, name: "Dashboard test", password_hash } });
      await tx.user_role.create({ data: { id: assignmentId, user_id: userId, role_id: role.id, hotel_id: hotelId } });
      tokens[roleName] = await createAuthenticationToken({ userId, userRoleId: assignmentId }, 300);
      if (roleName === "Reception") tokens.receptionUserId = userId;
    }
    const now = new Date();
    const { dayStart, nextDay, bookingDayStart, timezone } = await getHotelDayBounds(hotelId, now);
    check(timezone === "America/New_York", "stored hotel timezone used");
    const ms = value => new Date(value).getTime();
    const at = offset => new Date(ms(dayStart) + offset);
    const next = offset => new Date(ms(nextDay) + offset);
    const bookingAt = offset => new Date(ms(bookingDayStart) + offset * 86400000);
    const roomIds = Array.from({ length: 9 }, () => randomUUID());
    await tx.room.createMany({ data: roomIds.map((id, index) => ({ id, hotel_id: hotelId, room_number: `RD-${index + 1}`, status: index === 8 ? "inactive" : "active", capacity: 4, base_price: "100.00" })) });
    await tx.room.create({ data: { id: randomUUID(), hotel_id: otherHotelId, room_number: "OTHER", status: "active", capacity: 4, base_price: "100.00" } });
    let bookingSerial = 0;
    const booking = data => tx.room_booking.create({ data: { id: randomUUID(), hotel_id: hotelId, room_id: data.room_id, booking_number: `RD-BK-${++bookingSerial}`, customer_name: data.customer_name || `Guest ${bookingSerial}`, customer_phone: "0000000000", adults: data.adults ?? 1, children: data.children ?? 0, booking_from: data.booking_from, booking_to: data.booking_to, status: data.status, room_rate: "100.00", total_amount: "100.00", paid_amount: "0.00", payment_status: "pending", checked_in_at: data.checked_in_at, checked_out_at: data.checked_out_at } });
    const current = await booking({ room_id: roomIds[1], status: "checked-in", adults: 2, children: 1, booking_from: bookingAt(-1), booking_to: bookingAt(1), checked_in_at: at(0) });
    const due = await booking({ room_id: roomIds[3], status: "checked-in", booking_from: bookingAt(-2), booking_to: bookingAt(0), checked_in_at: at(-1) });
    await booking({ room_id: roomIds[2], status: "confirmed", booking_from: bookingAt(0), booking_to: bookingAt(1) });
    await booking({ room_id: roomIds[2], status: "confirmed", booking_from: bookingAt(-1), booking_to: bookingAt(0) });
    await booking({ room_id: roomIds[2], status: "confirmed", booking_from: bookingAt(1), booking_to: bookingAt(2) });
    await booking({ room_id: roomIds[4], status: "checked-out", booking_from: bookingAt(-2), booking_to: bookingAt(-1), checked_in_at: at(-1), checked_out_at: at(-1) });
    await booking({ room_id: roomIds[5], status: "checked-out", booking_from: bookingAt(-1), booking_to: bookingAt(0), checked_in_at: at(1), checked_out_at: at(0) });
    await booking({ room_id: roomIds[6], status: "checked-out", booking_from: bookingAt(-1), booking_to: bookingAt(0), checked_in_at: next(1), checked_out_at: at(1) });
    await booking({ room_id: roomIds[7], status: "cancelled", booking_from: bookingAt(-1), booking_to: bookingAt(1), checked_in_at: at(1) });

    const menu = await tx.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Dashboard meal", price: "20.00" } });
    const makeOrder = async (bookingId, status, source = "room_qr") => tx.orders.create({ data: { id: randomUUID(), hotel_id: hotelId, room_booking_id: source === "room_qr" ? bookingId : null, order_number: `RD-ORD-${randomUUID()}`, source, customer_name: "Dashboard Guest", customer_phone: "0", status, subtotal: "20.00", total_amount: "20.00", payment_status: "pending", order_item: { create: { id: randomUUID(), menu_item_id: menu.id, item_name: menu.name, quantity: 1, unit_price: "20.00", subtotal: "20.00", status } } } });
    await makeOrder(current.id, "pending");
    await makeOrder(current.id, "completed");

    let billSerial = 0;
    const makeBill = async (roomBookingId, status, total, type = "ROOM", orderId = null) => {
      const row = await tx.bill.create({ data: { id: randomUUID(), hotel_id: hotelId, type, room_booking_id: type === "ROOM" ? roomBookingId : null, order_id: orderId, source_reference: `RD-SRC-${++billSerial}`, hotel_snapshot: {}, guest_snapshot: {}, subtotal: total, taxable_subtotal: total, tax_amount: "0", discount_amount: "0", total_amount: total, amount_paid: "0", balance_due: total, status: "DRAFT", created_by: tokens.receptionUserId } });
      await tx.bill_item.create({ data: { id: randomUUID(), bill_id: row.id, position: 0, description: "Dashboard fixture", quantity: 1, unit_price: total, subtotal: total, tax_amount: "0", discount_amount: "0", total_amount: total } });
      if (status !== "DRAFT") return tx.bill.update({ where: { id: row.id }, data: status === "VOID" ? { status, voided_by: tokens.receptionUserId, voided_at: now } : { status, finalized_by: tokens.receptionUserId, finalized_at: now } });
      return row;
    };
    const pendingOne = await makeBill(due.id, "FINALIZED", "100.00");
    const paymentBooking = await booking({ room_id: roomIds[4], status: "checked-out", booking_from: bookingAt(-3), booking_to: bookingAt(-2) });
    const pendingTwo = await makeBill(paymentBooking.id, "FINALIZED", "100.00");
    const draftBooking = await booking({ room_id: roomIds[5], status: "checked-out", booking_from: bookingAt(-3), booking_to: bookingAt(-2) });
    await makeBill(draftBooking.id, "DRAFT", "200.00");
    const voidBooking = await booking({ room_id: roomIds[6], status: "checked-out", booking_from: bookingAt(-3), booking_to: bookingAt(-2) });
    await makeBill(voidBooking.id, "VOID", "300.00");
    const addPayment = (billId, amount, created_at) => tx.payment.create({ data: { id: randomUUID(), hotel_id: hotelId, bill_id: billId, amount, method: "Cash", status: "RECORDED", idempotency_key: randomUUID(), created_at, created_by: tokens.receptionUserId } });
    await addPayment(pendingOne.id, "5.00", at(-1));
    await addPayment(pendingOne.id, "10.00", at(0));
    await addPayment(pendingTwo.id, "15.00", at(1));
    const captainOrder = await makeOrder(null, "completed", "captain");
    const captainBill = await makeBill(null, "FINALIZED", "40.00", "CAPTAIN", captainOrder.id);
    await addPayment(captainBill.id, "40.00", at(1));

    const data = await getReceptionDashboard(hotelId, now);
    check(data.summary.totalActiveRooms === 8, "active rooms counted");
    check(data.summary.occupiedRooms === 2, "occupied rooms counted from checked-in bookings");
    check(data.summary.availableRooms === 5, "available rooms derived from hotel-local booking date and checked-in lifecycle");
    check(data.summary.todayCheckIns === 2, "hotel-day check-ins counted");
    check(data.summary.todayCheckOuts === 2, "hotel-day check-outs counted");
    check(data.summary.confirmedBookings === 1, "today confirmed arrivals counted");
    check(data.summary.pendingPaymentCount === 2, "only payable room bills counted");
    check(data.summary.pendingPaymentAmount === "170.00", "pending balance summed");
    check(data.summary.todayCollections === "25.00", "recorded room payments summed");
    check(data.summary.todayCollections !== "30.00", "payment before the hotel-local day boundary excluded");
    check(data.summary.currentGuestCount === 4, "current occupants summed");
    check(data.recentCheckIns[0].checkedInAt !== null && data.recentCheckIns.every(row => row.guestName), "recent check-ins returned newest first");
    check(data.arrivals.length === 1 && data.arrivals[0].status === "confirmed", "today arrivals returned");
    check(data.checkoutAlerts.length === 1 && data.checkoutAlerts[0].activeRoomOrderCount === 0 && data.checkoutAlerts[0].billBalance === "85.00", "checkout alert includes authoritative billing dependencies");
    check(data.activeRoomOrders.length === 1 && data.activeRoomOrders.every(row => ["pending", "preparing", "ready"].includes(row.status)), "active room orders returned and completed excluded");
    check(!data.activeRoomOrders.some(row => row.id === captainOrder.id), "Captain orders excluded");
    check(data.summary.todayCollections !== "65.00", "Captain collections excluded");
    check(data.summary.todayCollections !== "625.00", "draft, unpaid, and void bill totals do not inflate collections");
    check(data.summary.pendingPaymentCount === 2, "draft and void bills excluded");
    check(data.summary.todayCollections === "25.00", "partial payments count as collections");
    check(data.summary.todayCheckIns === 2 && data.summary.todayCheckOuts === 2, "before/exact/after midnight boundaries respected");

    const request = async (role, tenant = hotelId) => { const response = await fetch(`${origin}/api/hotels/${tenant}/reception/dashboard`, { headers: role ? { Cookie: `aazira_auth=${tokens[role] || "invalid"}` } : {} }); const body = await response.json(); return { status: response.status, body }; };
    check((await request(null)).status === 401, "unauthenticated rejected");
    const receptionResponse = await request("Reception");
    check(receptionResponse.status === 200 && receptionResponse.body.status === "success", "Reception authorized");
    check((await request("Manager")).status === 403 && (await request("Admin")).status === 403 && (await request("Captain")).status === 403 && (await request("Kitchen")).status === 403, "unauthorized roles rejected");
    check((await request("Reception", otherHotelId)).status === 403, "cross-hotel request rejected");
    check(!JSON.stringify(receptionResponse.body).includes(otherHotelId), "cross-hotel data absent");

    const mutationBooking = await booking({ room_id: roomIds[7], status: "confirmed", booking_from: bookingAt(0), booking_to: bookingAt(1) });
    check((await getReceptionDashboard(hotelId, now)).summary.confirmedBookings === 2, "dashboard refresh reflects booking mutation");
    await tx.room_booking.update({ where: { id: mutationBooking.id }, data: { status: "cancelled" } });
    await addPayment(pendingTwo.id, "5.00", at(2));
    check((await getReceptionDashboard(hotelId, now)).summary.todayCollections === "30.00", "dashboard refresh reflects payment mutation");
    check((await getReceptionDashboard(otherHotelId, now)).summary.todayCollections === "0.00", "database queries remain hotel scoped");
    throw rollback;
  }, { timeout: 120000 });
} catch (error) { if (error !== rollback) throw error; }
finally {
  for (const [name, value] of Object.entries(saved)) prisma[name] = value;
  prisma.$transaction = originalTransaction;
  await new Promise(resolve => server.close(resolve));
  try {
    assert.deepEqual(await counts(), before);
    assert.deepEqual(await prisma.bill.findUnique({ where: { invoice_number: "INV-000000000021" }, include: { payments: { orderBy: { created_at: "asc" } } } }), protectedInvoiceBefore);
    console.log(JSON.stringify({ checks, countsBeforeAndAfter: before, cleanup: "All Reception Dashboard fixtures rolled back.", protectedInvoice: "unchanged" }));
  } finally { await prisma.$disconnect(); }
}
