import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "../config/audit.js";
import { ADMIN_INVITATION_EXPIRY_HOURS, ADMIN_INVITATION_STATUSES } from "../config/adminInvitations.js";
import { HOTEL_STATUSES } from "../config/hotelLifecycle.js";
import { ASSIGNMENT_STATUSES, ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { consumeInvitationAdministration } from "../middleware/authRateLimit.js";
import { createAuditEvent } from "./auditService.js";
import { createPendingAdminInvitationDelivery } from "./adminInvitationDelivery.js";
import { assertCanIncreaseHotelRole, lockHotelEntitlement } from "./hotelEntitlementService.js";
import { setHotelPlanInTransaction } from "./hotelPlanService.js";

const invitationSelection = {
  id: true,
  hotel_id: true,
  user_id: true,
  user_role_id: true,
  email_snapshot: true,
  token_hash: true,
  status: true,
  expires_at: true,
  created_by: true,
  created_at: true,
  accepted_at: true,
  revoked_at: true,
  superseded_at: true,
  hotel: { select: { code: true, id: true, name: true, plan: true, status: true } },
  user: { select: { email: true, id: true, is_active: true, name: true, password_hash: true, phone: true } },
  assignment: {
    select: {
      hotel_id: true,
      id: true,
      role_id: true,
      role_scope: true,
      status: true,
      user_id: true,
      role: { select: { scope: true, system_key: true } },
    },
  },
};

function tokenPair() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: createHash("sha256").update(token).digest("hex") };
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function expiresAt(createdAt) {
  return new Date(createdAt.getTime() + ADMIN_INVITATION_EXPIRY_HOURS * 60 * 60 * 1000);
}

function genericInvalid() {
  return new AppError("This invitation is invalid or no longer available.", {
    code: "ADMIN_INVITATION_INVALID",
    statusCode: 404,
  });
}

function conflict(message, code = "ADMIN_INVITATION_CONFLICT") {
  return new AppError(message, { code, statusCode: 409 });
}

function derivedStatus(invitation, now = new Date()) {
  return invitation.status === ADMIN_INVITATION_STATUSES.PENDING && invitation.expires_at <= now
    ? "EXPIRED"
    : invitation.status;
}

function serialize(invitation) {
  return {
    id: invitation.id,
    email: invitation.email_snapshot,
    role: ROLE_KEYS.HOTEL_ADMIN,
    status: derivedStatus(invitation),
    created_at: invitation.created_at,
    expires_at: invitation.expires_at,
    accepted_at: invitation.accepted_at,
    revoked_at: invitation.revoked_at,
    superseded_at: invitation.superseded_at,
  };
}

function serializePublic(invitation) {
  return {
    hotel: { code: invitation.hotel.code, name: invitation.hotel.name, plan: invitation.hotel.plan },
    email: invitation.email_snapshot,
    role: ROLE_KEYS.HOTEL_ADMIN,
    expires_at: invitation.expires_at,
  };
}

function assertExactPendingState(invitation, now = new Date()) {
  if (
    !invitation
    || invitation.status !== ADMIN_INVITATION_STATUSES.PENDING
    || invitation.expires_at <= now
    || invitation.hotel.status !== HOTEL_STATUSES.ACTIVE
    || invitation.user.email !== invitation.email_snapshot
    || invitation.user.is_active !== false
    || invitation.user.password_hash !== null
    || invitation.assignment.id !== invitation.user_role_id
    || invitation.assignment.user_id !== invitation.user_id
    || invitation.assignment.hotel_id !== invitation.hotel_id
    || invitation.assignment.status !== ASSIGNMENT_STATUSES.PENDING
    || invitation.assignment.role_scope !== ROLE_SCOPES.HOTEL
    || invitation.assignment.role.system_key !== ROLE_KEYS.HOTEL_ADMIN
    || invitation.assignment.role.scope !== ROLE_SCOPES.HOTEL
  ) throw genericInvalid();
}

