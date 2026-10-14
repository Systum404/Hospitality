import { randomUUID } from "node:crypto";
import { ASSIGNMENT_STATUSES, ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";

function validateNotification(notification) {
  if (typeof notification.eventKey !== "string" || !notification.eventKey.trim() || notification.eventKey.length > 255) {
    throw new TypeError("A stable notification eventKey is required.");
  }
}

async function createForRecipients(client, hotelId, recipientIds, notification) {
  validateNotification(notification);
  if (!recipientIds.length) return 0;

  const result = await client.notification.createMany({
    data: recipientIds.map(user_id => ({
      id: randomUUID(),
      hotel_id: hotelId,
      user_id,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      event_key: notification.eventKey,
      is_read: false,
      action_url: null,
    })),
    skipDuplicates: true,
  });

  return result.count;
}

export async function notifyActiveHotelRoleUsers(client, hotelId, roleKey, notification) {
  validateNotification(notification);

  const assignments = await client.user_role.findMany({
    where: {
      hotel_id: hotelId,
      role_scope: ROLE_SCOPES.HOTEL,
      status: ASSIGNMENT_STATUSES.ACTIVE,
      role: { is: { system_key: roleKey } },
      users: { is: { is_active: true } },
    },
    select: { user_id: true },
    distinct: ["user_id"],
  });

  return createForRecipients(client, hotelId, assignments.map(({ user_id }) => user_id), notification);
}

export async function notifyAssignedHotelRoleUser(client, hotelId, userId, roleKey, notification) {
  validateNotification(notification);
  if (!userId) return 0;
  const assignment = await client.user_role.findFirst({
    where: {
      hotel_id: hotelId,
      user_id: userId,
      role_scope: ROLE_SCOPES.HOTEL,
      status: ASSIGNMENT_STATUSES.ACTIVE,
      role: { is: { system_key: roleKey } },
      users: { is: { is_active: true } },
    },
    select: { user_id: true },
  });
  return createForRecipients(client, hotelId, assignment ? [assignment.user_id] : [], notification);
}

export function notifyActiveReceptionUsers(client, hotelId, notification) {
  return notifyActiveHotelRoleUsers(client, hotelId, ROLE_KEYS.RECEPTION, notification);
}
