import { AppError } from "../middleware/errorHandler.js";
import {
  createMenuCategory,
  deleteMenuCategory,
  getMenuCategoriesForHotel,
  updateMenuCategory,
} from "../services/menuCategoryService.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDITABLE_FIELDS = new Set(["name", "description", "display_order", "is_active"]);

function validateUuid(value, fieldName, code) {
  if (!UUID_PATTERN.test(value)) {
    throw new AppError(`${fieldName} must be a valid UUID.`, {
      code,
      statusCode: 400,
    });
  }
}

function validateMenuCategoryInput(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("Request body must be a JSON object.", {
      code: "INVALID_REQUEST_BODY",
      statusCode: 400,
    });
  }

  const unsupported = Object.keys(body).filter((field) => !EDITABLE_FIELDS.has(field));
  if (unsupported.length) {
    throw new AppError(`Unsupported menu category fields: ${unsupported.join(", ")}.`, {
      code: "INVALID_MENU_CATEGORY_FIELDS",
      statusCode: 400,
    });
  }

  if (partial && Object.keys(body).length === 0) {
    throw new AppError("Provide at least one menu category field to update.", {
      code: "EMPTY_MENU_CATEGORY_UPDATE",
      statusCode: 400,
    });
  }

  if (!partial && !Object.hasOwn(body, "name")) {
    throw new AppError("name is required.", {
      code: "INVALID_MENU_CATEGORY",
      statusCode: 400,
    });
  }

  const input = {};

  if (!partial || Object.hasOwn(body, "name")) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      throw new AppError("name must be a non-empty string.", {
        code: "INVALID_MENU_CATEGORY",
        statusCode: 400,
      });
    }
    const name = body.name.trim();
    if (name.length > 255) {
      throw new AppError("name cannot exceed 255 characters.", {
        code: "INVALID_MENU_CATEGORY",
        statusCode: 400,
      });
    }
    input.name = name;
  }

  if (Object.hasOwn(body, "description")) {
    if (body.description !== null && typeof body.description !== "string") {
      throw new AppError("description must be a string or null.", {
        code: "INVALID_MENU_CATEGORY",
        statusCode: 400,
      });
    }
    input.description = body.description;
  }

  if (Object.hasOwn(body, "display_order")) {
    if (!Number.isInteger(body.display_order) || body.display_order < -2147483648 || body.display_order > 2147483647) {
      throw new AppError("display_order must be an integer between -2147483648 and 2147483647.", {
        code: "INVALID_MENU_CATEGORY",
        statusCode: 400,
      });
    }
    input.display_order = body.display_order;
  }

  if (Object.hasOwn(body, "is_active")) {
    if (typeof body.is_active !== "boolean") {
      throw new AppError("is_active must be a boolean.", {
        code: "INVALID_MENU_CATEGORY",
        statusCode: 400,
      });
    }
    input.is_active = body.is_active;
  }

  return input;
}

function validateMenuCategoryStatus(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("Request body must be a JSON object.", {
      code: "INVALID_REQUEST_BODY",
      statusCode: 400,
    });
  }

  const fields = Object.keys(body);
  if (fields.some((field) => field !== "is_active")) {
    throw new AppError("Only is_active can be updated through this endpoint.", {
      code: "INVALID_MENU_CATEGORY_STATUS_FIELDS",
      statusCode: 400,
    });
  }

  if (!Object.hasOwn(body, "is_active") || typeof body.is_active !== "boolean") {
    throw new AppError("is_active must be provided as a boolean.", {
      code: "INVALID_MENU_CATEGORY_STATUS",
      statusCode: 400,
    });
  }

  return body.is_active;
}

export async function getHotelMenuCategories(req, res) {
  const { hotelId } = req.params;

  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");

  const menuCategories = await getMenuCategoriesForHotel(hotelId);

  return res.status(200).json({
    status: "success",
    data: {
      menu_categories: menuCategories,
    },
  });
}

export async function createHotelMenuCategory(req, res) {
  const { hotelId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");

  const menuCategory = await createMenuCategory(hotelId, validateMenuCategoryInput(req.body));
  return res.status(201).json({ status: "success", data: { menu_category: menuCategory } });
}

export async function patchHotelMenuCategory(req, res) {
  const { categoryId, hotelId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");
  validateUuid(categoryId, "categoryId", "INVALID_MENU_CATEGORY_ID");

  const menuCategory = await updateMenuCategory(
    hotelId,
    categoryId,
    validateMenuCategoryInput(req.body, { partial: true }),
  );
  return res.status(200).json({ status: "success", data: { menu_category: menuCategory } });
}

export async function patchHotelMenuCategoryStatus(req, res) {
  const { categoryId, hotelId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");
  validateUuid(categoryId, "categoryId", "INVALID_MENU_CATEGORY_ID");

  const menuCategory = await updateMenuCategory(hotelId, categoryId, {
    is_active: validateMenuCategoryStatus(req.body),
  });
  return res.status(200).json({ status: "success", data: { menu_category: menuCategory } });
}

export async function deleteHotelMenuCategory(req, res) {
  const { categoryId, hotelId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");
  validateUuid(categoryId, "categoryId", "INVALID_MENU_CATEGORY_ID");

  const menuCategory = await deleteMenuCategory(hotelId, categoryId);
  return res.status(200).json({ status: "success", data: { menu_category: menuCategory } });
}