async function lockHotel(transaction, hotelId, { requireActive = true } = {}) {
  const rows = await transaction.$queryRaw`
    SELECT id, status FROM hotel WHERE id = ${hotelId}::uuid FOR SHARE
  `;
  if (!rows[0]) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
  if (requireActive && rows[0].status !== HOTEL_STATUSES.ACTIVE) {
    throw new AppError("Hotel operations are unavailable.", { code: "HOTEL_INACTIVE", statusCode: 403 });
  }
}

async function hotelAdminRole(transaction) {
  const role = await transaction.role.findUnique({ where: { system_key: ROLE_KEYS.HOTEL_ADMIN } });
  if (!role || role.scope !== ROLE_SCOPES.HOTEL || !role.is_protected) {
    throw new AppError("Hotel Admin role configuration is unavailable.", { code: "ROLE_CONFIGURATION_ERROR", statusCode: 500 });
  }
  return role;
}

async function selectedInvitation(transaction, invitationId) {
  return transaction.admin_invitation.findUnique({ where: { id: invitationId }, select: invitationSelection });
}

async function lockInvitation(transaction, invitationId) {
  const rows = await transaction.$queryRaw`
    SELECT id FROM admin_invitation WHERE id = ${invitationId}::uuid FOR UPDATE
  `;
  if (!rows[0]) throw new AppError("Invitation not found.", { code: "ADMIN_INVITATION_NOT_FOUND", statusCode: 404 });
  return selectedInvitation(transaction, invitationId);
}

async function lockInvitationByHash(transaction, tokenHash) {
  const rows = await transaction.$queryRaw`
    SELECT id FROM admin_invitation WHERE token_hash = ${tokenHash} FOR UPDATE
  `;
  if (!rows[0]) throw genericInvalid();
  return selectedInvitation(transaction, rows[0].id);
}

async function invitationHotelByHash(transaction, tokenHash) {
  const invitation = await transaction.admin_invitation.findUnique({
    where: { token_hash: tokenHash },
    select: { hotel_id: true },
  });
  if (!invitation) throw genericInvalid();
  return invitation.hotel_id;
}

function requireInvitationScope(invitation, scopedHotelId) {
  if (scopedHotelId !== null && invitation.hotel_id !== scopedHotelId) {
    throw new AppError("The requested invitation is outside the authenticated hotel scope.", {
      code: "HOTEL_SCOPE_MISMATCH",
      statusCode: 403,
    });
  }
}

function translateCreateError(error) {
  if (error?.code === "P2002") {
    return conflict("An invitation or identity already exists for this email.", "ADMIN_INVITATION_IDENTITY_CONFLICT");
  }
  return error;
}

export async function createAdminInvitation({ actor, requestContext, hotelId, input }) {
  const secret = tokenPair();
  try {
    const invitation = await prisma.$transaction(async transaction => {
      await lockHotel(transaction, hotelId);
      const role = await hotelAdminRole(transaction);
      const pending = await transaction.admin_invitation.findFirst({
        where: { hotel_id: hotelId, email_snapshot: input.email, status: ADMIN_INVITATION_STATUSES.PENDING },
        select: { id: true },
      });
      if (pending) throw conflict("A pending Hotel Admin invitation already exists for this email.", "ADMIN_INVITATION_PENDING");

      const existingUser = await transaction.users.findUnique({ where: { email: input.email }, select: { id: true } });
      if (existingUser) {
        throw conflict(
          "This email already belongs to an existing account whose assignment context requires a future selection workflow.",
          "ADMIN_INVITATION_IDENTITY_CONFLICT",
        );
      }

      const userId = randomUUID();
      const assignmentId = randomUUID();
      const now = new Date();
      await transaction.users.create({
        data: { id: userId, email: input.email, name: input.fullName, phone: input.mobileNumber, password_hash: null, is_active: false },
      });
      await transaction.user_role.create({
        data: {
          id: assignmentId,
          user_id: userId,
          role_id: role.id,
          role_scope: ROLE_SCOPES.HOTEL,
          status: ASSIGNMENT_STATUSES.PENDING,
          hotel_id: hotelId,
        },
      });
      const invitation = await transaction.admin_invitation.create({
        data: {
          id: randomUUID(),
          hotel_id: hotelId,
          user_id: userId,
          user_role_id: assignmentId,
          email_snapshot: input.email,
          token_hash: secret.tokenHash,
          status: ADMIN_INVITATION_STATUSES.PENDING,
          expires_at: expiresAt(now),
          created_by: actor.userId,
          created_at: now,
        },
        select: invitationSelection,
      });
      await createAuditEvent(transaction, {
        action: AUDIT_ACTIONS.HOTEL_ADMIN_INVITATION_CREATED,
        actor,
        hotelId,
        metadata: { invitee_email: invitation.email_snapshot, role: ROLE_KEYS.HOTEL_ADMIN },
        requestContext,
        targetId: invitation.id,
        targetType: AUDIT_TARGET_TYPES.ADMIN_INVITATION,
      });
      return invitation;
    });
    return { invitation: serialize(invitation), delivery: createPendingAdminInvitationDelivery(secret.token) };
  } catch (error) {
    throw translateCreateError(error);
  }
}

