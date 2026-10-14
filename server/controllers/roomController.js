import { AppError } from "../middleware/errorHandler.js";
import { createRoom, deleteRoom, getRooms, updateRoom, updateRoomStatus } from "../services/roomService.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL = /^-?(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const EDITABLE = new Set(["room_number", "floor_number", "capacity", "room_type", "status", "base_price", "description"]);

function invalid(message, code = "INVALID_ROOM") { throw new AppError(message, { code, statusCode: 400 }); }
function uuid(value, field, code) { if (!UUID.test(value || "")) invalid(`${field} must be a valid UUID.`, code); }
function requiredString(value, field, maximumLength) {
  if (typeof value !== "string" || !value.trim()) invalid(`${field} must be a non-empty string.`);
  const result = value.trim();
  if (result.length > maximumLength) invalid(`${field} cannot exceed ${maximumLength} characters.`);
  return result;
}
function nullableString(value, field, maximumLength) {
  if (value !== null && typeof value !== "string") invalid(`${field} must be a string or null.`);
  if (typeof value === "string" && maximumLength && value.trim().length > maximumLength) invalid(`${field} cannot exceed ${maximumLength} characters.`);
  return value === null ? null : value.trim();
}
function integer(value, field) { if (!Number.isInteger(value)) invalid(`${field} must be an integer.`); return value; }
function databaseInteger(value, field) {
  integer(value, field);
  if (value < -2147483648 || value > 2147483647) invalid(`${field} must be between -2147483648 and 2147483647.`);
  return value;
}
function smallInteger(value, field) {
  integer(value, field);
  if (value < -32768 || value > 32767) invalid(`${field} must be between -32768 and 32767.`);
  return value;
}
function decimal(value, field) { if (typeof value !== "string" || !DECIMAL.test(value)) invalid(`${field} must be a decimal value with at most two decimal places.`); return value; }

function parse(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("Request body must be a JSON object.", "INVALID_REQUEST_BODY");
  const unsupported = Object.keys(body).filter((field) => !EDITABLE.has(field));
  if (unsupported.length) invalid(`Unsupported room fields: ${unsupported.join(", ")}.`, "UNSUPPORTED_ROOM_FIELDS");
  if (partial && Object.keys(body).length === 0) invalid("Provide at least one room field to update.", "EMPTY_ROOM_UPDATE");
  if (!partial) for (const field of ["room_number", "status"]) if (!Object.hasOwn(body, field)) invalid(`${field} is required.`);

  const input = {};
  if (!partial || Object.hasOwn(body, "room_number")) input.room_number = requiredString(body.room_number, "room_number", 50);
  if (!partial || Object.hasOwn(body, "status")) input.status = requiredString(body.status, "status", 30);
  if (Object.hasOwn(body, "room_type")) input.room_type = nullableString(body.room_type, "room_type", 100);
  if (Object.hasOwn(body, "description")) input.description = nullableString(body.description, "description");
  if (Object.hasOwn(body, "floor_number")) input.floor_number = smallInteger(body.floor_number, "floor_number");
  if (Object.hasOwn(body, "capacity")) input.capacity = databaseInteger(body.capacity, "capacity");
  if (Object.hasOwn(body, "base_price")) input.base_price = decimal(body.base_price, "base_price");
  return input;
}

export function validateRoomHotelId(req, _res, next) { try { uuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID"); next(); } catch (error) { next(error); } }
export async function list(req, res, next) { try { res.status(200).json({ status: "success", data: { rooms: await getRooms(req.params.hotelId) } }); } catch (error) { next(error); } }
export async function create(req, res, next) { try { res.status(201).json({ status: "success", data: { room: await createRoom(req.params.hotelId, parse(req.body)) } }); } catch (error) { next(error); } }
export async function patch(req, res, next) { try { uuid(req.params.roomId, "roomId", "INVALID_ROOM_ID"); res.status(200).json({ status: "success", data: { room: await updateRoom(req.params.hotelId, req.params.roomId, parse(req.body, { partial: true })) } }); } catch (error) { next(error); } }
export async function status(req, res, next) {
  try {
    uuid(req.params.roomId, "roomId", "INVALID_ROOM_ID");
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, "status")) invalid("Only status may be supplied.", "INVALID_ROOM_STATUS");
    const roomStatus = requiredString(req.body.status, "status", 30);
    res.status(200).json({ status: "success", data: { room: await updateRoomStatus(req.params.hotelId, req.params.roomId, roomStatus) } });
  } catch (error) { next(error); }
}
export async function remove(req, res, next) { try { uuid(req.params.roomId, "roomId", "INVALID_ROOM_ID"); res.status(200).json({ status: "success", data: { room: await deleteRoom(req.params.hotelId, req.params.roomId) } }); } catch (error) { next(error); } }
