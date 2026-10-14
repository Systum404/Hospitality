import { HOTEL_STATUSES } from "../config/hotelLifecycle.js";
import { ROLE_SCOPES } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "./errorHandler.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const inactiveHotelError = () => new AppError("Hotel operations are unavailable.", {
  code: "HOTEL_INACTIVE",
  statusCode: 403,
});

export async function requireActiveHotel(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const hotelId = req.auth?.hotelId;
  if (req.auth?.scope !== ROLE_SCOPES.HOTEL || req.hotelId !== hotelId || typeof hotelId !== "string") {
    return next(new AppError("An authenticated hotel scope is required.", {
      code: "HOTEL_SCOPE_REQUIRED",
      statusCode: 403,
    }));
  }

  try {
    const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { status: true } });
    if (!hotel || hotel.status !== HOTEL_STATUSES.ACTIVE) return next(inactiveHotelError());
    return next();
  } catch (error) {
    return next(error);
  }
}