export async function listAdminInvitations(hotelId) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { id: true } });
  if (!hotel) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
  const invitations = await prisma.admin_invitation.findMany({
    where: { hotel_id: hotelId },
    orderBy: [{ created_at: "desc" }, { id: "asc" }],
    select: invitationSelection,
  });
  return invitations.map(serialize);
}

export async function validateAdminInvitation(token) {
  const invitation = await prisma.admin_invitation.findUnique({
    where: { token_hash: hashToken(token) },
    select: invitationSelection,
  });
  assertExactPendingState(invitation);
  return serializePublic(invitation);
}

export async function acceptAdminInvitation(token, input, requestContext, { hashPassword = argon2.hash } = {}) {
  return prisma.$transaction(async transaction => {
    const hotelId = await invitationHotelByHash(transaction, hashToken(token));
    const hotel = await lockHotelEntitlement(transaction, hotelId);
    const invitation = await lockInvitationByHash(transaction, hashToken(token));
    assertExactPendingState(invitation);
    await transaction.$queryRaw`SELECT id FROM users WHERE id = ${invitation.user_id}::uuid FOR UPDATE`;
    await transaction.$queryRaw`SELECT id FROM user_role WHERE id = ${invitation.user_role_id}::uuid FOR UPDATE`;
    const locked = await selectedInvitation(transaction, invitation.id);
    assertExactPendingState(locked);
    await assertCanIncreaseHotelRole(transaction, locked.hotel_id, ROLE_KEYS.HOTEL_ADMIN, { lockedHotel: hotel });
    const passwordHash = await hashPassword(input.password, { type: argon2.argon2id });
    const now = new Date();
    await transaction.users.update({
      where: { id: locked.user_id },
      data: { name: input.fullName, phone: input.mobileNumber, password_hash: passwordHash, is_active: true, updated_at: now },
    });
    await transaction.user_role.update({ where: { id: locked.user_role_id }, data: { status: ASSIGNMENT_STATUSES.ACTIVE } });
    const accepted = await transaction.admin_invitation.update({
      where: { id: locked.id },
      data: { status: ADMIN_INVITATION_STATUSES.ACCEPTED, accepted_at: now },
      select: invitationSelection,
    });
    await createAuditEvent(transaction, {
      action: AUDIT_ACTIONS.HOTEL_ADMIN_INVITATION_ACCEPTED,
      actor: null,
      hotelId: accepted.hotel_id,
      metadata: { invitee_email: accepted.email_snapshot, role: ROLE_KEYS.HOTEL_ADMIN },
      requestContext,
      targetId: accepted.id,
      targetType: AUDIT_TARGET_TYPES.ADMIN_INVITATION,
    });
    return { invitation: serialize(accepted), requires_login: true };
  });
}

