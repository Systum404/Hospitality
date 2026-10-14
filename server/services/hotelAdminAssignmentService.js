import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "../config/audit.js";
import { HOTEL_STATUSES } from "../config/hotelLifecycle.js";
import { ASSIGNMENT_STATUSES, ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { createAuditEvent } from "./auditService.js";
import { assertCanIncreaseHotelRole, lockHotelEntitlement } from "./hotelEntitlementService.js";

const assignmentProjection = {
  hotel_id: true,
  id: true,
  role_scope: true,
  status: true,
  role: { select: { name: true, scope: true, system_key: true } },
  users: { select: { email: true, id: true, is_active: true, name: true, phone: true } },
};

function hotelNotFound() {
  return new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
}

function assignmentNotFound() {
  return new AppError("Hotel Admin assignment not found.", {
    code: "HOTEL_ADMIN_ASSIGNMENT_NOT_FOUND",
    statusCode: 404,
  });
}

function invalidTarget() {
  return new AppError("The assignment is not an active Hotel Admin lifecycle target.", {
    code: "INVALID_HOTEL_ADMIN_ASSIGNMENT",
    statusCode: 409,
  });
}

function serialize(assignment) {
  return {
    assignment_id: assignment.id,
    hotel_id: assignment.hotel_id,
    role: assignment.role.system_key,
    scope: assignment.role_scope,
    status: assignment.status,
    user: {
      email: assignment.users.email,
      id: assignment.users.id,
      is_active: assignment.users.is_active,
      name: assignment.users.name,
      phone: assignment.users.phone,
    },
  };
}

function isHotelAdmin(assignment, hotelId) {
  return assignment
    && assignment.hotel_id === hotelId
    && assignment.role_scope === ROLE_SCOPES.HOTEL
    && assignment.role.scope === ROLE_SCOPES.HOTEL
    && assignment.role.system_key === ROLE_KEYS.HOTEL_ADMIN;
}

async function requireHotel(transaction, hotelId, { lock = false } = {}) {
  if (lock) {
    return lockHotelEntitlement(transaction, hotelId);
  }
  if (!await transaction.hotel.findUnique({ where: { id: hotelId }, select: { id: true } })) throw hotelNotFound();
}

export async function listHotelAdmins(hotelId) {
  await requireHotel(prisma, hotelId);
  const assignments = await prisma.user_role.findMany({
    where: {
      hotel_id: hotelId,
      role_scope: ROLE_SCOPES.HOTEL,
      role: { scope: ROLE_SCOPES.HOTEL, system_key: ROLE_KEYS.HOTEL_ADMIN },
    },
    orderBy: [{ users: { name: "asc" } }, { users: { email: "asc" } }, { id: "asc" }],
    select: assignmentProjection,
  });
  return assignments.map(serialize);
}

async function transitionHotelAdmin(hotelId, assignmentId, targetStatus, audit) {
  return prisma.$transaction(async transaction => {
    const hotel = await requireHotel(transaction, hotelId, { lock: true });
    if (hotel.status !== HOTEL_STATUSES.ACTIVE) {
      throw new AppError("Hotel operations are unavailable.", { code: "HOTEL_INACTIVE", statusCode: 403 });
    }
    const locked = await transaction.$queryRaw`
      SELECT id
      FROM user_role
      WHERE id = ${assignmentId}::uuid
        AND hotel_id = ${hotelId}::uuid
      FOR UPDATE
    `;
    if (!locked[0]) throw assignmentNotFound();

    const assignment = await transaction.user_role.findUnique({
      where: { id: assignmentId },
      select: assignmentProjection,
    });
    if (!isHotelAdmin(assignment, hotelId)) throw assignmentNotFound();
    if (![ASSIGNMENT_STATUSES.ACTIVE, ASSIGNMENT_STATUSES.INACTIVE].includes(assignment.status)) throw invalidTarget();
    if (targetStatus === ASSIGNMENT_STATUSES.ACTIVE && !assignment.users.is_active) {
      throw new AppError("The target user identity is inactive.", {
        code: "HOTEL_ADMIN_IDENTITY_INACTIVE",
        statusCode: 409,
      });
    }
    if (assignment.status === targetStatus) {
      return { admin: serialize(assignment), changed: false };
    }

    if (targetStatus === ASSIGNMENT_STATUSES.ACTIVE) {
      await assertCanIncreaseHotelRole(transaction, hotelId, ROLE_KEYS.HOTEL_ADMIN, { lockedHotel: hotel });
    }

    const updated = await transaction.user_role.update({
      where: { id: assignment.id },
      data: { status: targetStatus },
      select: assignmentProjection,
    });
    await createAuditEvent(transaction, {
      ...audit,
      action: targetStatus === ASSIGNMENT_STATUSES.ACTIVE
        ? AUDIT_ACTIONS.HOTEL_ADMIN_ASSIGNMENT_REACTIVATED
        : AUDIT_ACTIONS.HOTEL_ADMIN_ASSIGNMENT_DEACTIVATED,
      hotelId,
      metadata: {
        current_status: targetStatus,
        previous_status: assignment.status,
        role: ROLE_KEYS.HOTEL_ADMIN,
        target_user_id: assignment.users.id,
      },
      targetId: assignment.id,
      targetType: AUDIT_TARGET_TYPES.HOTEL_ADMIN_ASSIGNMENT,
    });
    return { admin: serialize(updated), changed: true };
  });
}

export const deactivateHotelAdmin = (hotelId, assignmentId, audit) => transitionHotelAdmin(
  hotelId,
  assignmentId,
  ASSIGNMENT_STATUSES.INACTIVE,
  audit,
);

export const reactivateHotelAdmin = (hotelId, assignmentId, audit) => transitionHotelAdmin(
  hotelId,
  assignmentId,
  ASSIGNMENT_STATUSES.ACTIVE,
  audit,
);
