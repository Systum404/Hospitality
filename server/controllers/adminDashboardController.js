import { AppError } from "../middleware/errorHandler.js";
import { getAdminDashboard } from "../services/adminDashboardService.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateAdminDashboardHotelId(req, _res, next) {
  if (!UUID.test(req.params.hotelId || "")) return next(new AppError("hotelId must be a valid UUID.", { code: "INVALID_HOTEL_ID", statusCode: 400 }));
  return next();
}

export async function showAdminDashboard(req, res, next) {
  try { res.json({ status: "success", data: await getAdminDashboard(req.hotelId) }); }
  catch (error) { next(error); }
}
