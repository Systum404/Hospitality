import { AppError } from "../middleware/errorHandler.js";
import { lookupReceptionBooking } from "../services/receptionBookingLookupService.js";

const bookingReference = /^BK-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = message => { throw new AppError(message, { code: "INVALID_BOOKING_REFERENCE", statusCode: 400 }); };

export async function lookup(req, res, next) {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).some(key => key !== "bookingNumber")) invalid("Request body must contain only bookingNumber.");
    if (typeof req.body.bookingNumber !== "string") invalid("bookingNumber must be a string.");
    const bookingNumber = req.body.bookingNumber.trim();
    if (!bookingReference.test(bookingNumber)) invalid("Enter a valid AAZIRA booking reference.");
    res.json({ status: "success", data: { booking: await lookupReceptionBooking(req.hotelId, bookingNumber) } });
  } catch (error) { next(error); }
}
