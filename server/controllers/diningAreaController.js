import { AppError } from "../middleware/errorHandler.js";
import {
  createDiningArea,
  deleteDiningArea,
  getDiningAreasForHotel,
  updateDiningArea,
} from "../services/diningAreaService.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDITABLE_FIELDS = new Set(["name", "status"]);

function validateUuid(value, fieldName, code) {
  if (!UUID_PATTERN.test(value)) {
    throw new AppError(`${fieldName} must be a valid UUID.`, {
      code,
      statusCode: 400,
    });
  }
}

function validateAreaInput(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("Request body must be a JSON object.", {
      code: "INVALID_REQUEST_BODY",
      statusCode: 400,
    });
  }

  const unknownFields = Object.keys(body).filter((field) => !EDITABLE_FIELDS.has(field));
  if (unknownFields.length) {
    throw new AppError(`Unsupported dining area fields: ${unknownFields.join(", ")}.`, {
      code: "INVALID_DINING_AREA_FIELDS",
      statusCode: 400,
    });
  }

  if (partial && Object.keys(body).length === 0) {
    throw new AppError("Provide at least one dining area field to update.", {
      code: "EMPTY_DINING_AREA_UPDATE",
      statusCode: 400,
    });
  }

  const input = {};
  for (const field of EDITABLE_FIELDS) {
    if (!partial || Object.hasOwn(body, field)) {
      if (typeof body[field] !== "string" || !body[field].trim()) {
        throw new AppError(`${field} must be a non-empty string.`, {
          code: "INVALID_DINING_AREA",
          statusCode: 400,
        });
      }

      input[field] = body[field].trim();
    }
  }

  if (input.name?.length > 50) {
    throw new AppError("name cannot exceed 50 characters.", {
      code: "INVALID_DINING_AREA",
      statusCode: 400,
    });
  }

  if (input.status?.length > 30) {
    throw new AppError("status cannot exceed 30 characters.", {
      code: "INVALID_DINING_AREA",
      statusCode: 400,
    });
  }

  return input;
}

function validateAreaStatusInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("Request body must be a JSON object.", {
      code: "INVALID_REQUEST_BODY",
      statusCode: 400,
    });
  }

  const fields = Object.keys(body);
  if (fields.some((field) => field !== "status")) {
    throw new AppError("Only status can be updated through this endpoint.", {
      code: "INVALID_DINING_AREA_STATUS_FIELDS",
      statusCode: 400,
    });
  }

  if (!Object.hasOwn(body, "status")) {
    throw new AppError("status is required.", {
      code: "INVALID_DINING_AREA_STATUS",
      statusCode: 400,
    });
  }

  if (typeof body.status !== "string" || !body.status.trim()) {
    throw new AppError("status must be a non-empty string.", {
      code: "INVALID_DINING_AREA_STATUS",
      statusCode: 400,
    });
  }

  if (body.status.length > 30) {
    throw new AppError("status cannot exceed 30 characters.", {
      code: "INVALID_DINING_AREA_STATUS",
      statusCode: 400,
    });
  }

  return body.status;
}

export async function getHotelDiningAreas(req, res) {
  const { hotelId } = req.params;

  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");

  const diningAreas = await getDiningAreasForHotel(hotelId);

  return res.status(200).json({
    status: "success",
    data: {
      dining_areas: diningAreas,
    },
  });
}

export async function createHotelDiningArea(req, res) {
  const { hotelId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");

  const diningArea = await createDiningArea(hotelId, validateAreaInput(req.body));

  return res.status(201).json({
    status: "success",
    data: {
      dining_area: diningArea,
    },
  });
}

export async function patchHotelDiningArea(req, res) {
  const { areaId, hotelId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");
  validateUuid(areaId, "areaId", "INVALID_AREA_ID");

  const diningArea = await updateDiningArea(
    hotelId,
    areaId,
    validateAreaInput(req.body, { partial: true }),
  );

  return res.status(200).json({
    status: "success",
    data: {
      dining_area: diningArea,
    },
  });
}

export async function patchHotelDiningAreaStatus(req, res) {
  const { areaId, hotelId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");
  validateUuid(areaId, "areaId", "INVALID_AREA_ID");

  const diningArea = await updateDiningArea(hotelId, areaId, {
    status: validateAreaStatusInput(req.body),
  });

  return res.status(200).json({
    status: "success",
    data: {
      dining_area: diningArea,
    },
  });
}

export async function deleteHotelDiningArea(req, res) {
  const { areaId, hotelId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");
  validateUuid(areaId, "areaId", "INVALID_AREA_ID");

  const diningArea = await deleteDiningArea(hotelId, areaId);

  return res.status(200).json({
    status: "success",
    data: {
      dining_area: diningArea,
    },
  });
}
