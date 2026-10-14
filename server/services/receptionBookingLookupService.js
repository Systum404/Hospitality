import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { bookingDateKey } from "../utils/bookingDates.js";

const selection = {
  id: true,
  booking_number: true,
  customer_name: true,
  customer_phone: true,
  customer_email: true,
  adults: true,
  children: true,
  booking_from: true,
  booking_to: true,
  status: true,
  room_rate: true,
  notes: true,
  special_requests: true,
  checked_in_at: true,
  checked_out_at: true,
  room: { select: { room_number: true, room_type: true } },
  bill: { select: { status: true, total_amount: true, amount_paid: true, balance_due: true } },
};

const decimal = value => value?.toFixed(2) ?? null;
const iso = value => value?.toISOString() ?? null;

export async function lookupReceptionBooking(hotelId, bookingNumber) {
  const booking = await prisma.room_booking.findFirst({
    where: { hotel_id: hotelId, booking_number: bookingNumber, room: { is: { hotel_id: hotelId } } },
    select: selection,
  });
  if (!booking) throw new AppError("Booking not found.", { code: "BOOKING_NOT_FOUND", statusCode: 404 });
  return {
    bookingId: booking.id,
    bookingNumber: booking.booking_number,
    guestName: booking.customer_name,
    phone: booking.customer_phone,
    email: booking.customer_email,
    roomNumber: booking.room.room_number,
    roomType: booking.room.room_type,
    arrivalAt: bookingDateKey(booking.booking_from),
    departureAt: bookingDateKey(booking.booking_to),
    adults: booking.adults,
    children: booking.children,
    totalOccupants: booking.adults + booking.children,
    status: booking.status,
    roomRate: decimal(booking.room_rate),
    notes: booking.notes,
    specialRequests: booking.special_requests,
    checkedInAt: iso(booking.checked_in_at),
    checkedOutAt: iso(booking.checked_out_at),
    billing: booking.bill ? { status: booking.bill.status, totalAmount: decimal(booking.bill.total_amount), amountPaid: decimal(booking.bill.amount_paid), balanceDue: decimal(booking.bill.balance_due) } : null,
  };
}
