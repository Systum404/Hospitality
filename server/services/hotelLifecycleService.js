import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "../config/audit.js";
import { HOTEL_STATUSES } from "../config/hotelLifecycle.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { createAuditEvent } from "./auditService.js";

async function transitionHotel(hotelId, targetStatus, audit = null) {
  return prisma.$transaction(async transaction => {
    const rows = await transaction.$queryRaw`
      SELECT id, status
      FROM hotel
      WHERE id = ${hotelId}::uuid
      FOR UPDATE
    `;
    const hotel = rows[0];
    if (!hotel) {
      throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
    }

    if (hotel.status === targetStatus) {
      return { changed: false, hotel: { id: hotel.id, status: hotel.status } };
    }

    const updated = await transaction.hotel.update({
      where: { id: hotelId },
      data: { status: targetStatus, updated_at: new Date() },
      select: { id: true, status: true },
    });
    if (audit) {
      await createAuditEvent(transaction, {
        ...audit,
        action: targetStatus === HOTEL_STATUSES.ACTIVE
          ? AUDIT_ACTIONS.HOTEL_ACTIVATED
          : AUDIT_ACTIONS.HOTEL_DEACTIVATED,
        hotelId: updated.id,
        metadata: { current_status: updated.status, previous_status: hotel.status },
        targetId: updated.id,
        targetType: AUDIT_TARGET_TYPES.HOTEL,
      });
    }
    return { changed: true, hotel: updated };
  });
}

export const activateHotel = (hotelId, audit) => transitionHotel(hotelId, HOTEL_STATUSES.ACTIVE, audit);
export const deactivateHotel = (hotelId, audit) => transitionHotel(hotelId, HOTEL_STATUSES.INACTIVE, audit);
