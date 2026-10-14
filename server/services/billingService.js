import { randomUUID } from "node:crypto";
import { ROLE_KEYS } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { notifyActiveHotelRoleUsers, notifyActiveReceptionUsers } from "./operationalNotificationService.js";
import { bookingDateKey, bookingNights, hotelDateKey } from "../utils/bookingDates.js";

const include = { items: { orderBy: { position: "asc" } }, payments: { orderBy: { created_at: "asc" } } };
const conflict = (message, code) => { throw new AppError(message, { code, statusCode: 409 }); };
const adjusted = (message, code, statusCode = 409) => { throw new AppError(message, { code, statusCode }); };
const missing = () => adjusted("Bill or source not found for this hotel.", "BILL_NOT_FOUND", 404);

export function minor(value) {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) conflict("The source contains an invalid monetary value.", "INVALID_SOURCE_AMOUNT");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export function money(value) {
  if (value < 0n || value > 999999999999n) conflict("Amount exceeds the supported monetary range.", "BILL_AMOUNT_OUT_OF_RANGE");
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}
function serialize(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toFixed === "function" && typeof value === "object") return value.toFixed(2);
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, serialize(nested)]));
  return value;
}
async function transaction(work) {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(work, { timeout: 15000 }); }
    catch (error) {
      if (error.code === "P2034" && attempt < 2) continue;
      if (error.code === "P2002") conflict("A bill or payment already exists for this source/request.", "DUPLICATE_BILL_OR_PAYMENT");
      throw error;
    }
  }
}
async function lockHotel(tx, hotelId) {
  const rows = await tx.$queryRaw`SELECT id FROM hotel WHERE id = ${hotelId}::uuid FOR UPDATE`;
  if (!rows.length) missing();
}
async function billFor(tx, auth, id) {
  const bill = await tx.bill.findFirst({ where: { id, hotel_id: auth.hotelId }, include });
  if (!bill) missing();
  if (auth.roleKey === ROLE_KEYS.RECEPTION && bill.type !== "ROOM") adjusted("Reception can access room bills only.", "FORBIDDEN", 403);
  return bill;
}

function roundRatioHalfUp(numerator, denominator) {
  if (numerator < 0n || denominator <= 0n) throw new TypeError("Expected a nonnegative ratio.");
  return (numerator * 2n + denominator) / (denominator * 2n);
}
function percentageAmount(amount, percentage) { return roundRatioHalfUp(amount * minor(percentage), 10000n); }
function allocate(amount, weights) {
  const totalWeight = weights.reduce((sum, value) => sum + value, 0n);
  if (amount === 0n || totalWeight === 0n) return weights.map(() => 0n);
  const rows = weights.map((weight, index) => {
    const numerator = amount * weight;
    return { index, value: numerator / totalWeight, remainder: numerator % totalWeight };
  });
  let cents = amount - rows.reduce((sum, row) => sum + row.value, 0n);
  for (const row of [...rows].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (cents === 0n) break;
    row.value += 1n; cents -= 1n;
  }
  return rows.sort((a, b) => a.index - b.index).map(row => row.value);
}
const dateValue = value => value ? value.toISOString().slice(0, 10) : null;

async function selectedTax(tx, hotelId, id) {
  if (!id) return null;
  const tax = await tx.tax_slab.findFirst({ where: { id, hotel_id: hotelId }, select: { id: true, name: true, rate: true, is_active: true } });
  if (!tax) adjusted("Tax slab not found for this hotel.", "TAX_SLAB_NOT_FOUND", 404);
  if (!tax.is_active) adjusted("The selected tax slab is inactive.", "TAX_SLAB_INACTIVE");
  return tax;
}
async function selectedDiscount(tx, hotelId, id, today) {
  if (!id) return null;
  const discount = await tx.discount.findFirst({
    where: { id, hotel_id: hotelId },
    select: {
      id: true, name: true, discount_type: true, discount_value: true, min_order_amount: true,
      max_discount_amount: true, applicable_on: true, start_date: true, end_date: true, is_active: true,
      discount_menu_category: { select: { category_id: true } },
      discount_menu_item: { select: { menu_item_id: true } },
    },
  });
  if (!discount) adjusted("Discount not found for this hotel.", "DISCOUNT_NOT_FOUND", 404);
  if (!discount.is_active) adjusted("The selected discount is inactive.", "DISCOUNT_INACTIVE");
  if (discount.start_date && today < dateValue(discount.start_date)) adjusted("The selected discount has not started yet.", "DISCOUNT_NOT_STARTED");
  if (discount.end_date && today > dateValue(discount.end_date)) adjusted("The selected discount has expired.", "DISCOUNT_EXPIRED");
  const valid = discount.applicable_on === "all"
    || (discount.applicable_on === "categories" && discount.discount_menu_category.length)
    || (discount.applicable_on === "specific_items" && discount.discount_menu_item.length);
  if (!valid) adjusted("The selected discount has invalid applicability configuration.", "INVALID_DISCOUNT_APPLICABILITY");
  return discount;
}
function selection(input, snapshot, key) { return Object.hasOwn(input, key) ? input[key] : snapshot?.configuration_id ?? null; }

