import { AppError } from "../middleware/errorHandler.js";
import { getManagerReport, validateManagerReportRange } from "../services/managerReportsService.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateManagerReportsHotelId(req, _res, next) {
  if (!UUID.test(req.params.hotelId || "")) {
    return next(new AppError("hotelId must be a valid UUID.", { code: "INVALID_HOTEL_ID", statusCode: 400 }));
  }
  return next();
}

export async function showManagerReport(req, res, next) {
  try {
    const range = validateManagerReportRange(req.query.range);
    res.json({ status: "success", report: await getManagerReport(req.hotelId, range) });
  } catch (error) {
    next(error);
  }
}
