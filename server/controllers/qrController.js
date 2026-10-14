import { AppError } from "../middleware/errorHandler.js";
import { createQrCode, getQrCode, issueRoomBookingCapability, listQrCodes, rotateQrCode, setQrCodeActive } from "../services/qrService.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (message, code) => { throw new AppError(message, { code, statusCode: 400 }); };
const uuid = (value, label, code) => { if (!UUID.test(value || "")) fail(`${label} must be a valid UUID.`, code); };
const object = body => { if (!body || typeof body !== "object" || Array.isArray(body)) fail("Request body must be a JSON object.", "INVALID_REQUEST_BODY"); };

export function validateQrHotelId(req, _res, next) { try { uuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID"); next(); } catch (error) { next(error); } }
export async function list(req, res, next) { try { res.json({ status: "success", data: { qr_codes: await listQrCodes(req.params.hotelId) } }); } catch (error) { next(error); } }
export async function retrieve(req, res, next) { try { uuid(req.params.qrId, "qrId", "INVALID_QR_CODE_ID"); res.json({ status: "success", data: { qr_code: await getQrCode(req.params.hotelId, req.params.qrId) } }); } catch (error) { next(error); } }
export async function create(req, res, next) { try {
  object(req.body);
  const allowed = req.body.type === "room" ? ["type", "room_id"] : req.body.type === "dining_table" ? ["type", "dining_table_id"] : [];
  if (!allowed.length || Object.keys(req.body).some(key => !allowed.includes(key)) || Object.keys(req.body).length !== 2) fail("Provide exactly one supported QR type and its target.", "INVALID_QR_TARGET");
  const target = req.body.type === "room" ? "room_id" : "dining_table_id";
  uuid(req.body[target], target, "INVALID_QR_TARGET_ID");
  res.status(201).json({ status: "success", data: { qr_code: await createQrCode(req.params.hotelId, { type: req.body.type, [target]: req.body[target] }) } });
} catch (error) { next(error); } }
export async function status(req, res, next) { try {
  uuid(req.params.qrId, "qrId", "INVALID_QR_CODE_ID"); object(req.body);
  if (Object.keys(req.body).length !== 1 || typeof req.body.is_active !== "boolean") fail("Only boolean is_active may be supplied.", "INVALID_QR_STATUS");
  res.json({ status: "success", data: { qr_code: await setQrCodeActive(req.params.hotelId, req.params.qrId, req.body.is_active) } });
} catch (error) { next(error); } }
export async function rotate(req, res, next) { try {
  uuid(req.params.qrId, "qrId", "INVALID_QR_CODE_ID");
  if (req.body && (typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length)) fail("QR rotation does not accept request fields.", "INVALID_QR_ROTATION");
  res.json({ status: "success", data: { qr_code: await rotateQrCode(req.params.hotelId, req.params.qrId) } });
} catch (error) { next(error); } }
export async function capability(req, res, next) { try {
  uuid(req.params.bookingId, "bookingId", "INVALID_ROOM_BOOKING_ID");
  if (req.body && (typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length)) fail("Capability issuance does not accept request fields.", "INVALID_ROOM_CAPABILITY_REQUEST");
  res.status(201).json({ status: "success", data: { room_capability: await issueRoomBookingCapability(req.params.hotelId, req.params.bookingId) } });
} catch (error) { next(error); } }
