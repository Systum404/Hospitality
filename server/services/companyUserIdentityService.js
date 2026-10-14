import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "../config/audit.js";
import { ASSIGNMENT_STATUSES, HOTEL_ASSIGNABLE_ROLE_KEYS, ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { createAuditEvent } from "./auditService.js";
import { assertCanIncreaseHotelRole, lockHotelEntitlements } from "./hotelEntitlementService.js";

const identityProjection = {
  email: true,
  id: true,
  is_active: true,
  name: true,
  password_change_required: true,
  phone: true,
  user_role: {
    orderBy: { id: "asc" },
    select: {
      hotel_id: true,
      id: true,
      role_id: true,
      role_scope: true,
      restore_on_identity_reactivation: true,
      status: true,
      role: { select: { scope: true, system_key: true } },
    },
  },
};

function identityNotFound() {
  return new AppError("User identity not found.", {
    code: "USER_IDENTITY_NOT_FOUND",
    statusCode: 404,
  });
}

function invalidIdentityTarget() {
  return new AppError("The user is not an eligible staff identity lifecycle target.", {
    code: "INVALID_IDENTITY_LIFECYCLE_TARGET",
    statusCode: 409,
  });
}

function finalSuperAdminError() {
  return new AppError("The final active Super Admin identity cannot be deactivated.", {
    code: "FINAL_ACTIVE_SUPER_ADMIN_REQUIRED",
    statusCode: 409,
  });
}

function selfPasswordResetError() {
  return new AppError("A Super Admin cannot reset their own password through the company reset endpoint.", {
    code: "SELF_PASSWORD_RESET_FORBIDDEN",
    statusCode: 409,
  });
}

function assignmentHasRole(assignment, roleKey, scope) {
  return assignment.role_scope === scope
    && assignment.role.scope === scope
    && assignment.role.system_key === roleKey;
}

function targetRoles(identity) {
  return {
    hotelStaff: identity.user_role.some(assignment => assignment.role_scope === ROLE_SCOPES.HOTEL
      && assignment.role.scope === ROLE_SCOPES.HOTEL
      && HOTEL_ASSIGNABLE_ROLE_KEYS.has(assignment.role.system_key)),
    superAdmin: identity.user_role.some(assignment => assignmentHasRole(
      assignment,
      ROLE_KEYS.SUPER_ADMIN,
      ROLE_SCOPES.COMPANY,
    )),
  };
}

function hasActiveSuperAdminAssignment(identity) {
  return identity.user_role.some(assignment => assignment.status === ASSIGNMENT_STATUSES.ACTIVE
    && assignmentHasRole(assignment, ROLE_KEYS.SUPER_ADMIN, ROLE_SCOPES.COMPANY));
}

function serialize(identity) {
  return {
    email: identity.email,
    id: identity.id,
    is_active: identity.is_active,
    name: identity.name,
    phone: identity.phone,
  };
}

async function lockIdentity(transaction, userId) {
  const locked = await transaction.$queryRaw`
    SELECT id
    FROM users
    WHERE id = ${userId}::uuid
    FOR UPDATE
  `;
  if (!locked[0]) throw identityNotFound();

  const identity = await transaction.users.findUnique({
    where: { id: userId },
    select: identityProjection,
  });
  if (!identity) throw identityNotFound();
  return identity;
}

async function lockHotelAssignments(transaction, userId) {
  await transaction.$queryRaw`
    SELECT ur.id
    FROM user_role ur
    JOIN role r ON r.id = ur.role_id AND r.scope = ur.role_scope
    WHERE ur.user_id = ${userId}::uuid
      AND ur.role_scope = ${ROLE_SCOPES.HOTEL}::role_scope
      AND r.system_key IN (${ROLE_KEYS.HOTEL_ADMIN}, ${ROLE_KEYS.MANAGER}, ${ROLE_KEYS.RECEPTION}, ${ROLE_KEYS.CAPTAIN}, ${ROLE_KEYS.KITCHEN})
    ORDER BY ur.id
    FOR UPDATE OF ur
  `;
}

async function lockSuperAdminRole(transaction) {
  // The protected role row is the company-wide mutex for concurrent Super Admin
  // identity deactivations. Target-row locks alone cannot prevent two different
  // active Super Admin identities from being disabled concurrently.
  const roleLock = await transaction.$queryRaw`
    SELECT id
    FROM role
    WHERE system_key = ${ROLE_KEYS.SUPER_ADMIN}
      AND scope = ${ROLE_SCOPES.COMPANY}::role_scope
    FOR UPDATE
  `;
  if (!roleLock[0]) throw finalSuperAdminError();
}

async function protectFinalSuperAdmin(transaction, identity, { roleLocked = false } = {}) {
  if (!identity.is_active || identity.password_change_required || !hasActiveSuperAdminAssignment(identity)) return;

  if (!roleLocked) await lockSuperAdminRole(transaction);

  const counts = await transaction.$queryRaw`
    SELECT COUNT(DISTINCT u.id)::integer AS count
    FROM users u
    JOIN user_role ur ON ur.user_id = u.id
    JOIN role r ON r.id = ur.role_id AND r.scope = ur.role_scope
    WHERE u.is_active = true
      AND u.password_change_required = false
      AND ur.status = ${ASSIGNMENT_STATUSES.ACTIVE}::assignment_status
      AND ur.role_scope = ${ROLE_SCOPES.COMPANY}::role_scope
      AND r.system_key = ${ROLE_KEYS.SUPER_ADMIN}
      AND r.scope = ${ROLE_SCOPES.COMPANY}::role_scope
  `;
  if ((counts[0]?.count ?? 0) <= 1) throw finalSuperAdminError();
}

async function transitionIdentity(userId, targetActive, audit) {
  return prisma.$transaction(async transaction => {
    const preview = await transaction.users.findUnique({ where: { id: userId }, select: identityProjection });
    if (!preview) throw identityNotFound();
    const previewRoles = targetRoles(preview);
    if (!previewRoles.hotelStaff && !previewRoles.superAdmin) throw invalidIdentityTarget();
    const affectedAssignments = preview.user_role.filter(assignment => assignment.role_scope === ROLE_SCOPES.HOTEL
      && assignment.role.scope === ROLE_SCOPES.HOTEL
      && HOTEL_ASSIGNABLE_ROLE_KEYS.has(assignment.role.system_key)
      && (targetActive
        ? assignment.status === ASSIGNMENT_STATUSES.INACTIVE && assignment.restore_on_identity_reactivation
        : assignment.status === ASSIGNMENT_STATUSES.ACTIVE));
    const lockedHotels = await lockHotelEntitlements(transaction, affectedAssignments.map(assignment => assignment.hotel_id));
    const superAdminRoleLocked = !targetActive && previewRoles.superAdmin;
    if (superAdminRoleLocked) await lockSuperAdminRole(transaction);
    const identity = await lockIdentity(transaction, userId);
    const roles = targetRoles(identity);
    if (!roles.hotelStaff && !roles.superAdmin) throw invalidIdentityTarget();

    if (identity.is_active === targetActive) {
      return { changed: false, identity: serialize(identity) };
    }

    if (!targetActive) await protectFinalSuperAdmin(transaction, identity, { roleLocked: superAdminRoleLocked });
    await lockHotelAssignments(transaction, identity.id);

    let restoredAssignments = 0;
    let deactivatedAssignments = 0;
    if (targetActive) {
      const restoring = identity.user_role.filter(assignment => assignment.role_scope === ROLE_SCOPES.HOTEL
        && assignment.role.scope === ROLE_SCOPES.HOTEL
        && HOTEL_ASSIGNABLE_ROLE_KEYS.has(assignment.role.system_key)
        && assignment.status === ASSIGNMENT_STATUSES.INACTIVE
        && assignment.restore_on_identity_reactivation);
      for (const assignment of restoring) {
        await assertCanIncreaseHotelRole(transaction, assignment.hotel_id, assignment.role.system_key, {
          lockedHotel: lockedHotels.get(assignment.hotel_id),
        });
      }
      const restored = await transaction.user_role.updateMany({
        where: {
          user_id: identity.id,
          role_scope: ROLE_SCOPES.HOTEL,
          status: ASSIGNMENT_STATUSES.INACTIVE,
          restore_on_identity_reactivation: true,
          role: { system_key: { in: [...HOTEL_ASSIGNABLE_ROLE_KEYS] }, scope: ROLE_SCOPES.HOTEL },
        },
        data: {
          restore_on_identity_reactivation: false,
          status: ASSIGNMENT_STATUSES.ACTIVE,
        },
      });
      restoredAssignments = restored.count;
    } else {
      const deactivated = await transaction.user_role.updateMany({
        where: {
          user_id: identity.id,
          role_scope: ROLE_SCOPES.HOTEL,
          status: ASSIGNMENT_STATUSES.ACTIVE,
          role: { system_key: { in: [...HOTEL_ASSIGNABLE_ROLE_KEYS] }, scope: ROLE_SCOPES.HOTEL },
        },
        data: {
          restore_on_identity_reactivation: true,
          status: ASSIGNMENT_STATUSES.INACTIVE,
        },
      });
      deactivatedAssignments = deactivated.count;
      await transaction.auth_context_challenge.deleteMany({ where: { user_id: identity.id } });
      await transaction.password_change_challenge.deleteMany({ where: { user_id: identity.id } });
    }

    const updated = await transaction.users.update({
      where: { id: identity.id },
      data: {
        is_active: targetActive,
        updated_at: new Date(),
        ...(!targetActive ? { credential_version: { increment: 1 } } : {}),
      },
      select: identityProjection,
    });
    await createAuditEvent(transaction, {
      ...audit,
      action: targetActive
        ? AUDIT_ACTIONS.HOTEL_ADMIN_IDENTITY_REACTIVATED
        : AUDIT_ACTIONS.HOTEL_ADMIN_IDENTITY_DEACTIVATED,
      hotelId: null,
      metadata: {
        current_active: String(targetActive),
        previous_active: String(identity.is_active),
      },
      targetId: identity.id,
      targetType: AUDIT_TARGET_TYPES.USER_IDENTITY,
    });
    return {
      changed: true,
      deactivatedAssignments,
      identity: serialize(updated),
      restoredAssignments,
    };
  });
}

export const deactivateCompanyUserIdentity = (userId, audit) => transitionIdentity(userId, false, audit);

export const reactivateCompanyUserIdentity = (userId, audit) => transitionIdentity(userId, true, audit);

function temporaryPassword() {
  return `Aazira-${randomBytes(24).toString("base64url")}`;
}

export async function resetCompanyUserPassword(userId, audit) {
  if (audit.actor.userId === userId) throw selfPasswordResetError();

  const plaintext = temporaryPassword();
  const passwordHash = await argon2.hash(plaintext, { type: argon2.argon2id });

  const identity = await prisma.$transaction(async transaction => {
    const current = await lockIdentity(transaction, userId);
    await protectFinalSuperAdmin(transaction, current);
    const previousState = current.password_change_required ? "RESET_REQUIRED" : "NORMAL";

    const updated = await transaction.users.update({
      where: { id: current.id },
      data: {
        credential_version: { increment: 1 },
        password_change_required: true,
        password_hash: passwordHash,
        updated_at: new Date(),
      },
      select: identityProjection,
    });
    await transaction.auth_context_challenge.deleteMany({ where: { user_id: current.id } });
    await transaction.password_change_challenge.deleteMany({ where: { user_id: current.id } });
    await createAuditEvent(transaction, {
      ...audit,
      action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
      hotelId: null,
      metadata: { current_state: "RESET_REQUIRED", previous_state: previousState },
      targetId: current.id,
      targetType: AUDIT_TARGET_TYPES.USER_IDENTITY,
    });
    return serialize(updated);
  });

  return { identity, temporaryPassword: plaintext };
}
