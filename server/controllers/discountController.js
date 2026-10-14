import { AppError } from "../middleware/errorHandler.js";
import {
  createDiscountForHotel,
  deleteDiscountForHotel,
  getDiscountsForHotel,
  updateDiscountForHotel,
} from "../services/discountService.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREATE_FIELDS = new Set(["name", "description", "discount_type", "discount_value", "min_order_amount", "max_discount_amount", "applicable_on", "category_ids", "menu_item_ids", "start_date", "end_date", "is_active"]);
const EDITABLE_FIELDS = new Set(CREATE_FIELDS);
const APPLICABILITY = new Set(["all", "categories", "specific_items"]);

function fail(message, code = "INVALID_DISCOUNT_INPUT") {
  throw new AppError(message, { code, statusCode: 400 });
}

function validateUuid(value, label) {
  if (!UUID_PATTERN.test(value || "")) fail(`Invalid ${label}.`, "INVALID_UUID");
}

function validateDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    fail(`${label} must be a valid date.`, "INVALID_DATE");
  }
  return new Date(`${value}T00:00:00.000Z`);
}

function validateDecimal(value, label, { allowZero = false, maximum = null } = {}) {
  if (typeof value !== "string" || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) fail(`${label} must be a decimal string with up to 2 decimal places.`, "INVALID_DECIMAL");
  const [whole, fraction = ""] = value.split(".");
  if ((!allowZero && /^0+(?:\.0+)?$/.test(value)) || (allowZero && Number(whole) === 0 && /^0*$/.test(fraction) === false && false)) fail(`${label} must be ${allowZero ? "zero or greater" : "greater than zero"}.`, "INVALID_DECIMAL");
  if (maximum !== null && (Number(whole) > maximum || (Number(whole) === maximum && /[1-9]/.test(fraction)))) fail(`${label} cannot exceed ${maximum}.`, "INVALID_DECIMAL");
  return value;
}

function normaliseType(value) {
  if (value === "fixed") return "fixed_amount";
  if (value === "percentage" || value === "fixed_amount") return value;
  fail("Discount type must be percentage or fixed_amount.", "INVALID_DISCOUNT_TYPE");
}

function validateName(value) {
  if (typeof value !== "string" || !value.trim()) fail("Discount name is required.");
  if (value.trim().length > 255) fail("Discount name must be at most 255 characters.");
  return value.trim();
}

