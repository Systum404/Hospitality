import { AppError } from "../middleware/errorHandler.js";
import { getReceptionAttendance, recordReceptionAttendance } from "../services/receptionAttendanceService.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = new Set(["userId", "attendanceDate", "status"]);
const fail = (message, code) => { throw new AppError(message, { code, statusCode: 400 }); };

export function validateReceptionAttendanceHotelId(req, _res, next) {
  if (!UUID.test(req.params.hotelId || "")) return next(new AppError("hotelId must be a valid UUID.", { code: "INVALID_HOTEL_ID", statusCode: 400 }));
  return next();
}

function parse(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("Request body must be a JSON object.", "INVALID_REQUEST_BODY");
  const unsupported = Object.keys(body).filter(field => !fields.has(field));
  if (unsupported.length) fail(`Unsupported attendance fields: ${unsupported.join(", ")}.`, "UNSUPPORTED_ATTENDANCE_FIELDS");
  for (const field of fields) if (!Object.hasOwn(body, field)) fail(`${field} is required.`, "INVALID_ATTENDANCE_REQUEST");
  if (!UUID.test(body.userId || "")) fail("userId must be a valid UUID.", "INVALID_USER_ID");
  if (typeof body.attendanceDate !== "string") fail("attendanceDate must be a string.", "INVALID_ATTENDANCE_DATE");
  if (typeof body.status !== "string") fail("status must be a string.", "INVALID_ATTENDANCE_STATUS");
  return { userId: body.userId, attendanceDate: body.attendanceDate, status: body.status };
}

export async function list(req, res, next) {
  try { res.json({ status: "success", data: await getReceptionAttendance(req.hotelId, req.query.date) }); }
  catch (error) { next(error); }
}

export async function record(req, res, next) {
  try {
    const attendance = await recordReceptionAttendance(req.hotelId, req.auth, parse(req.body));
    res.json({ status: "success", data: { attendance } });
  } catch (error) { next(error); }
}
