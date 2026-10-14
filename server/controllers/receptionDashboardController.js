import { AppError } from "../middleware/errorHandler.js";
import { getReceptionDashboard } from "../services/receptionDashboardService.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateReceptionDashboardHotelId(req, _res, next) {
  if (!uuid.test(req.params.hotelId || "")) return next(new AppError("hotelId must be a valid UUID.", { code: "INVALID_HOTEL_ID", statusCode: 400 }));
  return next();
}

export async function dashboard(req, res, next) {
  try { res.json({ status: "success", data: await getReceptionDashboard(req.hotelId) }); }
  catch (error) { next(error); }
}
