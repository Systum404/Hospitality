import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { notifyActiveReceptionUsers } from "./operationalNotificationService.js";
import { bookingDateKey, bookingNights, hotelDateKey, isBookingDate } from "../utils/bookingDates.js";
import { resolveBookingCustomer } from "./customerService.js";

const RESERVING_STATUSES = ["reserved", "confirmed", "checked-in"];
const SCHEDULED_STATUSES = ["reserved", "confirmed"];
const DELETABLE_STATUSES = new Set(["reserved", "confirmed"]);
const EDITABLE_BEFORE_CHECK_IN = new Set(["room_id", "customer_name", "customer_phone", "customer_email", "adults", "children", "booking_from", "booking_to", "special_requests", "notes"]);
const EDITABLE_AFTER_CHECK_IN = new Set(["customer_name", "customer_phone", "customer_email", "special_requests", "notes"]);
const NEXT_STATUSES = { reserved: new Set(["confirmed", "cancelled"]), confirmed: new Set(["checked-in", "cancelled"]), "checked-in": new Set(["checked-out"]), "checked-out": new Set(), cancelled: new Set() };
const bookingFields = { id:true, hotel_id:true, room_id:true, booking_number:true, customer_name:true, customer_phone:true, customer_email:true, adults:true, children:true, booking_from:true, booking_to:true, status:true, room_rate:true, total_amount:true, paid_amount:true, payment_status:true, special_requests:true, notes:true, checked_in_at:true, checked_out_at:true, created_at:true, updated_at:true, room:{select:{id:true,room_number:true,room_type:true,base_price:true,capacity:true,status:true}} };
const roomsFields = { id:true, room_number:true, room_type:true, base_price:true, capacity:true, status:true };
const serialize = ({ booking_from,booking_to,room_rate,total_amount,paid_amount,room,...booking }) => ({ ...booking, booking_from:bookingDateKey(booking_from), booking_to:bookingDateKey(booking_to), room_rate:room_rate.toFixed(2), total_amount:total_amount.toFixed(2), paid_amount:paid_amount.toFixed(2), room:{...room,base_price:room.base_price.toFixed(2)} });
const conflict = (message, code) => { throw new AppError(message, { code, statusCode: 409 }); };

