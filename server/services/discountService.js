import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";

const discountFields = {
  id: true, hotel_id: true, name: true, description: true, discount_type: true,
  discount_value: true, min_order_amount: true, max_discount_amount: true,
  applicable_on: true, start_date: true, end_date: true, is_active: true,
  created_at: true, updated_at: true,
  discount_menu_category: { select: { category_id: true } },
  discount_menu_item: { select: { menu_item_id: true } },
};

function serializeDiscount({ discount_value, min_order_amount, max_discount_amount, discount_menu_category, discount_menu_item, ...discount }) {
  return {
    ...discount,
    discount_value: discount_value.toFixed(2), min_order_amount: min_order_amount.toFixed(2),
    max_discount_amount: max_discount_amount === null ? null : max_discount_amount.toFixed(2),
    category_ids: discount_menu_category.map(({ category_id }) => category_id),
    menu_item_ids: discount_menu_item.map(({ menu_item_id }) => menu_item_id),
  };
}

async function requireHotel(client, hotelId) {
  if (!await client.hotel.findUnique({ where: { id: hotelId }, select: { id: true } })) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
}
async function lockHotel(client, hotelId) {
  const rows = await client.$queryRaw`SELECT id FROM hotel WHERE id = ${hotelId}::uuid FOR UPDATE`;
  if (!rows.length) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
}
async function requireDiscount(client, hotelId, discountId) {
  const discount = await client.discount.findFirst({ where: { id: discountId, hotel_id: hotelId }, select: discountFields });
  if (!discount) throw new AppError("Discount not found.", { code: "DISCOUNT_NOT_FOUND", statusCode: 404 });
  return discount;
}
function exceedsPercentageMaximum(value) {
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole) > 100n || (BigInt(whole) === 100n && /[1-9]/.test(fraction));
}
function validateEffectiveDiscount(current, data) {
  const discountType = data.discount_type ?? current.discount_type;
  const discountValue = Object.hasOwn(data, "discount_value") ? data.discount_value : current.discount_value;
  if (discountType === "percentage" && exceedsPercentageMaximum(discountValue)) {
    throw new AppError("Discount value cannot exceed 100.", { code: "INVALID_DECIMAL", statusCode: 400 });
  }
}
async function verifyMappings(client, hotelId, mappings) {
  if (!mappings) return;
  if (mappings.category_ids.length) {
    const rows = await client.menu_category.findMany({ where: { hotel_id: hotelId, id: { in: mappings.category_ids } }, select: { id: true } });
    if (rows.length !== mappings.category_ids.length) throw new AppError("One or more categories were not found for this hotel.", { code: "DISCOUNT_CATEGORY_NOT_FOUND", statusCode: 404 });
  }
  if (mappings.menu_item_ids.length) {
    const rows = await client.menu_item.findMany({ where: { hotel_id: hotelId, id: { in: mappings.menu_item_ids } }, select: { id: true } });
    if (rows.length !== mappings.menu_item_ids.length) throw new AppError("One or more menu items were not found for this hotel.", { code: "DISCOUNT_MENU_ITEM_NOT_FOUND", statusCode: 404 });
  }
}
async function replaceMappings(client, discountId, mappings) {
  await client.discount_menu_category.deleteMany({ where: { discount_id: discountId } });
  await client.discount_menu_item.deleteMany({ where: { discount_id: discountId } });
  if (mappings.category_ids.length) await client.discount_menu_category.createMany({ data: mappings.category_ids.map((category_id) => ({ discount_id: discountId, category_id })) });
  if (mappings.menu_item_ids.length) await client.discount_menu_item.createMany({ data: mappings.menu_item_ids.map((menu_item_id) => ({ discount_id: discountId, menu_item_id })) });
}

export async function getDiscountsForHotel(hotelId) {
  await requireHotel(prisma, hotelId);
  return (await prisma.discount.findMany({ where: { hotel_id: hotelId }, orderBy: { created_at: "desc" }, select: discountFields })).map(serializeDiscount);
}
export async function createDiscountForHotel(hotelId, { data, mappings }) {
  return prisma.$transaction(async (tx) => {
    await lockHotel(tx, hotelId); await verifyMappings(tx, hotelId, mappings);
    const discount = await tx.discount.create({ data: { id: randomUUID(), hotel_id: hotelId, ...data }, select: { id: true } });
    await replaceMappings(tx, discount.id, mappings);
    return serializeDiscount(await requireDiscount(tx, hotelId, discount.id));
  });
}
export async function updateDiscountForHotel(hotelId, discountId, { data, mappings }) {
  return prisma.$transaction(async (tx) => {
    await lockHotel(tx, hotelId);
    const current = await requireDiscount(tx, hotelId, discountId);
    validateEffectiveDiscount(current, data);
    await verifyMappings(tx, hotelId, mappings);
    if (Object.keys(data).length) await tx.discount.updateMany({ where: { id: discountId, hotel_id: hotelId }, data });
    if (mappings) await replaceMappings(tx, discountId, mappings);
    return serializeDiscount(await requireDiscount(tx, hotelId, discountId));
  });
}
export async function deleteDiscountForHotel(hotelId, discountId) {
  return prisma.$transaction(async (tx) => {
    await lockHotel(tx, hotelId); const discount = await requireDiscount(tx, hotelId, discountId);
    await tx.discount.deleteMany({ where: { id: discountId, hotel_id: hotelId } });
    return serializeDiscount(discount);
  });
}
