import { AppError } from "../middleware/errorHandler.js";
import { getHotelSettings, updateHotelBillingSettings, updateHotelMetadata } from "../services/hotelSettingsService.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()-]{7,20}$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const METADATA_FIELDS = new Set(["name", "type", "address_line", "city", "state_province", "country", "postal_code", "phone", "official_email", "timezone", "logo_url", "website", "tax_registration_number", "description", "check_in_time", "check_out_time"]);
const LIMITS = { name: 255, type: 50, address_line: 2000, city: 100, state_province: 100, country: 100, postal_code: 20, phone: 20, official_email: 255, timezone: 100, logo_url: 500, website: 500, tax_registration_number: 100, description: 5000 };
const invalid = (message, code = "INVALID_HOTEL_SETTINGS") => { throw new AppError(message, { code, statusCode: 400 }); };

export function validateHotelSettingsHotelId(req, _res, next) {
  try { if (!UUID.test(req.params.hotelId || "")) invalid("hotelId must be a valid UUID.", "INVALID_HOTEL_ID"); next(); } catch (error) { next(error); }
}
function objectBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("Request body must be a JSON object.", "INVALID_REQUEST_BODY");
  return body;
}
function decimalRate(value) {
  if (!(["string", "number"].includes(typeof value)) || !/^\+?\d{1,3}(?:\.\d{1,2})?$/.test(String(value).trim())) invalid("service_charge_rate must be a decimal with at most two places.");
  const normalized = String(value).trim().replace(/^\+/, "");
  const number = Number(normalized);
  if (number < 0 || number > 100) invalid("service_charge_rate must be between 0 and 100.");
  return number.toFixed(2);
}
function billingInput(body) {
  objectBody(body);
  const allowed = new Set(["service_charge_enabled", "service_charge_rate", "default_tax_slab_id"]);
  const fields = Object.keys(body);
  if (!fields.length) invalid("Provide at least one billing setting.", "EMPTY_SETTINGS_UPDATE");
  const unsupported = fields.find(field => !allowed.has(field));
  if (unsupported) invalid(`Unsupported billing setting: ${unsupported}.`, "UNSUPPORTED_SETTINGS_FIELD");
  const input = {};
  if (Object.hasOwn(body, "service_charge_enabled")) {
    if (typeof body.service_charge_enabled !== "boolean") invalid("service_charge_enabled must be a boolean.");
    input.service_charge_enabled = body.service_charge_enabled;
  }
  if (Object.hasOwn(body, "service_charge_rate")) input.service_charge_rate = decimalRate(body.service_charge_rate);
  if (Object.hasOwn(body, "default_tax_slab_id")) {
    if (body.default_tax_slab_id !== null && !UUID.test(body.default_tax_slab_id || "")) invalid("default_tax_slab_id must be a UUID or null.");
    input.default_tax_slab_id = body.default_tax_slab_id;
  }
  if (input.service_charge_enabled === true && Number(input.service_charge_rate ?? body.service_charge_rate) <= 0) invalid("An enabled service charge requires a positive rate.");
  return input;
}
function stringValue(value, field, { optional = false } = {}) {
  if (optional && value === null) return null;
  if (typeof value !== "string" || !value.trim()) invalid(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > LIMITS[field]) invalid(`${field} cannot exceed ${LIMITS[field]} characters.`);
  return normalized;
}
function metadataInput(body) {
  objectBody(body);
  const fields = Object.keys(body);
  if (!fields.length) invalid("Provide at least one hotel metadata field.", "EMPTY_HOTEL_UPDATE");
  const unsupported = fields.find(field => !METADATA_FIELDS.has(field));
  if (unsupported) invalid(`Unsupported hotel metadata field: ${unsupported}.`, "UNSUPPORTED_HOTEL_FIELD");
  const input = {};
  for (const field of fields) {
    let value = body[field];
    const optional = ["logo_url", "website", "tax_registration_number", "description", "check_in_time", "check_out_time"].includes(field);
    if (field === "timezone") {
      value = stringValue(value, field);
      try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); } catch { invalid("timezone must be a valid IANA timezone."); }
    } else if (field === "official_email") {
      value = stringValue(value, field).toLowerCase(); if (!EMAIL.test(value)) invalid("official_email must be valid.");
    } else if (field === "phone") {
      value = stringValue(value, field); if (!PHONE.test(value) || value.replace(/\D/g, "").length < 7) invalid("phone must be valid.");
    } else if (["logo_url", "website"].includes(field) && value !== null) {
      value = stringValue(value, field, { optional }); let parsed; try { parsed = new URL(value); } catch { invalid(`${field} must be a valid HTTP(S) URL.`); } if (!["http:", "https:"].includes(parsed.protocol)) invalid(`${field} must be a valid HTTP(S) URL.`);
    } else if (["check_in_time", "check_out_time"].includes(field) && value !== null) {
      if (typeof value !== "string" || !TIME.test(value)) invalid(`${field} must use 24-hour HH:mm format.`);
    } else value = stringValue(value, field, { optional });
    input[field === "address_line" ? "address" : field === "official_email" ? "email" : field] = value;
  }
  return input;
}

const audit = req => ({ actor: req.auth, requestContext: req.auditContext });
export async function getSettings(req, res) { res.json({ status: "success", data: await getHotelSettings(req.hotelId) }); }
export async function patchBillingSettings(req, res) { res.json({ status: "success", data: { billing: await updateHotelBillingSettings(req.hotelId, billingInput(req.body), audit(req)) } }); }
export async function patchHotelSettings(req, res) { res.json({ status: "success", data: { hotel: await updateHotelMetadata(req.hotelId, metadataInput(req.body), audit(req)) } }); }
