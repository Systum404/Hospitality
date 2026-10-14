import { AppError } from "../middleware/errorHandler.js";
import { getManagerDashboard } from "../services/managerDashboardService.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateManagerDashboardHotelId(req, _res, next) {
  if (!UUID.test(req.params.hotelId || "")) {
    return next(new AppError("hotelId must be a valid UUID.", { code: "INVALID_HOTEL_ID", statusCode: 400 }));
  }
  return next();
}

export async function showManagerDashboard(req, res, next) {
  try {
    res.json({ status: "success", data: await getManagerDashboard(req.hotelId) });
  } catch (error) {
    next(error);
  }
}
