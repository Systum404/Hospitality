import { AppError } from "./errorHandler.js";
import { ROLE_SCOPES } from "../config/roles.js";
import { requireActiveHotel } from "./activeHotel.js";

export function requireHotelScope(req, res, next) {
  const hotelId = req.auth?.hotelId;

  if (
    req.auth?.scope !== ROLE_SCOPES.HOTEL
    || typeof hotelId !== "string"
    || req.auth?.userActive !== true
    || req.auth?.assignmentActive !== true
  ) {
    return next(new AppError("An authenticated hotel scope is required.", {
      code: "HOTEL_SCOPE_REQUIRED",
      statusCode: 403,
    }));
  }

  if (req.params.hotelId && req.params.hotelId !== hotelId) {
    return next(new AppError("The requested hotel is outside the authenticated scope.", {
      code: "HOTEL_SCOPE_MISMATCH",
      statusCode: 403,
    }));
  }

  req.hotelId = hotelId;
  return requireActiveHotel(req, res, next);
}
