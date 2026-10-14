import { AppError } from "../middleware/errorHandler.js";
import {
  createCompanyHotel,
  getCompanyHotel,
  listCompanyHotels,
  updateCompanyHotel,
} from "../services/companyHotelService.js";
import { activateHotel, deactivateHotel } from "../services/hotelLifecycleService.js";
import { SELECTABLE_HOTEL_PLANS } from "../config/hotelPlans.js";
import { setCompanyHotelPlan } from "../services/hotelPlanService.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9 ()-]{7,20}$/;
const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const REQUIRED_FIELDS = ["name", "type", "address_line", "city", "state_province", "country", "postal_code", "phone", "official_email", "timezone", "currency_code"];
const OPTIONAL_FIELDS = ["logo_url", "website", "tax_registration_number", "description", "check_in_time", "check_out_time"];
const EDITABLE_FIELDS = new Set([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);
const FIELD_LIMITS = {
  name: 255,
  type: 50,
  address_line: 2000,
  city: 100,
  state_province: 100,
  country: 100,
  postal_code: 20,
  phone: 20,
  official_email: 255,
  timezone: 100,
  logo_url: 500,
  website: 500,
  tax_registration_number: 100,
  description: 5000,
};

function invalid(message, code = "INVALID_HOTEL_METADATA") {
  throw new AppError(message, { code, statusCode: 400 });
}

function validateUuid(value) {
  if (!UUID_PATTERN.test(value || "")) invalid("hotelId must be a valid UUID.", "INVALID_HOTEL_ID");
}

function validateLifecycleBody(body) {
  if (body === undefined) return;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    invalid("Request body must be an empty JSON object.", "INVALID_REQUEST_BODY");
  }
  const field = Object.keys(body)[0];
  if (field) invalid(`Unsupported hotel lifecycle field: ${field}.`, "UNSUPPORTED_HOTEL_LIFECYCLE_FIELD");
}

function validatePlanBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, "plan")) {
    invalid("Only a supported plan is allowed.", "INVALID_HOTEL_PLAN");
  }
  if (!SELECTABLE_HOTEL_PLANS.has(body.plan)) invalid("plan must be FREE or PREMIUM.", "INVALID_HOTEL_PLAN");
  return body.plan;
}

function nonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) invalid(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > FIELD_LIMITS[field]) invalid(`${field} cannot exceed ${FIELD_LIMITS[field]} characters.`);
  return normalized;
}

function optionalString(value, field) {
  if (value === null) return null;
  return nonEmptyString(value, field);
}

function validTimezone(value) {
  const timezone = nonEmptyString(value, "timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    invalid("timezone must be a valid IANA timezone.");
  }
  return timezone;
}

function validUrl(value, field) {
  const normalized = optionalString(value, field);
  if (normalized === null) return null;
  let parsed;
  try { parsed = new URL(normalized); } catch { invalid(`${field} must be a valid HTTP(S) URL.`); }
  if (!["http:", "https:"].includes(parsed.protocol)) invalid(`${field} must be a valid HTTP(S) URL.`);
  return normalized;
}

function normalizeField(field, value) {
  if (field === "timezone") return validTimezone(value);
  if (field === "currency_code") {
    if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value.trim())) invalid("currency_code must be a three-letter ISO-style code.");
    return value.trim().toUpperCase();
  }
  if (field === "official_email") {
    const email = nonEmptyString(value, field).toLowerCase();
    if (!EMAIL_PATTERN.test(email)) invalid("official_email must be a valid email address.");
    return email;
  }
  if (field === "phone") {
    const phone = nonEmptyString(value, field);
    if (!PHONE_PATTERN.test(phone) || phone.replace(/\D/g, "").length < 7) invalid("phone must be a valid phone number.");
    return phone;
  }
  if (["logo_url", "website"].includes(field)) return validUrl(value, field);
  if (["check_in_time", "check_out_time"].includes(field)) {
    if (value === null) return null;
    if (typeof value !== "string" || !TIME_PATTERN.test(value)) invalid(`${field} must use 24-hour HH:mm format.`);
    return value;
  }
  return OPTIONAL_FIELDS.includes(field) ? optionalString(value, field) : nonEmptyString(value, field);
}

function validateBody(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("Request body must be a JSON object.", "INVALID_REQUEST_BODY");
  const fields = Object.keys(body);
  const unsupported = fields.find(field => !EDITABLE_FIELDS.has(field));
  if (unsupported) invalid(`Unsupported hotel field: ${unsupported}.`, "UNSUPPORTED_HOTEL_FIELD");
  if (partial && fields.length === 0) invalid("Provide at least one hotel metadata field to update.", "EMPTY_HOTEL_UPDATE");
  if (!partial) {
    const missing = REQUIRED_FIELDS.find(field => !Object.hasOwn(body, field));
    if (missing) invalid(`${missing} is required.`);
  }
  const input = {};
  for (const field of fields) {
    const target = field === "address_line" ? "address" : field === "official_email" ? "email" : field;
    input[target] = normalizeField(field, body[field]);
  }
  return input;
}

function pagination(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? 25 : Number(query.pageSize);
  if (!Number.isInteger(page) || page < 1) invalid("page must be a positive integer.", "INVALID_PAGINATION");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) invalid("pageSize must be between 1 and 100.", "INVALID_PAGINATION");
  return { page, pageSize };
}

export async function listHotels(req, res, next) {
  try {
    res.status(200).json({ status: "success", data: await listCompanyHotels(pagination(req.query)) });
  } catch (error) { next(error); }
}

export async function getHotel(req, res, next) {
  try {
    validateUuid(req.params.hotelId);
    res.status(200).json({ status: "success", data: { hotel: await getCompanyHotel(req.params.hotelId) } });
  } catch (error) { next(error); }
}

export async function createHotel(req, res, next) {
  try {
    res.status(201).json({
      status: "success",
      data: { hotel: await createCompanyHotel(validateBody(req.body), { actor: req.auth, requestContext: req.auditContext }) },
    });
  } catch (error) { next(error); }
}

export async function patchHotel(req, res, next) {
  try {
    validateUuid(req.params.hotelId);
    res.status(200).json({
      status: "success",
      data: { hotel: await updateCompanyHotel(req.params.hotelId, validateBody(req.body, { partial: true }), { actor: req.auth, requestContext: req.auditContext }) },
    });
  } catch (error) { next(error); }
}

export async function changeHotelPlan(req, res, next) {
  try {
    validateUuid(req.params.hotelId);
    const data = await setCompanyHotelPlan(req.params.hotelId, validatePlanBody(req.body), {
      actor: req.auth,
      requestContext: req.auditContext,
    });
    res.status(200).json({ status: "success", data });
  } catch (error) { next(error); }
}

async function transition(req, res, next, operation) {
  try {
    validateUuid(req.params.hotelId);
    validateLifecycleBody(req.body);
    res.status(200).json({
      status: "success",
      data: await operation(req.params.hotelId, { actor: req.auth, requestContext: req.auditContext }),
    });
  } catch (error) { next(error); }
}

export async function activateCompanyHotel(req, res, next) {
  return transition(req, res, next, activateHotel);
}

export async function deactivateCompanyHotel(req, res, next) {
  return transition(req, res, next, deactivateHotel);
}
