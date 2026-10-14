import { AUDIT_ACTIONS, AUDIT_OUTCOMES, AUDIT_TARGET_TYPES } from "../config/audit.js";
import { prisma } from "../db/prisma.js";
import { createAuditEvent } from "./auditService.js";

export async function recordPlanLimitRejection(error, req) {
  const details = error?.planAudit;
  if (!details || !req?.auditContext) return;
  await prisma.$transaction(transaction => createAuditEvent(transaction, {
    action: AUDIT_ACTIONS.HOTEL_ASSIGNMENT_LIMIT_REACHED,
    actor: req.auth || null,
    hotelId: details.hotelId,
    metadata: {
      current_count: String(details.currentCount),
      limit: String(details.limit),
      plan: details.plan,
      role: details.roleKey,
    },
    outcome: AUDIT_OUTCOMES.FAILURE,
    requestContext: req.auditContext,
    targetId: details.hotelId,
    targetType: AUDIT_TARGET_TYPES.HOTEL_ASSIGNMENT_LIMIT,
  }));
}
