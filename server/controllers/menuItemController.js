import { AppError } from "../middleware/errorHandler.js";
import { createMenuItem, deleteMenuItem, getMenuItemsForHotel, updateMenuItem } from "../services/menuItemService.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDITABLE_FIELDS = new Set(["name", "description", "price", "category_id", "image_url", "is_available", "is_veg", "preparation_time"]);
const DECIMAL_10_2_PATTERN = /^\+?\d{1,8}(?:\.\d{1,2})?$/;

function validateUuid(value, fieldName, code) {
  if (!UUID_PATTERN.test(value)) throw new AppError(`${fieldName} must be a valid UUID.`, { code, statusCode: 400 });
}

function invalid(message) {
  throw new AppError(message, { code: "INVALID_MENU_ITEM", statusCode: 400 });
}

function validateNullableString(value, fieldName, maximumLength) {
  if (value !== null && typeof value !== "string") invalid(`${fieldName} must be a string or null.`);
  if (typeof value === "string" && maximumLength && value.length > maximumLength) invalid(`${fieldName} cannot exceed ${maximumLength} characters.`);
  return value;
}

function validatePrice(value) {
  if ((typeof value !== "string" && typeof value !== "number") || value === "") invalid("price must be a valid decimal value.");
  const decimal = typeof value === "string" ? value.trim() : String(value);
  if (!DECIMAL_10_2_PATTERN.test(decimal)) invalid("price must fit the database Decimal(10,2) format.");
  return decimal;
}

function validateMenuItemInput(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("Request body must be a JSON object.", { code: "INVALID_REQUEST_BODY", statusCode: 400 });
  }
  const unsupported = Object.keys(body).filter((field) => !EDITABLE_FIELDS.has(field));
  if (unsupported.length) throw new AppError(`Unsupported menu item fields: ${unsupported.join(", ")}.`, { code: "INVALID_MENU_ITEM_FIELDS", statusCode: 400 });
  if (partial && Object.keys(body).length === 0) throw new AppError("Provide at least one menu item field to update.", { code: "EMPTY_MENU_ITEM_UPDATE", statusCode: 400 });
  if (!partial) {
    for (const field of ["name", "price"]) if (!Object.hasOwn(body, field)) invalid(`${field} is required.`);
  }

  const input = {};
  if (!partial || Object.hasOwn(body, "name")) {
    if (typeof body.name !== "string" || !body.name.trim()) invalid("name must be a non-empty string.");
    input.name = body.name.trim();
    if (input.name.length > 255) invalid("name cannot exceed 255 characters.");
  }
  if (Object.hasOwn(body, "description")) input.description = validateNullableString(body.description, "description");
  if (!partial || Object.hasOwn(body, "price")) input.price = validatePrice(body.price);
  if (Object.hasOwn(body, "category_id")) {
    if (body.category_id !== null) {
      if (typeof body.category_id !== "string") invalid("category_id must be a UUID or null.");
      validateUuid(body.category_id, "category_id", "INVALID_MENU_CATEGORY_ID");
    }
    input.category_id = body.category_id;
  }
  if (Object.hasOwn(body, "image_url")) input.image_url = validateNullableString(body.image_url, "image_url", 500);
  for (const field of ["is_available", "is_veg"]) {
    if (Object.hasOwn(body, field)) {
      if (typeof body[field] !== "boolean") invalid(`${field} must be a boolean.`);
      input[field] = body[field];
    }
  }
  if (Object.hasOwn(body, "preparation_time")) {
    const value = body.preparation_time;
    if (value !== null && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)) invalid("preparation_time must be a database-compatible integer or null.");
    input.preparation_time = value;
  }
  return input;
}

function validateAvailability(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError("Request body must be a JSON object.", { code: "INVALID_REQUEST_BODY", statusCode: 400 });
  if (Object.keys(body).some((field) => field !== "is_available")) throw new AppError("Only is_available can be updated through this endpoint.", { code: "INVALID_MENU_ITEM_STATUS_FIELDS", statusCode: 400 });
  if (!Object.hasOwn(body, "is_available") || typeof body.is_available !== "boolean") throw new AppError("is_available must be provided as a boolean.", { code: "INVALID_MENU_ITEM_STATUS", statusCode: 400 });
  return body.is_available;
}

export async function getHotelMenuItems(req, res) {
  validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID");
  const menuItems = await getMenuItemsForHotel(req.params.hotelId);
  return res.status(200).json({ status: "success", data: { menu_items: menuItems } });
}

export async function createHotelMenuItem(req, res) {
  validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID");
  const menuItem = await createMenuItem(req.params.hotelId, validateMenuItemInput(req.body));
  return res.status(201).json({ status: "success", data: { menu_item: menuItem } });
}

export async function patchHotelMenuItem(req, res) {
  const { hotelId, itemId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");
  validateUuid(itemId, "itemId", "INVALID_MENU_ITEM_ID");
  const menuItem = await updateMenuItem(hotelId, itemId, validateMenuItemInput(req.body, { partial: true }));
  return res.status(200).json({ status: "success", data: { menu_item: menuItem } });
}

export async function patchHotelMenuItemStatus(req, res) {
  const { hotelId, itemId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");
  validateUuid(itemId, "itemId", "INVALID_MENU_ITEM_ID");
  const menuItem = await updateMenuItem(hotelId, itemId, { is_available: validateAvailability(req.body) });
  return res.status(200).json({ status: "success", data: { menu_item: menuItem } });
}

export async function deleteHotelMenuItem(req, res) {
  const { hotelId, itemId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");
  validateUuid(itemId, "itemId", "INVALID_MENU_ITEM_ID");
  const menuItem = await deleteMenuItem(hotelId, itemId);
  return res.status(200).json({ status: "success", data: { menu_item: menuItem } });
}