function calculate(items, tax, discount, serviceCharge) {
  const subtotals = items.map(item => minor(item.subtotal));
  const subtotal = subtotals.reduce((sum, value) => sum + value, 0n);
  const categories = new Set(discount?.discount_menu_category.map(row => row.category_id) ?? []);
  const menuItems = new Set(discount?.discount_menu_item.map(row => row.menu_item_id) ?? []);
  const eligible = items.map(item => Boolean(discount) && (discount.applicable_on === "all"
    || (discount.applicable_on === "categories" && item.menu_category_id && categories.has(item.menu_category_id))
    || (discount.applicable_on === "specific_items" && item.menu_item_id && menuItems.has(item.menu_item_id))));
  const eligibleWeights = subtotals.map((value, index) => eligible[index] ? value : 0n);
  const eligibleSubtotal = eligibleWeights.reduce((sum, value) => sum + value, 0n);
  let discountAmount = 0n;
  if (discount && eligibleSubtotal >= minor(discount.min_order_amount)) {
    discountAmount = discount.discount_type === "percentage" ? percentageAmount(eligibleSubtotal, discount.discount_value) : minor(discount.discount_value);
    if (discount.max_discount_amount !== null && discountAmount > minor(discount.max_discount_amount)) discountAmount = minor(discount.max_discount_amount);
    if (discountAmount > eligibleSubtotal) discountAmount = eligibleSubtotal;
  }
  const discountParts = allocate(discountAmount, eligibleWeights);
  const taxableWeights = subtotals.map((value, index) => value - discountParts[index]);
  const discountedSubtotal = subtotal - discountAmount;
  const serviceChargeBase = taxableWeights.reduce((sum, value, index) => sum + (items[index].service_charge_eligible ? value : 0n), 0n);
  const serviceChargeAmount = serviceCharge.rate === null ? 0n : percentageAmount(serviceChargeBase, serviceCharge.rate);
  const taxableSubtotal = discountedSubtotal + serviceChargeAmount;
  const taxAmount = tax ? percentageAmount(taxableSubtotal, tax.rate) : 0n;
  const taxAllocation = allocate(taxAmount, [...taxableWeights, serviceChargeAmount]);
  const taxParts = taxAllocation.slice(0, items.length);
  const adjustedItems = items.map((item, index) => ({ ...item, discount_eligible: eligible[index], discount_amount: money(discountParts[index]), tax_amount: money(taxParts[index]), total_amount: money(taxableWeights[index] + taxParts[index]) }));
  return {
    items: adjustedItems, subtotal: money(subtotal), taxable_subtotal: money(taxableSubtotal),
    discount_amount: money(discountAmount), service_charge_amount: money(serviceChargeAmount), tax_amount: money(taxAmount), total_amount: money(taxableSubtotal + taxAmount), balance_due: money(taxableSubtotal + taxAmount),
    service_charge_snapshot: serviceCharge.rate === null ? null : {
      configured_enabled: serviceCharge.configuredEnabled,
      configured_rate: serviceCharge.configuredRate,
      applied_rate: serviceCharge.rate,
      overridden: serviceCharge.overridden,
      eligible_discounted_base: money(serviceChargeBase),
      amount: money(serviceChargeAmount),
      taxable: true,
      rounding: "HALF_UP_2DP",
    },
    tax_snapshot: tax ? { configuration_id: tax.id, name: tax.name, rate: money(minor(tax.rate)), taxable_subtotal: money(taxableSubtotal), amount: money(taxAmount), rounding: "HALF_UP_2DP" } : null,
    discount_snapshot: discount ? {
      configuration_id: discount.id, name: discount.name, type: discount.discount_type, configured_value: money(minor(discount.discount_value)), applicability: discount.applicable_on,
      minimum_order_amount: money(minor(discount.min_order_amount)), maximum_discount_amount: discount.max_discount_amount === null ? null : money(minor(discount.max_discount_amount)),
      eligible_subtotal: money(eligibleSubtotal), amount: money(discountAmount), rounding: "HALF_UP_2DP",
    } : null,
  };
}