function validateIdList(value, label) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must contain at least one UUID.`, "INVALID_APPLICABILITY");
  const ids = [...new Set(value)];
  if (ids.length !== value.length || ids.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) fail(`${label} must contain unique UUIDs.`, "INVALID_APPLICABILITY");
  return ids;
}

function validateMappings(body, { required = false } = {}) {
  const hasMode = Object.hasOwn(body, "applicable_on");
  const hasCategories = Object.hasOwn(body, "category_ids");
  const hasItems = Object.hasOwn(body, "menu_item_ids");
  if (!required && !hasMode && !hasCategories && !hasItems) return undefined;
  if (!hasMode || !APPLICABILITY.has(body.applicable_on)) fail("Applicable on must be all, categories, or specific_items.", "INVALID_APPLICABILITY");
  const empty = (value) => value === undefined || (Array.isArray(value) && value.length === 0);
  if (body.applicable_on === "all") {
    if (!empty(body.category_ids) || !empty(body.menu_item_ids)) fail("All-item discounts cannot include category or item mappings.", "INVALID_APPLICABILITY");
    return { applicable_on: "all", category_ids: [], menu_item_ids: [] };
  }
  if (body.applicable_on === "categories") {
    if (!empty(body.menu_item_ids)) fail("Category discounts cannot include menu-item mappings.", "INVALID_APPLICABILITY");
    return { applicable_on: "categories", category_ids: validateIdList(body.category_ids, "Category IDs"), menu_item_ids: [] };
  }
  if (!empty(body.category_ids)) fail("Item discounts cannot include category mappings.", "INVALID_APPLICABILITY");
  return { applicable_on: "specific_items", category_ids: [], menu_item_ids: validateIdList(body.menu_item_ids, "Menu item IDs") };
}

function validateScalarFields(body, { partial = false } = {}) {
  const data = {};
  if (!partial || Object.hasOwn(body, "name")) data.name = validateName(body.name);
  if (!partial || Object.hasOwn(body, "discount_type")) data.discount_type = normaliseType(body.discount_type);
  if (!partial || Object.hasOwn(body, "discount_value")) data.discount_value = validateDecimal(body.discount_value, "Discount value", { maximum: data.discount_type === "percentage" ? 100 : null });
  if (Object.hasOwn(body, "min_order_amount") || !partial) data.min_order_amount = validateDecimal(body.min_order_amount ?? "0", "Minimum order amount", { allowZero: true });
  if (Object.hasOwn(body, "max_discount_amount")) {
    if (body.max_discount_amount !== null) data.max_discount_amount = validateDecimal(body.max_discount_amount, "Maximum discount amount");
    else data.max_discount_amount = null;
  }
  if (Object.hasOwn(body, "description")) {
    if (body.description !== null && typeof body.description !== "string") fail("Description must be a string or null.");
    if (typeof body.description === "string" && body.description.length > 1000) fail("Description must be at most 1000 characters.");
    data.description = body.description;
  }
  if (Object.hasOwn(body, "start_date")) data.start_date = body.start_date === null ? null : validateDate(body.start_date, "Start date");
  if (!partial || Object.hasOwn(body, "end_date")) data.end_date = validateDate(body.end_date, "End date");
  if (!partial || Object.hasOwn(body, "is_active")) {
    if (typeof body.is_active !== "boolean") fail("is_active must be a boolean.", "INVALID_STATUS");
    data.is_active = body.is_active;
  }
  return data;
}

function rejectUnsupported(body, allowed) {
  if (!body || Array.isArray(body) || typeof body !== "object") fail("Request body must be a JSON object.");
  const unsupported = Object.keys(body).find((field) => !allowed.has(field));
  if (unsupported) fail(`Unsupported field: ${unsupported}.`, "UNSUPPORTED_FIELD");
}

function validateCreate(body) {
  rejectUnsupported(body, CREATE_FIELDS);
  for (const field of ["name", "discount_type", "discount_value", "applicable_on", "end_date", "is_active"]) if (!Object.hasOwn(body, field)) fail(`${field} is required.`);
  const data = validateScalarFields(body);
  const mappings = validateMappings(body, { required: true });
  return { data: { ...data, applicable_on: mappings.applicable_on }, mappings };
}

function validatePatch(body) {
  rejectUnsupported(body, EDITABLE_FIELDS);
  if (!Object.keys(body).length) fail("At least one editable field is required.");
  const data = validateScalarFields(body, { partial: true });
  const mappings = validateMappings(body);
  if (!Object.keys(data).length && !mappings) fail("At least one editable field is required.");
  if (mappings) data.applicable_on = mappings.applicable_on;
  return { data, mappings };
}

export function validateDiscountHotelId(req, _res, next) {
  try { validateUuid(req.params.hotelId, "hotel ID"); next(); } catch (error) { next(error); }
}

export async function getHotelDiscounts(req, res, next) {
  try { res.status(200).json({ status: "success", data: { discounts: await getDiscountsForHotel(req.params.hotelId) } }); } catch (error) { next(error); }
}

export async function createHotelDiscount(req, res, next) {
  try { res.status(201).json({ status: "success", data: { discount: await createDiscountForHotel(req.params.hotelId, validateCreate(req.body)) } }); } catch (error) { next(error); }
}

export async function updateHotelDiscount(req, res, next) {
  try { validateUuid(req.params.discountId, "discount ID"); res.status(200).json({ status: "success", data: { discount: await updateDiscountForHotel(req.params.hotelId, req.params.discountId, validatePatch(req.body)) } }); } catch (error) { next(error); }
}

export async function updateHotelDiscountStatus(req, res, next) {
  try {
    validateUuid(req.params.discountId, "discount ID");
    rejectUnsupported(req.body, new Set(["is_active"]));
    if (typeof req.body.is_active !== "boolean") fail("is_active must be a boolean.", "INVALID_STATUS");
    res.status(200).json({ status: "success", data: { discount: await updateDiscountForHotel(req.params.hotelId, req.params.discountId, { data: { is_active: req.body.is_active } }) } });
  } catch (error) { next(error); }
}

export async function deleteHotelDiscount(req, res, next) {
  try { validateUuid(req.params.discountId, "discount ID"); res.status(200).json({ status: "success", data: { discount: await deleteDiscountForHotel(req.params.hotelId, req.params.discountId) } }); } catch (error) { next(error); }
}
