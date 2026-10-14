import { AppError } from "../middleware/errorHandler.js";
import {
  createDiningTable,
  deleteDiningTable,
  updateDiningTable,
} from "../services/diningTableService.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDITABLE_FIELDS = new Set(["dining_area_id", "table_number", "capacity", "status"]);

function validateUuid(value, fieldName, code) {
  if (!UUID_PATTERN.test(value)) {
    throw new AppError(`${fieldName} must be a valid UUID.`, {
      code,
      statusCode: 400,
    });
  }
}

function validateDiningTableInput(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("Request body must be a JSON object.", {
      code: "INVALID_REQUEST_BODY",
      statusCode: 400,
    });
  }

  const unknownFields = Object.keys(body).filter((field) => !EDITABLE_FIELDS.has(field));
  if (unknownFields.length) {
    throw new AppError(`Unsupported dining table fields: ${unknownFields.join(", ")}.`, {
      code: "INVALID_DINING_TABLE_FIELDS",
      statusCode: 400,
    });
  }

  if (partial && Object.keys(body).length === 0) {
    throw new AppError("Provide at least one dining table field to update.", {
      code: "EMPTY_DINING_TABLE_UPDATE",
      statusCode: 400,
    });
  }

  const requiredFields = ["dining_area_id", "table_number", "capacity", "status"];
  if (!partial) {
    const missingFields = requiredFields.filter((field) => !Object.hasOwn(body, field));
    if (missingFields.length) {
      throw new AppError(`Missing required dining table fields: ${missingFields.join(", ")}.`, {
        code: "INVALID_DINING_TABLE",
        statusCode: 400,
      });
    }
  }

  const input = {};

  if (!partial || Object.hasOwn(body, "dining_area_id")) {
    if (typeof body.dining_area_id !== "string") {
      throw new AppError("dining_area_id must be a valid UUID.", {
        code: "INVALID_DINING_AREA_ID",
        statusCode: 400,
      });
    }
    validateUuid(body.dining_area_id, "dining_area_id", "INVALID_DINING_AREA_ID");
    input.dining_area_id = body.dining_area_id;
  }

  if (!partial || Object.hasOwn(body, "table_number")) {
    if (typeof body.table_number !== "string" || !body.table_number.trim()) {
      throw new AppError("table_number must be a non-empty string.", {
        code: "INVALID_DINING_TABLE",
        statusCode: 400,
      });
    }
    const tableNumber = body.table_number.trim();
    if (tableNumber.length > 50) {
      throw new AppError("table_number cannot exceed 50 characters.", {
        code: "INVALID_DINING_TABLE",
        statusCode: 400,
      });
    }
    input.table_number = tableNumber;
  }

  if (!partial || Object.hasOwn(body, "capacity")) {
    if (!Number.isInteger(body.capacity) || body.capacity <= 0 || body.capacity > 2147483647) {
      throw new AppError("capacity must be a positive integer no greater than 2147483647.", {
        code: "INVALID_DINING_TABLE_CAPACITY",
        statusCode: 400,
      });
    }
    input.capacity = body.capacity;
  }

  if (!partial || Object.hasOwn(body, "status")) {
    if (typeof body.status !== "string" || !body.status.trim()) {
      throw new AppError("status must be a non-empty string.", {
        code: "INVALID_DINING_TABLE_STATUS",
        statusCode: 400,
      });
    }
    if (body.status.length > 30) {
      throw new AppError("status cannot exceed 30 characters.", {
        code: "INVALID_DINING_TABLE_STATUS",
        statusCode: 400,
      });
    }
    input.status = body.status;
  }

  return input;
}

function validateDiningTableStatusInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("Request body must be a JSON object.", {
      code: "INVALID_REQUEST_BODY",
      statusCode: 400,
    });
  }

  const fields = Object.keys(body);
  if (fields.some((field) => field !== "status")) {
    throw new AppError("Only status can be updated through this endpoint.", {
      code: "INVALID_DINING_TABLE_STATUS_FIELDS",
      statusCode: 400,
    });
  }

  if (!Object.hasOwn(body, "status")) {
    throw new AppError("status is required.", {
      code: "INVALID_DINING_TABLE_STATUS",
      statusCode: 400,
    });
  }

  if (typeof body.status !== "string" || !body.status.trim()) {
    throw new AppError("status must be a non-empty string.", {
      code: "INVALID_DINING_TABLE_STATUS",
      statusCode: 400,
    });
  }

  if (body.status.length > 30) {
    throw new AppError("status cannot exceed 30 characters.", {
      code: "INVALID_DINING_TABLE_STATUS",
      statusCode: 400,
    });
  }

  return body.status;
}

export async function createHotelDiningTable(req, res) {
  const { hotelId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");

  const diningTable = await createDiningTable(
    hotelId,
    validateDiningTableInput(req.body),
  );

  return res.status(201).json({
    status: "success",
    data: {
      dining_table: diningTable,
    },
  });
}

export async function patchHotelDiningTable(req, res) {
  const { hotelId, tableId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");
  validateUuid(tableId, "tableId", "INVALID_TABLE_ID");

  const diningTable = await updateDiningTable(
    hotelId,
    tableId,
    validateDiningTableInput(req.body, { partial: true }),
  );

  return res.status(200).json({
    status: "success",
    data: {
      dining_table: diningTable,
    },
  });
}

export async function patchHotelDiningTableStatus(req, res) {
  const { hotelId, tableId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");
  validateUuid(tableId, "tableId", "INVALID_TABLE_ID");

  const diningTable = await updateDiningTable(hotelId, tableId, {
    status: validateDiningTableStatusInput(req.body),
  });

  return res.status(200).json({
    status: "success",
    data: {
      dining_table: diningTable,
    },
  });
}

export async function deleteHotelDiningTable(req, res) {
  const { hotelId, tableId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");
  validateUuid(tableId, "tableId", "INVALID_TABLE_ID");

  const diningTable = await deleteDiningTable(hotelId, tableId);

  return res.status(200).json({
    status: "success",
    data: {
      dining_table: diningTable,
    },
  });
}