export async function selectAdminInvitationPlan(token, plan, requestContext) {
  return prisma.$transaction(async transaction => {
    const tokenHash = hashToken(token);
    const hotelId = await invitationHotelByHash(transaction, tokenHash);
    await lockHotelEntitlement(transaction, hotelId);
    const invitation = await lockInvitationByHash(transaction, tokenHash);
    assertExactPendingState(invitation);
    const result = await setHotelPlanInTransaction(transaction, hotelId, plan, {
      actor: null,
      requestContext,
    });
    return { ...result, hotel: { code: invitation.hotel.code, name: invitation.hotel.name } };
  });
}

export async function resendAdminInvitation({ actor, requestContext, invitationId, scopedHotelId = null }) {
  const secret = tokenPair();
  const replacement = await prisma.$transaction(async transaction => {
    const current = await lockInvitation(transaction, invitationId);
    requireInvitationScope(current, scopedHotelId);
    consumeInvitationAdministration(actor.userId, current.hotel_id, current.email_snapshot);
    if (current.status !== ADMIN_INVITATION_STATUSES.PENDING) {
      throw conflict("Only a pending invitation can be resent.", "ADMIN_INVITATION_NOT_PENDING");
    }
    await lockHotel(transaction, current.hotel_id);
    if (current.assignment.status !== ASSIGNMENT_STATUSES.PENDING) throw conflict("The invitation assignment is no longer pending.");
    const now = new Date();
    await transaction.admin_invitation.update({
      where: { id: current.id },
      data: { status: ADMIN_INVITATION_STATUSES.SUPERSEDED, superseded_at: now },
    });
    const invitation = await transaction.admin_invitation.create({
      data: {
        id: randomUUID(),
        hotel_id: current.hotel_id,
        user_id: current.user_id,
        user_role_id: current.user_role_id,
        email_snapshot: current.email_snapshot,
        token_hash: secret.tokenHash,
        status: ADMIN_INVITATION_STATUSES.PENDING,
        expires_at: expiresAt(now),
        created_by: actor.userId,
        created_at: now,
      },
      select: invitationSelection,
    });
    await createAuditEvent(transaction, {
      action: AUDIT_ACTIONS.HOTEL_ADMIN_INVITATION_RESENT,
      actor,
      hotelId: invitation.hotel_id,
      metadata: {
        invitee_email: invitation.email_snapshot,
        replacement_invitation_id: invitation.id,
        role: ROLE_KEYS.HOTEL_ADMIN,
        superseded_invitation_id: current.id,
      },
      requestContext,
      targetId: invitation.id,
      targetType: AUDIT_TARGET_TYPES.ADMIN_INVITATION,
    });
    return invitation;
  });
  return { invitation: serialize(replacement), delivery: createPendingAdminInvitationDelivery(secret.token) };
}

export async function revokeAdminInvitation({ actor, requestContext, invitationId, scopedHotelId = null }) {
  return prisma.$transaction(async transaction => {
    const current = await lockInvitation(transaction, invitationId);
    requireInvitationScope(current, scopedHotelId);
    if (current.status === ADMIN_INVITATION_STATUSES.REVOKED) return { changed: false, invitation: serialize(current) };
    if (current.status !== ADMIN_INVITATION_STATUSES.PENDING) {
      throw conflict("Only a pending invitation can be revoked.", "ADMIN_INVITATION_NOT_PENDING");
    }
    const revoked = await transaction.admin_invitation.update({
      where: { id: current.id },
      data: { status: ADMIN_INVITATION_STATUSES.REVOKED, revoked_at: new Date() },
      select: invitationSelection,
    });
    await createAuditEvent(transaction, {
      action: AUDIT_ACTIONS.HOTEL_ADMIN_INVITATION_REVOKED,
      actor,
      hotelId: revoked.hotel_id,
      metadata: { invitee_email: revoked.email_snapshot, role: ROLE_KEYS.HOTEL_ADMIN },
      requestContext,
      targetId: revoked.id,
      targetType: AUDIT_TARGET_TYPES.ADMIN_INVITATION,
    });
    return { changed: true, invitation: serialize(revoked) };
  });
}
