import { AppError } from "../middleware/errorHandler.js";
import { createInventoryItem, deleteInventoryItem, getInventoryItems, updateInventoryItem } from "../services/inventoryService.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const EDITABLE_FIELDS = new Set(["name", "category", "quantity", "unit", "minimum_quantity", "supplier_id", "last_restocked"]);

function invalid(message, code = "INVALID_INVENTORY") {
  throw new AppError(message, { code, statusCode: 400 });
}

function validateUuid(value, fieldName, code) {
  if (!UUID_PATTERN.test(value || "")) invalid(`${fieldName} must be a valid UUID.`, code);
}

function validateNullableString(value, fieldName, maximumLength) {
  if (value !== null && typeof value !== "string") invalid(`${fieldName} must be a string or null.`);
  if (typeof value === "string" && value.length > maximumLength) invalid(`${fieldName} cannot exceed ${maximumLength} characters.`);
  return value === null ? null : value.trim();
}

function validateDecimal(value, fieldName) {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    invalid(`${fieldName} must be a non-negative decimal value with at most two decimal places.`);
  }
  return value;
}

function validateDate(value) {
  if (value === null) return value;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    invalid("last_restocked must be an ISO date (YYYY-MM-DD) or null.");
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    invalid("last_restocked must be an ISO date (YYYY-MM-DD) or null.");
  }
  return date;
}

function parseInput(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("Request body must be a JSON object.", "INVALID_REQUEST_BODY");
  const unsupported = Object.keys(body).filter((field) => !EDITABLE_FIELDS.has(field));
  if (unsupported.length) invalid(`Unsupported inventory fields: ${unsupported.join(", ")}.`, "UNSUPPORTED_INVENTORY_FIELDS");
  if (partial && Object.keys(body).length === 0) invalid("Provide at least one inventory field to update.", "EMPTY_INVENTORY_UPDATE");
  if (!partial && !Object.hasOwn(body, "name")) invalid("name is required.");

  const input = {};
  if (!partial || Object.hasOwn(body, "name")) {
    if (typeof body.name !== "string" || !body.name.trim()) invalid("name must be a non-empty string.");
    input.name = body.name.trim();
    if (input.name.length > 255) invalid("name cannot exceed 255 characters.");
  }
  for (const [field, maximumLength] of [["category", 100], ["unit", 50]]) {
    if (Object.hasOwn(body, field)) input[field] = validateNullableString(body[field], field, maximumLength);
  }
  for (const field of ["quantity", "minimum_quantity"]) {
    if (Object.hasOwn(body, field)) input[field] = validateDecimal(body[field], field);
  }
  if (Object.hasOwn(body, "supplier_id")) {
    if (body.supplier_id !== null) validateUuid(body.supplier_id, "supplier_id", "INVALID_SUPPLIER_ID");
    input.supplier_id = body.supplier_id;
  }
  if (Object.hasOwn(body, "last_restocked")) input.last_restocked = validateDate(body.last_restocked);
  return input;
}

export function validateInventoryHotelId(req, _res, next) {
  try { validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID"); next(); } catch (error) { next(error); }
}

export async function list(req, res, next) {
  try { res.status(200).json({ status: "success", data: { inventory: await getInventoryItems(req.params.hotelId) } }); } catch (error) { next(error); }
}

export async function create(req, res, next) {
  try {
    validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID");
    res.status(201).json({ status: "success", data: { inventory_item: await createInventoryItem(req.params.hotelId, parseInput(req.body)) } });
  } catch (error) { next(error); }
}

export async function patch(req, res, next) {
  try {
    validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID");
    validateUuid(req.params.inventoryId, "inventoryId", "INVALID_INVENTORY_ID");
    res.status(200).json({ status: "success", data: { inventory_item: await updateInventoryItem(req.params.hotelId, req.params.inventoryId, parseInput(req.body, { partial: true })) } });
  } catch (error) { next(error); }
}

export async function remove(req, res, next) {
  try {
    validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID");
    validateUuid(req.params.inventoryId, "inventoryId", "INVALID_INVENTORY_ID");
    res.status(200).json({ status: "success", data: { inventory_item: await deleteInventoryItem(req.params.hotelId, req.params.inventoryId) } });
  } catch (error) { next(error); }
}
