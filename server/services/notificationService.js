import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";

const selectNotification = {
  id: true,
  title: true,
  message: true,
  type: true,
  is_read: true,
  created_at: true,
};

const serialize = notification => ({
  id: notification.id,
  title: notification.title,
  message: notification.message,
  type: notification.type,
  isRead: notification.is_read,
  createdAt: notification.created_at.toISOString(),
});

async function requireHotel(hotelId) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { timezone: true } });
  if (!hotel) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
  try { new Intl.DateTimeFormat("en-US", { timeZone: hotel.timezone }).format(); }
  catch { throw new AppError("The hotel's timezone configuration is invalid.", { code: "INVALID_HOTEL_TIMEZONE", statusCode: 500 }); }
  return hotel;
}

export async function getNotifications(hotelId, userId) {
  const hotel = await requireHotel(hotelId);
  const where = { hotel_id: hotelId, user_id: userId };
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, select: selectNotification, orderBy: [{ created_at: "desc" }, { id: "desc" }], take: 50 }),
    prisma.notification.count({ where: { ...where, is_read: false } }),
  ]);
  return { notifications: notifications.map(serialize), unreadCount, timezone: hotel.timezone };
}

export async function markNotificationRead(hotelId, userId, notificationId) {
  await requireHotel(hotelId);
  const notification = await prisma.notification.findFirst({ where: { id: notificationId, hotel_id: hotelId, user_id: userId }, select: selectNotification });
  if (!notification) throw new AppError("Notification not found.", { code: "NOTIFICATION_NOT_FOUND", statusCode: 404 });
  if (notification.is_read) return serialize(notification);
  return serialize(await prisma.notification.update({ where: { id: notification.id }, data: { is_read: true }, select: selectNotification }));
}

export async function markAllNotificationsRead(hotelId, userId) {
  await requireHotel(hotelId);
  const result = await prisma.notification.updateMany({ where: { hotel_id: hotelId, user_id: userId, is_read: false }, data: { is_read: true } });
  return { updatedCount: result.count };
}