async function snapshot(tx, hotelId, type, sourceId, selections = {}, finalizing = false) {
  const hotel = await tx.hotel.findUnique({ where: { id: hotelId }, select: { name: true, address: true, phone: true, email: true, timezone: true } });
  if (!hotel) missing();
  let guest, reference, orders, items = [];
  if (type === "ROOM") {
    const booking = await tx.room_booking.findFirst({ where: { id: sourceId, hotel_id: hotelId, room: { hotel_id: hotelId } }, include: { room: true } });
    if (!booking) missing();
    if (minor(booking.paid_amount) !== 0n) conflict("Legacy booking paid amount requires reconciliation before billing. No payment was imported or changed.", "LEGACY_PAYMENT_RECONCILIATION_REQUIRED");
    if (booking.status === "cancelled") conflict("A cancelled booking cannot be billed.", "BOOKING_NOT_BILLABLE");
    const nights = bookingNights(booking.booking_from, booking.booking_to);
    if (!Number.isSafeInteger(nights) || nights < 0 || nights > 2147483647) conflict("Invalid booking dates.", "INVALID_BOOKING_DATES");
    const roomTotal = money(minor(booking.room_rate) * BigInt(nights));
    items.push({ description: `Room ${booking.room.room_number}`, menu_item_id: null, menu_category_id: null, service_charge_eligible: false, quantity: nights, unit_price: money(minor(booking.room_rate)), subtotal: roomTotal });
    reference = booking.booking_number;
    guest = { name: booking.customer_name, phone: booking.customer_phone, email: booking.customer_email, room_number: booking.room.room_number, booking_from: bookingDateKey(booking.booking_from), booking_to: bookingDateKey(booking.booking_to) };
    orders = await tx.orders.findMany({ where: { room_booking_id: sourceId }, include: { order_item: { include: { menu_item: true } } }, orderBy: [{ created_at: "asc" }, { id: "asc" }] });
    if (orders.some(order => order.hotel_id !== hotelId || order.source !== "room_qr")) conflict("Booking contains an inconsistent order relationship; reconciliation is required.", "INVALID_BILL_SOURCE");
    if (finalizing && orders.some(order => order.status !== "completed")) conflict("Complete every linked room-service order before finalizing this bill.", "ROOM_ORDERS_UNFINISHED");
  } else {
    const order = await tx.orders.findFirst({ where: { id: sourceId, hotel_id: hotelId, source: { in: ["captain", "dining_table_qr"] }, room_booking_id: null }, include: { dining_table: { include: { dining_area: { select: { name: true } } } }, order_item: { include: { menu_item: true } } } });
    if (!order || order.dining_table?.hotel_id !== hotelId) missing();
    if (order.status !== "completed") conflict("Complete the restaurant order before billing it.", "RESTAURANT_ORDER_UNFINISHED");
    reference = order.order_number;
    guest = { name: order.customer_name, phone: order.customer_phone, email: order.customer_email, dining_area: order.dining_table.dining_area.name, table_number: order.dining_table.table_number };
    orders = [order];
  }
  for (const order of orders) {
    if (!order.order_item.length) conflict("An order contains invalid or missing billable lines.", "INVALID_BILL_SOURCE");
    for (const item of order.order_item.sort((a, b) => a.id.localeCompare(b.id))) {
      if (item.menu_item.hotel_id !== hotelId || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) conflict("Invalid billable order item.", "INVALID_BILL_SOURCE");
      const line = minor(item.unit_price) * BigInt(item.quantity);
      if (line !== minor(item.subtotal)) conflict("Stored item price and subtotal disagree; reconciliation is required.", "SOURCE_AMOUNT_MISMATCH");
      items.push({ description: item.item_name || item.menu_item.name, source_order_id: order.id, source_item_id: item.id, menu_item_id: item.menu_item_id, menu_category_id: item.menu_item.category_id, service_charge_eligible: true, quantity: item.quantity, unit_price: money(minor(item.unit_price)), subtotal: money(line) });
    }
  }
  const persistedSettings = await tx.hotel_billing_settings.findUnique({
    where: { hotel_id: hotelId },
    select: { service_charge_enabled: true, service_charge_rate: true, default_tax_slab_id: true, default_tax_slab: { select: { is_active: true } } },
  });
  const settings = persistedSettings ?? { service_charge_enabled: false, service_charge_rate: "0.00", default_tax_slab_id: null, default_tax_slab: null };
  const configuredRate = money(minor(settings.service_charge_rate));
  const hasOverride = Object.hasOwn(selections, "service_charge_rate") && selections.service_charge_rate !== undefined;
  const requestedRate = hasOverride ? money(minor(selections.service_charge_rate)) : settings.service_charge_enabled ? configuredRate : null;
  if (requestedRate !== null && minor(requestedRate) > minor(configuredRate)) conflict("Service charge adjustment cannot exceed the configured hotel rate.", "SERVICE_CHARGE_OVERRIDE_EXCEEDS_CONFIGURED_RATE");
  if (!settings.service_charge_enabled && requestedRate !== null && minor(requestedRate) !== 0n) conflict("Service charge is disabled for this hotel.", "SERVICE_CHARGE_DISABLED");
  const defaultTaxId = settings.default_tax_slab?.is_active ? settings.default_tax_slab_id : null;
  const taxId = Object.hasOwn(selections, "tax_slab_id") ? selections.tax_slab_id : defaultTaxId;
  const tax = await selectedTax(tx, hotelId, taxId);
  const discount = await selectedDiscount(tx, hotelId, selections.discount_id, hotelDateKey(new Date(), hotel.timezone));
  const financials = calculate(items, tax, discount, { configuredEnabled: settings.service_charge_enabled, configuredRate, rate: requestedRate, overridden: hasOverride });
  const { timezone: _timezone, ...hotelSnapshot } = hotel;
  return {
    source_reference: reference,
    hotel_snapshot: hotelSnapshot,
    guest_snapshot: guest,
    ...financials,
    items: financials.items.map(({ service_charge_eligible: _eligible, ...item }, position) => ({ id: randomUUID(), position, ...item })),
  };
}

