import { AppError } from "../middleware/errorHandler.js";
import { isValidPassword } from "../config/passwordPolicy.js";
import {
  createUserForHotel,
  deleteUserForHotel,
  getUsersForHotel,
  updateUserForHotel,
  updateUserStatusForHotel,
} from "../services/userAccountService.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSTGRES_INTEGER_MAX = 2147483647;
const EDITABLE_FIELDS = new Set(["email", "name", "password", "role_id"]);
const CREATE_FIELDS = new Set([...EDITABLE_FIELDS, "is_active"]);

function invalid(message, code = "INVALID_USER_ACCOUNT") {
  throw new AppError(message, { code, statusCode: 400 });
}

function validateUuid(value, label, code) {
  if (!UUID_PATTERN.test(value || "")) invalid(`${label} must be a valid UUID.`, code);
}

function validateName(value) {
  if (typeof value !== "string" || !value.trim()) invalid("name must be a non-empty string.");
  const name = value.trim();
  if (name.length > 255) invalid("name cannot exceed 255 characters.");
  return name;
}

function validateEmail(value) {
  if (typeof value !== "string" || !value.trim()) invalid("email must be a non-empty string.");
  const email = value.trim().toLowerCase();
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid("email must be valid.");
  return email;
}

function validatePassword(value) {
  if (!isValidPassword(value)) {
    invalid("password must contain between 8 and 1024 characters.");
  }
  return value;
}

function validateRoleId(value) {
  if (!Number.isInteger(value) || value < 1 || value > POSTGRES_INTEGER_MAX) {
    invalid(`role_id must be a positive integer no greater than ${POSTGRES_INTEGER_MAX}.`);
  }
  return value;
}

function validateBody(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    invalid("Request body must be a JSON object.", "INVALID_REQUEST_BODY");
  }

  const allowed = partial ? EDITABLE_FIELDS : CREATE_FIELDS;
  const unsupported = Object.keys(body).find((field) => !allowed.has(field));
  if (unsupported) invalid(`Unsupported user account field: ${unsupported}.`, "UNSUPPORTED_USER_ACCOUNT_FIELD");
  if (partial && Object.keys(body).length === 0) invalid("At least one user account field is required.", "EMPTY_USER_ACCOUNT_UPDATE");
  if (!partial) {
    for (const field of ["name", "email", "password", "role_id"]) {
      if (!Object.hasOwn(body, field)) invalid(`${field} is required.`);
    }
  }

  const input = {};
  if (!partial || Object.hasOwn(body, "name")) input.name = validateName(body.name);
  if (!partial || Object.hasOwn(body, "email")) input.email = validateEmail(body.email);
  if (!partial || Object.hasOwn(body, "password")) input.password = validatePassword(body.password);
  if (!partial || Object.hasOwn(body, "role_id")) input.role_id = validateRoleId(body.role_id);
  if (!partial && Object.hasOwn(body, "is_active")) {
    if (typeof body.is_active !== "boolean") invalid("is_active must be a boolean.");
    input.is_active = body.is_active;
  }
  return input;
}

function validateStatus(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    invalid("Request body must be a JSON object.", "INVALID_REQUEST_BODY");
  }
  if (Object.keys(body).length !== 1 || !Object.hasOwn(body, "is_active") || typeof body.is_active !== "boolean") {
    invalid("Only is_active boolean is allowed.", "INVALID_USER_STATUS");
  }
  return body.is_active;
}

export async function getHotelUsers(req, res, next) {
  try {
    validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID");
    const data = await getUsersForHotel(req.params.hotelId);
    res.status(200).json({ status: "success", data });
  } catch (error) {
    next(error);
  }
}

export async function createHotelUser(req, res, next) {
  try {
    validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID");
    const user = await createUserForHotel(req.params.hotelId, validateBody(req.body));
    res.status(201).json({ status: "success", data: { user } });
  } catch (error) {
    next(error);
  }
}

export async function patchHotelUser(req, res, next) {
  try {
    validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID");
    validateUuid(req.params.userId, "userId", "INVALID_USER_ID");
    const user = await updateUserForHotel(req.params.hotelId, req.params.userId, validateBody(req.body, { partial: true }));
    res.status(200).json({ status: "success", data: { user } });
  } catch (error) {
    next(error);
  }
}

export async function patchHotelUserStatus(req, res, next) {
  try {
    validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID");
    validateUuid(req.params.userId, "userId", "INVALID_USER_ID");
    const user = await updateUserStatusForHotel(req.params.hotelId, req.params.userId, validateStatus(req.body));
    res.status(200).json({ status: "success", data: { user } });
  } catch (error) {
    next(error);
  }
}

export async function deleteHotelUser(req, res, next) {
  try {
    validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID");
    validateUuid(req.params.userId, "userId", "INVALID_USER_ID");
    const user = await deleteUserForHotel(req.params.hotelId, req.params.userId, req.auth.userId);
    res.status(200).json({ status: "success", data: { user } });
  } catch (error) {
    next(error);
  }
}
