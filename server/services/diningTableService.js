import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";

const diningTableFields = {
  id: true,
  hotel_id: true,
  dining_area_id: true,
  table_number: true,
  capacity: true,
  status: true,
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

async function requireDiningArea(hotelId, diningAreaId) {
  const area = await prisma.dining_area.findFirst({
    where: {
      id: diningAreaId,
      hotel_id: hotelId,
    },
    select: { id: true },
  });

  if (!area) {
    throw new AppError("Dining area not found for this hotel.", {
      code: "DINING_AREA_NOT_FOUND",
      statusCode: 404,
    });
  }
}

async function ensureTableNumberIsAvailable(hotelId, diningAreaId, tableNumber, excludedTableId) {
  const duplicate = await prisma.dining_table.findFirst({
    where: {
      hotel_id: hotelId,
      dining_area_id: diningAreaId,
      table_number: tableNumber,
      ...(excludedTableId ? { NOT: { id: excludedTableId } } : {}),
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new AppError("A dining table with this number already exists in this dining area.", {
      code: "DINING_TABLE_NUMBER_CONFLICT",
      statusCode: 409,
    });
  }
}

function handleUniqueConstraint(error) {
  if (error?.code === "P2002") {
    throw new AppError("A dining table with this number already exists in this dining area.", {
      code: "DINING_TABLE_NUMBER_CONFLICT",
      statusCode: 409,
    });
  }

  throw error;
}

export async function createDiningTable(hotelId, input) {
  await requireHotel(hotelId);
  await requireDiningArea(hotelId, input.dining_area_id);
  await ensureTableNumberIsAvailable(hotelId, input.dining_area_id, input.table_number);

  try {
    return await prisma.dining_table.create({
      data: {
        id: randomUUID(),
        hotel_id: hotelId,
        dining_area_id: input.dining_area_id,
        table_number: input.table_number,
        capacity: input.capacity,
        status: input.status,
      },
      select: diningTableFields,
    });
  } catch (error) {
    return handleUniqueConstraint(error);
  }
}

export async function updateDiningTable(hotelId, tableId, input) {
  await requireHotel(hotelId);

  const existingTable = await prisma.dining_table.findFirst({
    where: {
      id: tableId,
      hotel_id: hotelId,
    },
    select: { id: true, dining_area_id: true, table_number: true },
  });

  if (!existingTable) {
    throw new AppError("Dining table not found for this hotel.", {
      code: "DINING_TABLE_NOT_FOUND",
      statusCode: 404,
    });
  }

  if (input.dining_area_id !== undefined) {
    await requireDiningArea(hotelId, input.dining_area_id);
  }

  if (input.dining_area_id !== undefined || input.table_number !== undefined) {
    const effectiveDiningAreaId = input.dining_area_id ?? existingTable.dining_area_id;
    const effectiveTableNumber = input.table_number ?? existingTable.table_number;
    await ensureTableNumberIsAvailable(hotelId, effectiveDiningAreaId, effectiveTableNumber, tableId);
  }

  try {
    const result = await prisma.dining_table.updateMany({
      where: {
        id: tableId,
        hotel_id: hotelId,
      },
      data: input,
    });

    if (result.count !== 1) {
      throw new AppError("Dining table not found for this hotel.", {
        code: "DINING_TABLE_NOT_FOUND",
        statusCode: 404,
      });
    }

    return await prisma.dining_table.findFirst({
      where: {
        id: tableId,
        hotel_id: hotelId,
      },
      select: diningTableFields,
    });
  } catch (error) {
    return handleUniqueConstraint(error);
  }
}

export async function deleteDiningTable(hotelId, tableId) {
  await requireHotel(hotelId);

  try {
    return await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT id
        FROM dining_table
        WHERE id = ${tableId}::uuid
          AND hotel_id = ${hotelId}::uuid
        FOR UPDATE
      `;

      const table = await transaction.dining_table.findFirst({
        where: {
          id: tableId,
          hotel_id: hotelId,
        },
        select: {
          ...diningTableFields,
          _count: {
            select: { orders: true },
          },
          qr_code: {
            select: { id: true },
          },
        },
      });

      if (!table) {
        throw new AppError("Dining table not found for this hotel.", {
          code: "DINING_TABLE_NOT_FOUND",
          statusCode: 404,
        });
      }

      const dependencies = [];
      if (table._count.orders > 0) dependencies.push("orders");
      if (table.qr_code) dependencies.push("a QR code");

      if (dependencies.length) {
        throw new AppError(`Dining table cannot be deleted while it has ${dependencies.join(" and ")}.`, {
          code: "DINING_TABLE_HAS_DEPENDENCIES",
          statusCode: 409,
        });
      }

      const result = await transaction.dining_table.deleteMany({
        where: {
          id: tableId,
          hotel_id: hotelId,
        },
      });

      if (result.count !== 1) {
        throw new AppError("Dining table not found for this hotel.", {
          code: "DINING_TABLE_NOT_FOUND",
          statusCode: 404,
        });
      }

      const { _count, qr_code, ...deletedTable } = table;
      return deletedTable;
    });
  } catch (error) {
    if (error?.code === "P2003") {
      throw new AppError("Dining table cannot be deleted while dependent records exist.", {
        code: "DINING_TABLE_HAS_DEPENDENCIES",
        statusCode: 409,
      });
    }

    throw error;
  }
}
