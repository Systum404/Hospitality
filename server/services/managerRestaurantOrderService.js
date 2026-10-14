import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";

const RESTAURANT_SOURCES = ["captain", "dining_table_qr"];

const orderSelection = {
  id: true,
  order_number: true,
  source: true,
  customer_name: true,
  customer_phone: true,
  customer_email: true,
  status: true,
  subtotal: true,
  tax_amount: true,
  discount_amount: true,
  total_amount: true,
  payment_status: true,
  notes: true,
  created_at: true,
  updated_at: true,
  completed_at: true,
  dining_table: {
    select: {
      table_number: true,
      dining_area: { select: { name: true } },
    },
  },
  order_item: {
    orderBy: { created_at: "asc" },
    select: {
      item_name: true,
      quantity: true,
      unit_price: true,
      subtotal: true,
      status: true,
      special_instructions: true,
    },
  },
};

function serializeOrder({ order_item, subtotal, tax_amount, discount_amount, total_amount, ...order }) {
  return {
    ...order,
    subtotal: subtotal.toFixed(2),
    tax_amount: tax_amount.toFixed(2),
    discount_amount: discount_amount.toFixed(2),
    total_amount: total_amount.toFixed(2),
    items: order_item.map(({ unit_price, subtotal: itemSubtotal, ...item }) => ({
      ...item,
      unit_price: unit_price.toFixed(2),
      subtotal: itemSubtotal.toFixed(2),
    })),
  };
}

export async function getManagerRestaurantOrders(hotelId) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { id: true } });
  if (!hotel) {
    throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
  }

  const orders = await prisma.orders.findMany({
    where: {
      hotel_id: hotelId,
      source: { in: RESTAURANT_SOURCES },
      room_booking_id: null,
      dining_table: { is: { hotel_id: hotelId, dining_area: { is: { hotel_id: hotelId } } } },
    },
    orderBy: [{ created_at: "desc" }, { order_number: "asc" }],
    select: orderSelection,
  });

  return orders.map(serializeOrder);
}