async function requireHotel(client, hotelId) {
  const hotel = await client.hotel.findUnique({ where:{id:hotelId}, select:{id:true,timezone:true} });
  if (!hotel) throw new AppError("Hotel not found.", { code:"HOTEL_NOT_FOUND", statusCode:404 });
  try { new Intl.DateTimeFormat("en-US", { timeZone: hotel.timezone }).format(); }
  catch { throw new AppError("The hotel's timezone configuration is invalid.", { code:"INVALID_HOTEL_TIMEZONE", statusCode:500 }); }
  return hotel;
}
async function requireRoom(client, hotelId, roomId) {
  const room=await client.room.findFirst({where:{id:roomId,hotel_id:hotelId},select:roomsFields});
  if(!room) throw new AppError("Room not found for this hotel.",{code:"ROOM_NOT_FOUND",statusCode:404});
  return room;
}
async function requireBooking(client, hotelId, id) {
  const booking=await client.room_booking.findFirst({where:{id,hotel_id:hotelId},select:bookingFields});
  if(!booking) throw new AppError("Room booking not found.",{code:"ROOM_BOOKING_NOT_FOUND",statusCode:404});
  return booking;
}
function requireActiveRoom(room) { if (room.status !== "active") conflict("This room is inactive and cannot accept a booking or check-in.", "ROOM_NOT_ACTIVE"); }
function bookingNumber() { return `BK-${randomUUID()}`; }
async function lockHotel(tx, hotelId) {
  const rows = await tx.$queryRaw`SELECT id FROM hotel WHERE id = ${hotelId}::uuid FOR UPDATE`;
  if (!rows.length) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
}
function validateCapacity(input, room, current) {
  const adults = input.adults ?? current?.adults ?? 1;
  const children = input.children ?? current?.children ?? 0;
  const guests = adults + children;
  if (adults < 0 || children < 0 || guests < 1 || guests > room.capacity) throw new AppError("Total occupants must be at least one and must not exceed room capacity.", { code: "ROOM_CAPACITY_EXCEEDED", statusCode: 400 });
}
function validateDates(from, to) {
  if (!isBookingDate(from) || !isBookingDate(to) || to <= from) throw new AppError("booking_from and booking_to must be canonical calendar dates, and booking_to must be after booking_from.", { code: "INVALID_BOOKING_DATES", statusCode: 400 });
}
async function ensureNoOverlap(client, hotelId, roomId, from, to, excludeId) {
  const overlap = await client.room_booking.findFirst({ where: { hotel_id:hotelId, room_id:roomId, ...(excludeId?{id:{not:excludeId}}:{}), OR:[{status:"checked-in"},{status:{in:SCHEDULED_STATUSES},booking_from:{lt:to},booking_to:{gt:from}}] }, select:{booking_number:true,status:true} });
  if (overlap?.status === "checked-in") conflict(`This room remains occupied until checkout (${overlap.booking_number}).`, "ROOM_OPERATIONALLY_OCCUPIED");
  if (overlap) conflict(`This room is already reserved during the requested stay (${overlap.booking_number}).`, "ROOM_BOOKING_OVERLAP");
}
function isDatabaseOverlap(error) {
  const details = [error?.code,error?.message,error?.meta?.code,error?.meta?.message,error?.meta?.database_error,error?.cause?.code,error?.cause?.message].filter(Boolean).join(" ");
  return details.includes("23P01") || details.includes("room_booking_no_overlap");
}
async function bookingTransaction(work) {
  try { return await prisma.$transaction(work); }
  catch (error) { if (isDatabaseOverlap(error)) conflict("This room is already reserved during the requested stay.", "ROOM_BOOKING_OVERLAP"); throw error; }
}
function statusData(status, current) {
  if (!status) return {};
  const data = { status };
  if (status !== current?.status) {
    if (status === "checked-in" && !current?.checked_in_at) data.checked_in_at = new Date();
    if (status === "checked-out" && !current?.checked_out_at) data.checked_out_at = new Date();
  }
  return data;
}
function withDerivedAmounts(input, room, current) {
  const result = { ...input };
  result.room_rate = current?.room_rate?.toFixed(2) ?? room.base_price.toFixed(2);
  const from = input.booking_from ?? current?.booking_from;
  const to = input.booking_to ?? current?.booking_to;
  validateDates(from, to);
  if (current && !Object.hasOwn(input, "booking_from") && !Object.hasOwn(input, "booking_to")) {
    result.total_amount = current.total_amount.toFixed(2);
    return result;
  }
  const nights = bookingNights(from, to);
  if (!Number.isSafeInteger(nights) || nights <= 0) throw new AppError("A room booking must contain at least one night.", { code:"INVALID_BOOKING_DATES", statusCode:400 });
  const rate = current?.room_rate ?? room.base_price;
  const total = rate.mul(nights);
  if (total.gt("9999999999.99")) throw new AppError("Booking amount exceeds the supported range.", { code:"INVALID_BOOKING_AMOUNT", statusCode:400 });
  result.total_amount = total.toFixed(2);
  return result;
}
function validateCheckInWindow(booking, timeZone, now = new Date()) {
  const today = hotelDateKey(now, timeZone);
  if (today < bookingDateKey(booking.booking_from) || today >= bookingDateKey(booking.booking_to)) conflict("Check-in is allowed from the arrival date until before the checkout date.", "BOOKING_CHECK_IN_WINDOW_INVALID");
}
function assertEditable(current, input) {
  const allowed = ["reserved","confirmed"].includes(current.status) ? EDITABLE_BEFORE_CHECK_IN : current.status === "checked-in" ? EDITABLE_AFTER_CHECK_IN : null;
  if (!allowed) conflict("Checked-out and cancelled bookings are immutable history.", "ROOM_BOOKING_IMMUTABLE");
  const forbidden = Object.keys(input).filter(field => !allowed.has(field));
  if (forbidden.length) conflict(`These fields cannot be changed while the booking is ${current.status}: ${forbidden.join(", ")}.`, "ROOM_BOOKING_LIFECYCLE_CONFLICT");
}
function assertTransition(current, next) { if (current !== next && !NEXT_STATUSES[current]?.has(next)) conflict(`A booking cannot change from ${current} to ${next}.`, "INVALID_ROOM_BOOKING_STATUS_TRANSITION"); }

