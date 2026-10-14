import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { hashOrderTrackingCapability } from "./orderTrackingService.js";

const CUSTOMER_BILL_STATUSES = new Set(["FINALIZED", "PARTIALLY_PAID", "PAID"]);
const CUSTOMER_ORDER_SOURCES = new Set(["dining_table_qr", "room_qr"]);
const unavailable = Object.freeze({ available: false, message: "Bill not available yet." });

const billSelection = {
  invoice_number: true,
  hotel_id: true,
  type: true,
  room_booking_id: true,
  order_id: true,
  hotel_snapshot: true,
  guest_snapshot: true,
  subtotal: true,
  taxable_subtotal: true,
  tax_amount: true,
  discount_amount: true,
  tax_snapshot: true,
  discount_snapshot: true,
  service_charge_amount: true,
  service_charge_snapshot: true,
  total_amount: true,
  amount_paid: true,
  balance_due: true,
  status: true,
  finalized_at: true,
  items: {
    orderBy: { position: "asc" },
    select: {
      description: true,
      quantity: true,
      unit_price: true,
      subtotal: true,
      discount_amount: true,
      tax_amount: true,
      total_amount: true,
    },
  },
  payments: {
    orderBy: { created_at: "asc" },
    select: { amount: true, method: true, status: true, created_at: true },
  },
};

const fail = (message, code, statusCode) => {
  throw new AppError(message, { code, statusCode });
};
const decimal = value => value.toFixed(2);
const safeText = value => typeof value === "string" && value.trim() ? value.trim() : null;

function customerContext(type, snapshot) {
  if (type === "ROOM") {
    return {
      type: "room",
      room_number: safeText(snapshot?.room_number),
      booking_from: safeText(snapshot?.booking_from),
      booking_to: safeText(snapshot?.booking_to),
    };
  }
  return {
    type: "dining_table",
    dining_area: safeText(snapshot?.dining_area),
    table_number: safeText(snapshot?.table_number),
  };
}

function adjustment(snapshot, amount, { includeRate = false } = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  return {
    name: safeText(snapshot.name),
    ...(includeRate && snapshot.rate != null ? { rate: String(snapshot.rate) } : {}),
    amount: decimal(amount),
  };
}

function projectBill(bill, timezone) {
  const hotel = bill.hotel_snapshot && typeof bill.hotel_snapshot === "object" && !Array.isArray(bill.hotel_snapshot)
    ? bill.hotel_snapshot
    : {};
  return {
    available: true,
    document_type: bill.status === "PAID" ? "receipt" : "invoice",
    invoice_number: bill.invoice_number,
    bill_type: bill.type,
    status: bill.status,
    issued_at: bill.finalized_at?.toISOString() || null,
    hotel: {
      name: safeText(hotel.name),
      address: safeText(hotel.address),
      phone: safeText(hotel.phone),
      email: safeText(hotel.email),
      timezone,
    },
    context: customerContext(bill.type, bill.guest_snapshot),
    items: bill.items.map(item => ({
      description: item.description,
      quantity: item.quantity,
      unit_price: decimal(item.unit_price),
      subtotal: decimal(item.subtotal),
      discount_amount: decimal(item.discount_amount),
      tax_amount: decimal(item.tax_amount),
      total_amount: decimal(item.total_amount),
    })),
    subtotal: decimal(bill.subtotal),
    discount_amount: decimal(bill.discount_amount),
    service_charge_amount: decimal(bill.service_charge_amount),
    taxable_subtotal: decimal(bill.taxable_subtotal),
    tax_amount: decimal(bill.tax_amount),
    total_amount: decimal(bill.total_amount),
    amount_paid: decimal(bill.amount_paid),
    balance_due: decimal(bill.balance_due),
    payment_status: bill.status,
    tax: adjustment(bill.tax_snapshot, bill.tax_amount, { includeRate: true }),
    discount: adjustment(bill.discount_snapshot, bill.discount_amount),
    service_charge: bill.service_charge_snapshot ? {
      rate: String(bill.service_charge_snapshot.applied_rate),
      amount: decimal(bill.service_charge_amount),
    } : null,
    payments: bill.payments.map(payment => ({
      amount: decimal(payment.amount),
      method: payment.method,
      status: payment.status,
      recorded_at: payment.created_at.toISOString(),
    })),
  };
}

export async function getCustomerBilling(rawCapability) {
  const capabilityHash = hashOrderTrackingCapability(rawCapability);
  const order = await prisma.orders.findUnique({
    where: { tracking_capability_hash: capabilityHash },
    select: {
      id: true,
      hotel_id: true,
      source: true,
      room_booking_id: true,
      hotel: { select: { timezone: true } },
      bill: { select: billSelection },
      room_booking: {
        select: {
          id: true,
          hotel_id: true,
          bill: { select: billSelection },
        },
      },
    },
  });

  if (!order || !CUSTOMER_ORDER_SOURCES.has(order.source)) {
    fail("Customer billing is unavailable.", "CUSTOMER_BILLING_NOT_AVAILABLE", 404);
  }

  let bill = null;
  if (order.source === "dining_table_qr") {
    bill = order.bill;
    if (bill && (bill.order_id !== order.id || bill.hotel_id !== order.hotel_id || bill.type !== "CAPTAIN")) {
      fail("Customer billing is unavailable.", "CUSTOMER_BILLING_NOT_AVAILABLE", 404);
    }
  } else {
    if (!order.room_booking_id || !order.room_booking || order.room_booking.id !== order.room_booking_id || order.room_booking.hotel_id !== order.hotel_id) {
      fail("Customer billing is unavailable.", "CUSTOMER_BILLING_NOT_AVAILABLE", 404);
    }
    bill = order.room_booking.bill;
    if (bill && (bill.room_booking_id !== order.room_booking_id || bill.hotel_id !== order.hotel_id || bill.type !== "ROOM")) {
      fail("Customer billing is unavailable.", "CUSTOMER_BILLING_NOT_AVAILABLE", 404);
    }
  }

  if (!bill || !CUSTOMER_BILL_STATUSES.has(bill.status)) return unavailable;
  return projectBill(bill, order.hotel.timezone);
}

