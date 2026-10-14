import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";

const menuCategoryFields = {
  id: true,
  name: true,
  description: true,
  display_order: true,
  is_active: true,
  created_at: true,
  updated_at: true,
};

async function requireHotel(hotelId) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { id: true } });
  if (!hotel) {
    throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
  }
}

async function ensureCategoryNameIsAvailable(hotelId, name, excludedCategoryId) {
  const duplicate = await prisma.menu_category.findFirst({
    where: {
      hotel_id: hotelId,
      name,
      ...(excludedCategoryId ? { NOT: { id: excludedCategoryId } } : {}),
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new AppError("A menu category with this name already exists for the hotel.", {
      code: "MENU_CATEGORY_NAME_CONFLICT",
      statusCode: 409,
    });
  }
}

function handleUniqueConstraint(error) {
  if (error?.code === "P2002") {
    throw new AppError("A menu category with this name already exists for the hotel.", {
      code: "MENU_CATEGORY_NAME_CONFLICT",
      statusCode: 409,
    });
  }
  throw error;
}

export async function getMenuCategoriesForHotel(hotelId) {
  const hotel = await prisma.hotel.findUnique({
    where: { id: hotelId },
    select: { id: true },
  });

  if (!hotel) {
    throw new AppError("Hotel not found.", {
      code: "HOTEL_NOT_FOUND",
      statusCode: 404,
    });
  }

  return prisma.menu_category.findMany({
    where: { hotel_id: hotelId },
    orderBy: [
      { display_order: "asc" },
      { name: "asc" },
    ],
    select: {
      id: true,
      name: true,
      description: true,
      display_order: true,
      is_active: true,
      created_at: true,
      updated_at: true,
    },
  });
}

export async function createMenuCategory(hotelId, input) {
  await requireHotel(hotelId);
  await ensureCategoryNameIsAvailable(hotelId, input.name);

  try {
    return await prisma.menu_category.create({
      data: {
        id: randomUUID(),
        hotel_id: hotelId,
        ...input,
      },
      select: menuCategoryFields,
    });
  } catch (error) {
    return handleUniqueConstraint(error);
  }
}

export async function updateMenuCategory(hotelId, categoryId, input) {
  await requireHotel(hotelId);
  const category = await prisma.menu_category.findFirst({
    where: { id: categoryId, hotel_id: hotelId },
    select: { id: true },
  });
  if (!category) {
    throw new AppError("Menu category not found for this hotel.", {
      code: "MENU_CATEGORY_NOT_FOUND",
      statusCode: 404,
    });
  }
  if (input.name !== undefined) {
    await ensureCategoryNameIsAvailable(hotelId, input.name, categoryId);
  }

  try {
    const result = await prisma.menu_category.updateMany({
      where: { id: categoryId, hotel_id: hotelId },
      data: input,
    });
    if (result.count !== 1) {
      throw new AppError("Menu category not found for this hotel.", {
        code: "MENU_CATEGORY_NOT_FOUND",
        statusCode: 404,
      });
    }
    return prisma.menu_category.findFirst({
      where: { id: categoryId, hotel_id: hotelId },
      select: menuCategoryFields,
    });
  } catch (error) {
    return handleUniqueConstraint(error);
  }
}

export async function deleteMenuCategory(hotelId, categoryId) {
  await requireHotel(hotelId);

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT id
      FROM menu_category
      WHERE id = ${categoryId}::uuid
        AND hotel_id = ${hotelId}::uuid
      FOR UPDATE
    `;

    const category = await transaction.menu_category.findFirst({
      where: { id: categoryId, hotel_id: hotelId },
      select: menuCategoryFields,
    });
    if (!category) {
      throw new AppError("Menu category not found for this hotel.", {
        code: "MENU_CATEGORY_NOT_FOUND",
        statusCode: 404,
      });
    }

    const discountMapping = await transaction.discount_menu_category.findFirst({
      where: { category_id: categoryId },
      select: { discount_id: true },
    });
    if (discountMapping) {
      throw new AppError("Menu category cannot be deleted while it is referenced by a discount.", {
        code: "MENU_CATEGORY_HAS_DISCOUNTS",
        statusCode: 409,
      });
    }

    const result = await transaction.menu_category.deleteMany({
      where: { id: categoryId, hotel_id: hotelId },
    });
    if (result.count !== 1) {
      throw new AppError("Menu category not found for this hotel.", {
        code: "MENU_CATEGORY_NOT_FOUND",
        statusCode: 404,
      });
    }
    return category;
  });
}