export async function getRoomBookingWorkspace(hotelId) {
  await requireHotel(prisma,hotelId);
  const [room_bookings,rooms]=await Promise.all([prisma.room_booking.findMany({where:{hotel_id:hotelId,room:{is:{hotel_id:hotelId}}},orderBy:{created_at:"desc"},select:bookingFields}),prisma.room.findMany({where:{hotel_id:hotelId},orderBy:{room_number:"asc"},select:roomsFields})]);
  return {room_bookings:room_bookings.map(serialize),rooms:rooms.map(room=>({...room,base_price:room.base_price.toFixed(2)}))};
}
export async function getRoomAvailability(hotelId, { from, to, bookingId, capacity }) {
  await requireHotel(prisma, hotelId); validateDates(from,to);
  if (bookingId) await requireBooking(prisma,hotelId,bookingId);
  const rooms=await prisma.room.findMany({where:{hotel_id:hotelId,status:"active",...(capacity?{capacity:{gte:capacity}}:{}),room_booking:{none:{...(bookingId?{id:{not:bookingId}}:{}),OR:[{status:"checked-in"},{status:{in:SCHEDULED_STATUSES},booking_from:{lt:to},booking_to:{gt:from}}]}}},orderBy:{room_number:"asc"},select:roomsFields});
  return rooms.map(room=>({...room,base_price:room.base_price.toFixed(2)}));
}
export async function createRoomBooking(hotelId,input) {
  return bookingTransaction(async tx=>{await lockHotel(tx,hotelId);const room=await requireRoom(tx,hotelId,input.room_id);requireActiveRoom(room);validateDates(input.booking_from,input.booking_to);validateCapacity(input,room);if(RESERVING_STATUSES.includes(input.status))await ensureNoOverlap(tx,hotelId,room.id,input.booking_from,input.booking_to);const customer=await resolveBookingCustomer(tx,hotelId,{name:input.customer_name,phone:input.customer_phone,email:input.customer_email});const data=withDerivedAmounts(input,room);const booking=await tx.room_booking.create({data:{id:randomUUID(),hotel_id:hotelId,booking_number:bookingNumber(),...data,...statusData(input.status),customer_id:customer.id,paid_amount:"0.00",payment_status:"pending"},select:bookingFields});if(["reserved","confirmed"].includes(booking.status))await notifyActiveReceptionUsers(tx,hotelId,{eventKey:`booking-created:${booking.id}`,type:"booking",title:"New Room Booking",message:`Booking ${booking.booking_number} has been created for Room ${booking.room.room_number}.`});return serialize(booking);});
}
export async function updateRoomBooking(hotelId,id,input) {
  return bookingTransaction(async tx=>{await lockHotel(tx,hotelId);const current=await requireBooking(tx,hotelId,id);assertEditable(current,input);const room=await requireRoom(tx,hotelId,input.room_id||current.room_id);if(current.status!=="checked-in")requireActiveRoom(room);const from=input.booking_from||current.booking_from,to=input.booking_to||current.booking_to;validateDates(from,to);validateCapacity(input,room,current);if(RESERVING_STATUSES.includes(current.status))await ensureNoOverlap(tx,hotelId,room.id,from,to,id);await tx.room_booking.updateMany({where:{id,hotel_id:hotelId},data:withDerivedAmounts(input,room,current)});return serialize(await requireBooking(tx,hotelId,id));});
}
export async function updateRoomBookingStatus(hotelId,id,status) {
  return bookingTransaction(async tx=>{await lockHotel(tx,hotelId);const hotel=await requireHotel(tx,hotelId);const current=await requireBooking(tx,hotelId,id);if(current.status===status)return serialize(current);assertTransition(current.status,status);if(RESERVING_STATUSES.includes(status)){const room=await requireRoom(tx,hotelId,current.room_id);requireActiveRoom(room);validateCapacity({},room,current);await ensureNoOverlap(tx,hotelId,room.id,current.booking_from,current.booking_to,id);if(status==="checked-in")validateCheckInWindow(current,hotel.timezone);}await tx.room_booking.updateMany({where:{id,hotel_id:hotelId},data:statusData(status,current)});const booking=await requireBooking(tx,hotelId,id);const notification=current.status==="reserved"&&status==="confirmed"?{eventKey:`booking-confirmed:${booking.id}`,type:"booking",title:"Booking Confirmed",message:`Booking ${booking.booking_number} for Room ${booking.room.room_number} has been confirmed.`}:current.status==="confirmed"&&status==="checked-in"?{eventKey:`booking-checked-in:${booking.id}`,type:"booking",title:"Guest Checked In",message:`Guest checked in for Booking ${booking.booking_number}, Room ${booking.room.room_number}.`}:current.status==="checked-in"&&status==="checked-out"?{eventKey:`booking-checked-out:${booking.id}`,type:"booking",title:"Guest Checked Out",message:`Guest checked out from Booking ${booking.booking_number}, Room ${booking.room.room_number}.`}:null;if(notification)await notifyActiveReceptionUsers(tx,hotelId,notification);return serialize(booking);});
}
export async function deleteRoomBooking(hotelId,id) { return prisma.$transaction(async tx=>{await requireHotel(tx,hotelId);const booking=await tx.room_booking.findFirst({where:{id,hotel_id:hotelId},select:{...bookingFields,bill:{select:{id:true}},_count:{select:{orders:true}}}});if(!booking)throw new AppError("Room booking not found.",{code:"ROOM_BOOKING_NOT_FOUND",statusCode:404});if(booking.bill)throw new AppError("Room booking cannot be deleted while billing history references it.",{code:"ROOM_BOOKING_HAS_BILL",statusCode:409});if(booking._count.orders)throw new AppError("Room booking cannot be deleted while orders reference it.",{code:"ROOM_BOOKING_HAS_ORDERS",statusCode:409});if(!DELETABLE_STATUSES.has(booking.status))throw new AppError("Only reserved or confirmed bookings without operational history may be deleted.",{code:"ROOM_BOOKING_DELETE_FORBIDDEN",statusCode:409});const{_count,bill,...row}=booking;const deleted=await tx.room_booking.deleteMany({where:{id,hotel_id:hotelId,status:{in:["reserved","confirmed"]},orders:{none:{}},bill:null}});if(deleted.count!==1)throw new AppError("Room booking changed and can no longer be deleted.",{code:"ROOM_BOOKING_DELETE_CONFLICT",statusCode:409});return serialize(row);}); }
