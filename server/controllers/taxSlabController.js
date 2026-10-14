import { AppError } from "../middleware/errorHandler.js";
import {
  createTaxSlab,
  deleteTaxSlab,
  getTaxSlabsForHotel,
  updateTaxSlab,
} from "../services/taxSlabService.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDITABLE_FIELDS = new Set(["name", "rate", "applicable_on", "is_active"]);
const DECIMAL_5_2_PATTERN = /^\+?\d{1,3}(?:\.\d{1,2})?$/;

function invalid(message, code = "INVALID_TAX_SLAB") {
  throw new AppError(message, { code, statusCode: 400 });
}

function validateUuid(value, fieldName, code) {
  if (!UUID_PATTERN.test(value)) invalid(`${fieldName} must be a valid UUID.`, code);
}

function validateDecimalRate(value) {
  if ((typeof value !== "string" && typeof value !== "number") || value === "") {
    invalid("rate must be a valid decimal value.");
  }

  const decimal = typeof value === "string" ? value.trim() : String(value);
  if (!DECIMAL_5_2_PATTERN.test(decimal)) invalid("rate must fit the database Decimal(5,2) format.");

  const unsigned = decimal.startsWith("+") ? decimal.slice(1) : decimal;
  const [whole, fraction = ""] = unsigned.split(".");
  if (/^0+$/.test(`${whole}${fraction}`)) invalid("rate must be greater than 0.");
  if (Number(whole) > 100 || (Number(whole) === 100 && /[1-9]/.test(fraction))) {
    invalid("rate cannot exceed 100.");
  }

  return decimal;
}

function validateTaxSlabInput(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    invalid("Request body must be a JSON object.", "INVALID_REQUEST_BODY");
  }

  const unsupported = Object.keys(body).filter((field) => !EDITABLE_FIELDS.has(field));
  if (unsupported.length) invalid(`Unsupported tax slab fields: ${unsupported.join(", ")}.`, "INVALID_TAX_SLAB_FIELDS");
  if (partial && Object.keys(body).length === 0) invalid("Provide at least one tax slab field to update.", "EMPTY_TAX_SLAB_UPDATE");

  if (!partial) {
    for (const field of ["name", "rate", "applicable_on"]) {
      if (!Object.hasOwn(body, field)) invalid(`${field} is required.`);
    }
  }

  const input = {};
  if (!partial || Object.hasOwn(body, "name")) {
    if (typeof body.name !== "string" || !body.name.trim()) invalid("name must be a non-empty string.");
    input.name = body.name.trim();
    if (input.name.length > 255) invalid("name cannot exceed 255 characters.");
  }
  if (!partial || Object.hasOwn(body, "rate")) input.rate = validateDecimalRate(body.rate);
  if (!partial || Object.hasOwn(body, "applicable_on")) {
    if (typeof body.applicable_on !== "string" || !body.applicable_on.trim()) {
      invalid("applicable_on must be a non-empty string.");
    }
    input.applicable_on = body.applicable_on.trim();
    if (input.applicable_on.length > 30) invalid("applicable_on cannot exceed 30 characters.");
  }
  if (Object.hasOwn(body, "is_active")) {
    if (typeof body.is_active !== "boolean") invalid("is_active must be a boolean.");
    input.is_active = body.is_active;
  }
  return input;
}

function validateStatusInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    invalid("Request body must be a JSON object.", "INVALID_REQUEST_BODY");
  }
  if (Object.keys(body).some((field) => field !== "is_active")) {
    invalid("Only is_active can be updated through this endpoint.", "INVALID_TAX_SLAB_STATUS_FIELDS");
  }
  if (!Object.hasOwn(body, "is_active") || typeof body.is_active !== "boolean") {
    invalid("is_active must be provided as a boolean.", "INVALID_TAX_SLAB_STATUS");
  }
  return body.is_active;
}

export async function getHotelTaxSlabs(req, res) {
  validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID");
  const taxSlabs = await getTaxSlabsForHotel(req.params.hotelId);
  return res.status(200).json({ status: "success", data: { tax_slabs: taxSlabs } });
}

export async function createHotelTaxSlab(req, res) {
  validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID");
  const taxSlab = await createTaxSlab(req.params.hotelId, validateTaxSlabInput(req.body));
  return res.status(201).json({ status: "success", data: { tax_slab: taxSlab } });
}

export async function patchHotelTaxSlab(req, res) {
  const { hotelId, taxSlabId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");
  validateUuid(taxSlabId, "taxSlabId", "INVALID_TAX_SLAB_ID");
  const taxSlab = await updateTaxSlab(hotelId, taxSlabId, validateTaxSlabInput(req.body, { partial: true }), { actor: req.auth, requestContext: req.auditContext });
  return res.status(200).json({ status: "success", data: { tax_slab: taxSlab } });
}

export async function patchHotelTaxSlabStatus(req, res) {
  const { hotelId, taxSlabId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");
  validateUuid(taxSlabId, "taxSlabId", "INVALID_TAX_SLAB_ID");
  const taxSlab = await updateTaxSlab(hotelId, taxSlabId, { is_active: validateStatusInput(req.body) }, { actor: req.auth, requestContext: req.auditContext });
  return res.status(200).json({ status: "success", data: { tax_slab: taxSlab } });
}

export async function deleteHotelTaxSlab(req, res) {
  const { hotelId, taxSlabId } = req.params;
  validateUuid(hotelId, "hotelId", "INVALID_HOTEL_ID");
  validateUuid(taxSlabId, "taxSlabId", "INVALID_TAX_SLAB_ID");
  const taxSlab = await deleteTaxSlab(hotelId, taxSlabId, { actor: req.auth, requestContext: req.auditContext });
  return res.status(200).json({ status: "success", data: { tax_slab: taxSlab } });
}
