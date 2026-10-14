import { AppError } from "../middleware/errorHandler.js";
import { createRoomOrder, deleteRoomOrder, getRoomOrders, updateRoomOrder, updateRoomOrderStatus } from "../services/roomOrderService.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["pending", "preparing", "ready", "completed"]);
const FIELDS = new Set(["room_booking_id", "items", "notes", "status", "payment_status"]);
const fail = (message, code = "INVALID_ROOM_ORDER") => { throw new AppError(message, { code, statusCode: 400 }); };
const uuid = (value, field, code) => { if (!UUID.test(value || "")) fail(`${field} must be a valid UUID.`, code); };
const string = (value, field, maximum, { nullable = false, required = false } = {}) => { if (value === undefined && !required) return undefined; if (value === null && nullable) return null; if (typeof value !== "string" || (required && !value.trim())) fail(`${field} must be ${nullable ? "a string or null" : "a non-empty string"}.`); const out = value.trim(); if (maximum && out.length > maximum) fail(`${field} cannot exceed ${maximum} characters.`); return out; };

function items(value) {
  if (!Array.isArray(value) || !value.length) fail("items must contain at least one menu item.", "INVALID_ROOM_ORDER_ITEMS");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some((key) => !["menu_item_id", "quantity", "special_instructions"].includes(key))) fail(`items[${index}] is invalid.`, "INVALID_ROOM_ORDER_ITEMS");
    uuid(item.menu_item_id, `items[${index}].menu_item_id`, "INVALID_MENU_ITEM_ID");
    if (!Number.isInteger(item.quantity) || item.quantity < 1) fail(`items[${index}].quantity must be a positive integer.`, "INVALID_ROOM_ORDER_ITEMS");
    return { menu_item_id: item.menu_item_id, quantity: item.quantity, special_instructions: string(item.special_instructions, `items[${index}].special_instructions`, undefined, { nullable: true }) };
  });
}
function parse(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("Request body must be a JSON object.", "INVALID_REQUEST_BODY");
  const unsupported = Object.keys(body).filter((field) => !FIELDS.has(field)); if (unsupported.length) fail(`Unsupported room order fields: ${unsupported.join(", ")}.`, "UNSUPPORTED_ROOM_ORDER_FIELDS");
  if (partial && !Object.keys(body).length) fail("Provide at least one room order field to update.", "EMPTY_ROOM_ORDER_UPDATE");
  if (!partial) for (const field of ["room_booking_id", "items", "status", "payment_status"]) if (!Object.hasOwn(body, field)) fail(`${field} is required.`);
  const input = {};
  if (!partial || Object.hasOwn(body, "room_booking_id")) { uuid(body.room_booking_id, "room_booking_id", "INVALID_ROOM_BOOKING_ID"); input.room_booking_id = body.room_booking_id; }
  if (!partial || Object.hasOwn(body, "items")) input.items = items(body.items);
  if (!partial || Object.hasOwn(body, "status")) { if (typeof body.status !== "string" || !STATUSES.has(body.status)) fail("status is not supported by the existing Room Orders workflow.", "INVALID_ROOM_ORDER_STATUS"); input.status = body.status; }
  if (!partial || Object.hasOwn(body, "payment_status")) input.payment_status = string(body.payment_status, "payment_status", 30, { required: !partial });
  if (Object.hasOwn(body, "notes")) input.notes = string(body.notes, "notes", undefined, { nullable: true });
  return input;
}
export const validateRoomOrderHotelId = (req, _res, next) => { try { uuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID"); next(); } catch (error) { next(error); } };
export async function list(req, res, next) { try { res.json({ status: "success", data: { room_orders: await getRoomOrders(req.params.hotelId) } }); } catch (error) { next(error); } }
export async function create(req, res, next) { try { res.status(201).json({ status: "success", data: { room_order: await createRoomOrder(req.params.hotelId, parse(req.body)) } }); } catch (error) { next(error); } }
export async function patch(req, res, next) { try { uuid(req.params.orderId, "orderId", "INVALID_ROOM_ORDER_ID"); res.json({ status: "success", data: { room_order: await updateRoomOrder(req.params.hotelId, req.params.orderId, parse(req.body, { partial: true })) } }); } catch (error) { next(error); } }
export async function status(req, res, next) { try { uuid(req.params.orderId, "orderId", "INVALID_ROOM_ORDER_ID"); if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length !== 1 || typeof req.body.status !== "string" || !STATUSES.has(req.body.status)) fail("Only an existing Room Order status may be supplied.", "INVALID_ROOM_ORDER_STATUS"); res.json({ status: "success", data: { room_order: await updateRoomOrderStatus(req.params.hotelId, req.params.orderId, req.body.status) } }); } catch (error) { next(error); } }
export async function remove(req, res, next) { try { uuid(req.params.orderId, "orderId", "INVALID_ROOM_ORDER_ID"); res.json({ status: "success", data: { room_order: await deleteRoomOrder(req.params.hotelId, req.params.orderId) } }); } catch (error) { next(error); } }
