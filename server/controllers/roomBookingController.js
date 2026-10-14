import { AppError } from "../middleware/errorHandler.js";
import { createRoomBooking, deleteRoomBooking, getRoomAvailability, getRoomBookingWorkspace, updateRoomBooking, updateRoomBookingStatus } from "../services/roomBookingService.js";
import { parseBookingDate } from "../utils/bookingDates.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["reserved", "confirmed", "checked-in", "checked-out", "cancelled"]);
const INITIAL_STATUSES = new Set(["reserved", "confirmed"]);
const EDITABLE = new Set(["room_id", "customer_name", "customer_phone", "customer_email", "adults", "children", "booking_from", "booking_to", "status", "special_requests", "notes"]);
const fail = (message, code = "INVALID_ROOM_BOOKING") => { throw new AppError(message, { code, statusCode: 400 }); };
const uuid = (value, label, code) => { if (!UUID.test(value || "")) fail(`${label} must be a valid UUID.`, code); };
const string = (value, field, max, { nullable = false, required = false } = {}) => { if (value === undefined && !required) return undefined; if (value === null && nullable) return null; if (typeof value !== "string" || (required && !value.trim())) fail(`${field} must be ${nullable ? "a string or null" : "a non-empty string"}.`); const result = value.trim(); if (max && result.length > max) fail(`${field} cannot exceed ${max} characters.`); return result; };
const integer = (value, field) => { if (!Number.isInteger(value) || value < 0) fail(`${field} must be a non-negative integer.`); return value; };
const bookingDate = (value, field) => {
  const parsed = parseBookingDate(value);
  if (!parsed) fail(`${field} must be a valid calendar date in YYYY-MM-DD format.`);
  return parsed;
};

function parse(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("Request body must be a JSON object.", "INVALID_REQUEST_BODY");
  const unsupported = Object.keys(body).filter((field) => !EDITABLE.has(field)); if (unsupported.length) fail(`Unsupported room booking fields: ${unsupported.join(", ")}.`, "UNSUPPORTED_ROOM_BOOKING_FIELDS");
  if (partial && !Object.keys(body).length) fail("Provide at least one room booking field to update.", "EMPTY_ROOM_BOOKING_UPDATE");
  if (!partial) for (const field of ["room_id", "customer_name", "customer_phone", "booking_from", "booking_to", "status"]) if (!Object.hasOwn(body, field)) fail(`${field} is required.`);
  const out = {};
  if (!partial || Object.hasOwn(body, "room_id")) { uuid(body.room_id, "room_id", "INVALID_ROOM_ID"); out.room_id = body.room_id; }
  for (const [field, max, options] of [["customer_name", 255, { required: !partial }], ["customer_phone", 20, { required: !partial }], ["customer_email", 255, { nullable: true }], ["special_requests", null, { nullable: true }], ["notes", null, { nullable: true }]]) if (!partial || Object.hasOwn(body, field)) out[field] = string(body[field], field, max, options);
  for (const field of ["adults", "children"]) if (Object.hasOwn(body, field)) out[field] = integer(body[field], field);
  for (const field of ["booking_from", "booking_to"]) if (!partial || Object.hasOwn(body, field)) out[field] = bookingDate(body[field], field);
  if (!partial || Object.hasOwn(body, "status")) {
    if (partial) fail("Use the booking status endpoint to change status.", "UNSUPPORTED_ROOM_BOOKING_FIELDS");
    if (typeof body.status !== "string" || !INITIAL_STATUSES.has(body.status)) fail("A new booking must be reserved or confirmed.");
    out.status = body.status;
  }
  if (out.booking_from && out.booking_to && out.booking_to <= out.booking_from) fail("booking_to must be after booking_from.", "INVALID_BOOKING_DATES");
  return out;
}

export const validateRoomBookingHotelId = (req, _res, next) => { try { uuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID"); next(); } catch (error) { next(error); } };
export async function list(req, res, next) { try { res.json({ status: "success", data: await getRoomBookingWorkspace(req.params.hotelId) }); } catch (error) { next(error); } }
export async function availability(req, res, next) { try {
  const from = bookingDate(req.query.from, "from"), to = bookingDate(req.query.to, "to");
  if (to <= from) fail("to must be after from.", "INVALID_BOOKING_DATES");
  let bookingId;
  if (req.query.bookingId !== undefined) { uuid(req.query.bookingId, "bookingId", "INVALID_ROOM_BOOKING_ID"); bookingId = req.query.bookingId; }
  let capacity;
  if (req.query.capacity !== undefined) { if (!/^\d+$/.test(req.query.capacity) || Number(req.query.capacity) < 1 || !Number.isSafeInteger(Number(req.query.capacity))) fail("capacity must be a positive integer.", "INVALID_ROOM_CAPACITY"); capacity = Number(req.query.capacity); }
  res.json({ status: "success", data: { rooms: await getRoomAvailability(req.params.hotelId, { from, to, bookingId, capacity }) } });
} catch (error) { next(error); } }
export async function create(req, res, next) { try { res.status(201).json({ status: "success", data: { room_booking: await createRoomBooking(req.params.hotelId, parse(req.body)) } }); } catch (error) { next(error); } }
export async function patch(req, res, next) { try { uuid(req.params.bookingId, "bookingId", "INVALID_ROOM_BOOKING_ID"); res.json({ status: "success", data: { room_booking: await updateRoomBooking(req.params.hotelId, req.params.bookingId, parse(req.body, { partial: true })) } }); } catch (error) { next(error); } }
export async function status(req, res, next) { try { uuid(req.params.bookingId, "bookingId", "INVALID_ROOM_BOOKING_ID"); if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).some((key) => key !== "status") || typeof req.body.status !== "string" || !STATUSES.has(req.body.status)) fail("Only an existing booking status is allowed.", "INVALID_ROOM_BOOKING_STATUS"); res.json({ status: "success", data: { room_booking: await updateRoomBookingStatus(req.params.hotelId, req.params.bookingId, req.body.status) } }); } catch (error) { next(error); } }
export async function remove(req, res, next) { try { uuid(req.params.bookingId, "bookingId", "INVALID_ROOM_BOOKING_ID"); res.json({ status: "success", data: { room_booking: await deleteRoomBooking(req.params.hotelId, req.params.bookingId) } }); } catch (error) { next(error); } }
