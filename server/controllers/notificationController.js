import { AppError } from "../middleware/errorHandler.js";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "../services/notificationService.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateNotificationHotelId(req, _res, next) {
  if (!UUID.test(req.params.hotelId || "")) return next(new AppError("hotelId must be a valid UUID.", { code: "INVALID_HOTEL_ID", statusCode: 400 }));
  return next();
}

export async function list(req, res, next) {
  try { res.json({ status: "success", data: await getNotifications(req.hotelId, req.auth.userId) }); }
  catch (error) { next(error); }
}

export async function markRead(req, res, next) {
  try {
    if (!UUID.test(req.params.notificationId || "")) throw new AppError("notificationId must be a valid UUID.", { code: "INVALID_NOTIFICATION_ID", statusCode: 400 });
    res.json({ status: "success", data: { notification: await markNotificationRead(req.hotelId, req.auth.userId, req.params.notificationId) } });
  } catch (error) { next(error); }
}

export async function markAllRead(req, res, next) {
  try { res.json({ status: "success", data: await markAllNotificationsRead(req.hotelId, req.auth.userId) }); }
  catch (error) { next(error); }
}
