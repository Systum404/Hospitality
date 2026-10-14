import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "../config/audit.js";
import { HOTEL_PLANS } from "../config/hotelPlans.js";
import { prisma } from "../db/prisma.js";
import { createAuditEvent } from "./auditService.js";
import { lockHotelEntitlement } from "./hotelEntitlementService.js";

export async function setHotelPlanInTransaction(transaction, hotelId, targetPlan, audit) {
  const hotel = await lockHotelEntitlement(transaction, hotelId);
  if (hotel.plan === targetPlan) return { changed: false, plan: targetPlan, previous_plan: hotel.plan };

  await transaction.hotel.update({
    where: { id: hotelId },
    data: { plan: targetPlan, updated_at: new Date() },
  });
  await createAuditEvent(transaction, {
    ...audit,
    action: hotel.plan === HOTEL_PLANS.UNASSIGNED
      ? AUDIT_ACTIONS.HOTEL_PLAN_SELECTED
      : AUDIT_ACTIONS.HOTEL_PLAN_CHANGED,
    hotelId,
    metadata: { current_plan: targetPlan, previous_plan: hotel.plan },
    targetId: hotelId,
    targetType: AUDIT_TARGET_TYPES.HOTEL,
  });
  return { changed: true, plan: targetPlan, previous_plan: hotel.plan };
}

export function setCompanyHotelPlan(hotelId, targetPlan, audit) {
  return prisma.$transaction(transaction => setHotelPlanInTransaction(transaction, hotelId, targetPlan, audit));
}
