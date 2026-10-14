import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";

const menuItemFields = {
  id: true,
  name: true,
  description: true,
  price: true,
  image_url: true,
  is_available: true,
  is_veg: true,
  preparation_time: true,
  menu_category: { select: { id: true, name: true } },
  created_at: true,
  updated_at: true,
};

function serializeMenuItem({ menu_category: category, price, ...item }) {
  return { ...item, price: price.toFixed(2), category };
}

async function requireHotel(hotelId) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { id: true } });
  if (!hotel) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
}

async function requireHotelCategory(hotelId, categoryId) {
  if (categoryId === undefined || categoryId === null) return;
  const category = await prisma.menu_category.findFirst({ where: { id: categoryId, hotel_id: hotelId }, select: { id: true } });
  if (!category) throw new AppError("Menu category not found for this hotel.", { code: "MENU_CATEGORY_NOT_FOUND", statusCode: 404 });
}

async function requireHotelMenuItem(hotelId, itemId, client = prisma) {
  const menuItem = await client.menu_item.findFirst({ where: { id: itemId, hotel_id: hotelId }, select: menuItemFields });
  if (!menuItem) throw new AppError("Menu item not found for this hotel.", { code: "MENU_ITEM_NOT_FOUND", statusCode: 404 });
  return menuItem;
}

export async function getMenuItemsForHotel(hotelId) {
  await requireHotel(hotelId);
  const menuItems = await prisma.menu_item.findMany({
    where: { hotel_id: hotelId, OR: [{ category_id: null }, { menu_category: { is: { hotel_id: hotelId } } }] },
    orderBy: { name: "asc" },
    select: menuItemFields,
  });
  return menuItems.map(serializeMenuItem);
}

export async function createMenuItem(hotelId, input) {
  await requireHotel(hotelId);
  await requireHotelCategory(hotelId, input.category_id);
  return serializeMenuItem(await prisma.menu_item.create({
    data: { id: randomUUID(), hotel_id: hotelId, ...input },
    select: menuItemFields,
  }));
}

export async function updateMenuItem(hotelId, itemId, input) {
  await requireHotel(hotelId);
  await requireHotelMenuItem(hotelId, itemId);
  await requireHotelCategory(hotelId, input.category_id);
  const result = await prisma.menu_item.updateMany({ where: { id: itemId, hotel_id: hotelId }, data: input });
  if (result.count !== 1) throw new AppError("Menu item not found for this hotel.", { code: "MENU_ITEM_NOT_FOUND", statusCode: 404 });
  return serializeMenuItem(await requireHotelMenuItem(hotelId, itemId));
}

export async function deleteMenuItem(hotelId, itemId) {
  await requireHotel(hotelId);
  try {
    return await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT id
        FROM menu_item
        WHERE id = ${itemId}::uuid
          AND hotel_id = ${hotelId}::uuid
        FOR UPDATE
      `;

      const menuItem = await transaction.menu_item.findFirst({
        where: { id: itemId, hotel_id: hotelId },
        select: { ...menuItemFields, _count: { select: { order_item: true } } },
      });
      if (!menuItem) throw new AppError("Menu item not found for this hotel.", { code: "MENU_ITEM_NOT_FOUND", statusCode: 404 });
      if (menuItem._count.order_item > 0) throw new AppError("Menu item cannot be deleted while order history references it.", { code: "MENU_ITEM_HAS_ORDERS", statusCode: 409 });
      const discountMapping = await transaction.discount_menu_item.findFirst({
        where: { menu_item_id: itemId },
        select: { discount_id: true },
      });
      if (discountMapping) throw new AppError("Menu item cannot be deleted while it is referenced by a discount.", { code: "MENU_ITEM_HAS_DISCOUNTS", statusCode: 409 });
      const { _count, ...deletedItem } = menuItem;
      const result = await transaction.menu_item.deleteMany({ where: { id: itemId, hotel_id: hotelId } });
      if (result.count !== 1) throw new AppError("Menu item not found for this hotel.", { code: "MENU_ITEM_NOT_FOUND", statusCode: 404 });
      return serializeMenuItem(deletedItem);
    });
  } catch (error) {
    if (error?.code === "P2003") throw new AppError("Menu item cannot be deleted while order history references it.", { code: "MENU_ITEM_HAS_ORDERS", statusCode: 409 });
    throw error;
  }
}
