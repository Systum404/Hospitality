import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";

const diningAreaFields = {
  id: true,
  name: true,
  status: true,
  total_tables: true,
  created_at: true,
  updated_at: true,
};

async function requireHotel(hotelId) {
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
}

async function ensureAreaNameIsAvailable(hotelId, name, excludedAreaId) {
  const duplicate = await prisma.dining_area.findFirst({
    where: {
      hotel_id: hotelId,
      name,
      ...(excludedAreaId ? { NOT: { id: excludedAreaId } } : {}),
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new AppError("A dining area with this name already exists for the hotel.", {
      code: "DINING_AREA_NAME_CONFLICT",
      statusCode: 409,
    });
  }
}

function handleUniqueConstraint(error) {
  if (error?.code === "P2002") {
    throw new AppError("A dining area with this name already exists for the hotel.", {
      code: "DINING_AREA_NAME_CONFLICT",
      statusCode: 409,
    });
  }

  throw error;
}

export async function getDiningAreasForHotel(hotelId) {
  const hotel = await prisma.hotel.findUnique({
    where: { id: hotelId },
    select: {
      id: true,
      dining_area: {
        where: { hotel_id: hotelId },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          status: true,
          total_tables: true,
          created_at: true,
          updated_at: true,
          dining_table: {
            where: { hotel_id: hotelId },
            orderBy: { table_number: "asc" },
            select: {
              id: true,
              table_number: true,
              capacity: true,
              status: true,
              created_at: true,
              updated_at: true,
            },
          },
        },
      },
    },
  });

  if (!hotel) {
    throw new AppError("Hotel not found.", {
      code: "HOTEL_NOT_FOUND",
      statusCode: 404,
    });
  }

  return hotel.dining_area.map(({ dining_table, ...area }) => ({
    ...area,
    total_tables: dining_table.length,
    tables: dining_table,
  }));
}

export async function createDiningArea(hotelId, input) {
  await requireHotel(hotelId);
  await ensureAreaNameIsAvailable(hotelId, input.name);

  try {
    return await prisma.dining_area.create({
      data: {
        id: randomUUID(),
        hotel_id: hotelId,
        name: input.name,
        status: input.status,
      },
      select: diningAreaFields,
    });
  } catch (error) {
    return handleUniqueConstraint(error);
  }
}

export async function updateDiningArea(hotelId, areaId, input) {
  await requireHotel(hotelId);

  const existingArea = await prisma.dining_area.findFirst({
    where: {
      id: areaId,
      hotel_id: hotelId,
    },
    select: { id: true },
  });

  if (!existingArea) {
    throw new AppError("Dining area not found for this hotel.", {
      code: "DINING_AREA_NOT_FOUND",
      statusCode: 404,
    });
  }

  if (input.name !== undefined) {
    await ensureAreaNameIsAvailable(hotelId, input.name, areaId);
  }

  try {
    const result = await prisma.dining_area.updateMany({
      where: {
        id: areaId,
        hotel_id: hotelId,
      },
      data: input,
    });

    if (result.count !== 1) {
      throw new AppError("Dining area not found for this hotel.", {
        code: "DINING_AREA_NOT_FOUND",
        statusCode: 404,
      });
    }

    return await prisma.dining_area.findFirst({
      where: {
        id: areaId,
        hotel_id: hotelId,
      },
      select: diningAreaFields,
    });
  } catch (error) {
    return handleUniqueConstraint(error);
  }
}

export async function deleteDiningArea(hotelId, areaId) {
  await requireHotel(hotelId);

  try {
    return await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT id
        FROM dining_area
        WHERE id = ${areaId}::uuid
          AND hotel_id = ${hotelId}::uuid
        FOR UPDATE
      `;

      const area = await transaction.dining_area.findFirst({
        where: {
          id: areaId,
          hotel_id: hotelId,
        },
        select: {
          ...diningAreaFields,
          dining_table: {
            where: { hotel_id: hotelId },
            select: {
              _count: {
                select: { orders: true },
              },
            },
          },
        },
      });

      if (!area) {
        throw new AppError("Dining area not found for this hotel.", {
          code: "DINING_AREA_NOT_FOUND",
          statusCode: 404,
        });
      }

      if (area.dining_table.some((table) => table._count.orders > 0)) {
        throw new AppError("Dining area cannot be deleted while one or more tables have orders.", {
          code: "DINING_AREA_HAS_ORDERS",
          statusCode: 409,
        });
      }

      if (area.dining_table.length > 0) {
        throw new AppError("Dining area cannot be deleted while it contains dining tables.", {
          code: "DINING_AREA_HAS_TABLES",
          statusCode: 409,
        });
      }

      const result = await transaction.dining_area.deleteMany({
        where: {
          id: areaId,
          hotel_id: hotelId,
        },
      });

      if (result.count !== 1) {
        throw new AppError("Dining area not found for this hotel.", {
          code: "DINING_AREA_NOT_FOUND",
          statusCode: 404,
        });
      }

      const { dining_table, ...deletedArea } = area;
      return deletedArea;
    });
  } catch (error) {
    if (error?.code === "P2003") {
      throw new AppError("Dining area cannot be deleted while one or more tables have orders.", {
        code: "DINING_AREA_HAS_ORDERS",
        statusCode: 409,
      });
    }

    throw error;
  }
}