export async function listBills(auth) { return serialize(await prisma.bill.findMany({ where: { hotel_id: auth.hotelId, ...(auth.roleKey === ROLE_KEYS.RECEPTION ? { type: "ROOM" } : {}) }, orderBy: { created_at: "desc" }, include })); }
export async function getBillingTimezone(auth) {
  const hotel = await prisma.hotel.findUnique({ where: { id: auth.hotelId }, select: { timezone: true } });
  if (!hotel) missing();
  return hotel.timezone;
}
export async function listBillingOptions(auth) {
  const [taxSlabs, discounts, settings] = await Promise.all([
    prisma.tax_slab.findMany({ where: { hotel_id: auth.hotelId, is_active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, rate: true } }),
    prisma.discount.findMany({ where: { hotel_id: auth.hotelId, is_active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, discount_type: true, discount_value: true, min_order_amount: true, max_discount_amount: true, applicable_on: true, start_date: true, end_date: true } }),
    prisma.hotel_billing_settings.findUnique({ where: { hotel_id: auth.hotelId }, select: { service_charge_enabled: true, service_charge_rate: true, default_tax_slab_id: true } }),
  ]);
  return serialize({ tax_slabs: taxSlabs, discounts, billing_settings: settings });
}
export function summarizeBills(bills) {
  const totals = bills.reduce((sum, bill) => {
    const pending = ["DRAFT", "FINALIZED", "PARTIALLY_PAID"].includes(bill.status);
    sum.total += bill.status === "VOID" ? 0n : minor(bill.total_amount); sum.collected += minor(bill.amount_paid); sum.pending += pending ? minor(bill.balance_due) : 0n;
    sum.paidCount += bill.status === "PAID" ? 1 : 0; sum.pendingCount += pending ? 1 : 0; return sum;
  }, { total: 0n, collected: 0n, pending: 0n, paidCount: 0, pendingCount: 0 });
  const decimal = amount => `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`;
  return { ...totals, count: bills.length, total: decimal(totals.total), collected: decimal(totals.collected), pending: decimal(totals.pending) };
}
export async function getBill(auth, id) { return serialize(await billFor(prisma, auth, id)); }
export async function createBill(auth, type, sourceId, selections = {}) {
  return transaction(async tx => {
    await lockHotel(tx, auth.hotelId);
    if (auth.roleKey === ROLE_KEYS.RECEPTION && type !== "ROOM") adjusted("Reception can create room bills only.", "FORBIDDEN", 403);
    const source = type === "ROOM" ? { room_booking_id: sourceId } : { order_id: sourceId };
    if (await tx.bill.findFirst({ where: { hotel_id: auth.hotelId, ...source } })) conflict("A bill already exists for this source, including draft or void history.", "BILL_ALREADY_EXISTS");
    const { items, ...data } = await snapshot(tx, auth.hotelId, type, sourceId, selections);
    return serialize(await tx.bill.create({ data: { id: randomUUID(), hotel_id: auth.hotelId, type, ...source, ...data, created_by: auth.userId, items: { create: items } }, include }));
  });
}
export async function refreshBill(auth, id, selectionInput = {}, finalize = false) {
  if (typeof selectionInput === "boolean") { finalize = selectionInput; selectionInput = {}; }
  return transaction(async tx => {
    await lockHotel(tx, auth.hotelId);
    const bill = await billFor(tx, auth, id);
    if (bill.status !== "DRAFT") conflict("Only draft bills may be recalculated or finalized.", "BILL_SNAPSHOT_LOCKED");
    const serviceChargeRate = Object.hasOwn(selectionInput, "service_charge_rate")
      ? selectionInput.service_charge_rate
      : bill.service_charge_snapshot?.overridden ? bill.service_charge_snapshot.applied_rate : undefined;
    const selections = { tax_slab_id: selection(selectionInput, bill.tax_snapshot, "tax_slab_id"), discount_id: selection(selectionInput, bill.discount_snapshot, "discount_id"), service_charge_rate: serviceChargeRate };
    const { items, ...data } = await snapshot(tx, auth.hotelId, bill.type, bill.room_booking_id || bill.order_id, selections, finalize);
    await tx.bill_item.deleteMany({ where: { bill_id: id } });
    await tx.bill.update({ where: { id }, data: { ...data, items: { create: items } } });
    if (finalize) {
      const finalizedStatus = minor(data.total_amount) === 0n ? "PAID" : "FINALIZED";
      await tx.bill.update({ where: { id }, data: { status: finalizedStatus, finalized_at: new Date(), finalized_by: auth.userId } });
      if (finalizedStatus === "FINALIZED") {
        await notifyActiveHotelRoleUsers(tx, auth.hotelId, ROLE_KEYS.MANAGER, {
          eventKey: `manager-bill-finalized:${bill.id}`,
          type: "manager_operational",
          title: "Bill Finalized",
          message: `Invoice ${bill.invoice_number} was finalized.`,
        });
      }
    }
    return serialize(await billFor(tx, auth, id));
  });
}
export async function voidBill(auth, id) {
  return transaction(async tx => {
    await lockHotel(tx, auth.hotelId); const bill = await billFor(tx, auth, id);
    if (bill.payments.length) conflict("Bills with recorded payments cannot be voided. Refunds are not supported.", "BILL_HAS_PAYMENTS");
    if (!["DRAFT", "FINALIZED"].includes(bill.status)) conflict("This bill cannot be voided.", "INVALID_BILL_TRANSITION");
    return serialize(await tx.bill.update({ where: { id }, data: { status: "VOID", voided_at: new Date(), voided_by: auth.userId }, include }));
  });
}
export async function recordPayment(auth, id, input) {
  return transaction(async tx => {
    await lockHotel(tx, auth.hotelId); const bill = await billFor(tx, auth, id);
    const previous = await tx.payment.findUnique({ where: { hotel_id_idempotency_key: { hotel_id: auth.hotelId, idempotency_key: input.idempotency_key } } });
    if (previous) {
      if (previous.bill_id !== id || minor(previous.amount) !== minor(input.amount) || previous.method !== input.method || previous.reference !== input.reference || previous.notes !== input.notes) conflict("This payment request key was used for different details.", "PAYMENT_KEY_CONFLICT");
      return serialize(bill);
    }
    if (!["FINALIZED", "PARTIALLY_PAID"].includes(bill.status)) conflict("Only finalized bills with an outstanding balance may receive payments.", "BILL_NOT_PAYABLE");
    if (minor(input.amount) > minor(bill.balance_due)) conflict("Payment exceeds the outstanding balance.", "PAYMENT_EXCEEDS_BALANCE");
    const payment = await tx.payment.create({ data: { id: randomUUID(), hotel_id: auth.hotelId, bill_id: id, created_by: auth.userId, ...input } });
    if (bill.type === "ROOM") await notifyActiveReceptionUsers(tx, auth.hotelId, { eventKey: `payment-recorded:${payment.id}`, type: "payment", title: "Payment Recorded", message: `Payment recorded for Invoice ${bill.invoice_number}.` });
    return serialize(await billFor(tx, auth, id));
  });
}
