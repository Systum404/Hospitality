import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "../config/audit.js";
import { HOTEL_STATUSES } from "../config/hotelLifecycle.js";
import { HOTEL_PLANS } from "../config/hotelPlans.js";
import { isValidPassword } from "../config/passwordPolicy.js";
import { ASSIGNMENT_STATUSES, isKnownRoleDefinition, ROLE_SCOPES } from "../config/roles.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { inactiveHotelError } from "../middleware/activeHotel.js";
import { AppError } from "../middleware/errorHandler.js";
import { createAuditEvent } from "./auditService.js";

const invalidCredentials = () => new AppError("Invalid email or password.", {
  code: "INVALID_CREDENTIALS",
  statusCode: 401,
});

const dummyHash = argon2.hash("aazira-dummy-authentication-password", {
  type: argon2.argon2id,
});

function safeUser(context) {
  return {
    assignmentActive: context.assignmentActive,
    email: context.email,
    hotelId: context.hotelId,
    id: context.userId,
    name: context.name,
    role: context.role,
    roleKey: context.roleKey,
    scope: context.scope,
    userActive: context.userActive,
  };
}

function passwordChangeError() {
  return new AppError("This password-change request is invalid or no longer available.", {
    code: "PASSWORD_CHANGE_INVALID",
    statusCode: 403,
  });
}

function assignmentSelection() {
  return {
    id: true,
    hotel_id: true,
    hotel: { select: { code: true, id: true, name: true, plan: true, status: true } },
    role_scope: true,
    status: true,
    role: { select: { name: true, scope: true, system_key: true } },
  };
}

function selectionError() {
  return new AppError("This context-selection request is invalid or no longer available.", {
    code: "CONTEXT_SELECTION_INVALID",
    statusCode: 403,
  });
}

function challengeToken() {
  return randomBytes(32).toString("base64url");
}

function hashChallenge(token) {
  return createHash("sha256").update(token).digest("hex");
}

function serializeAssignment(assignment) {
  return {
    assignmentId: assignment.id,
    role: assignment.role.name,
    roleKey: assignment.role.system_key,
    scope: assignment.role.scope,
    hotel: assignment.hotel_id === null ? null : {
      code: assignment.hotel.code,
      id: assignment.hotel.id,
      name: assignment.hotel.name,
    },
  };
}

function eligibleContexts(user) {
  const eligible = [];
  let inactiveHotel = null;

  for (const assignment of user.user_role) {
    if (assignment.status !== ASSIGNMENT_STATUSES.ACTIVE) continue;
    try {
      eligible.push({ assignment, context: buildContext(user, assignment) });
    } catch (error) {
      if (error?.code === "HOTEL_INACTIVE") inactiveHotel ??= error;
    }
  }

  return { eligible, inactiveHotel };
}

async function createContextSelection(userId, assignments, remember, credentialVersion) {
  const token = challengeToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + environment.authContextChallengeTtlSeconds * 1000);

  await prisma.$transaction(async transaction => {
    await transaction.auth_context_challenge.deleteMany({ where: { expires_at: { lte: now } } });
    await transaction.auth_context_challenge.create({
      data: {
        id: randomUUID(),
        user_id: userId,
        token_hash: hashChallenge(token),
        remember,
        credential_version: credentialVersion,
        expires_at: expiresAt,
      },
    });
  });

  return {
    assignments: assignments.map(({ assignment }) => serializeAssignment(assignment)),
    challenge: token,
    expiresAt,
  };
}

async function createPasswordChangeSelection(user) {
  const token = challengeToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + environment.passwordChangeChallengeTtlSeconds * 1000);

  await prisma.$transaction(async transaction => {
    await transaction.password_change_challenge.deleteMany({ where: { expires_at: { lte: now } } });
    await transaction.password_change_challenge.upsert({
      where: { user_id: user.id },
      update: {
        credential_version: user.credential_version,
        expires_at: expiresAt,
        token_hash: hashChallenge(token),
      },
      create: {
        credential_version: user.credential_version,
        expires_at: expiresAt,
        id: randomUUID(),
        token_hash: hashChallenge(token),
        user_id: user.id,
      },
    });
  });

  return { challenge: token, expiresAt };
}

function contextError() {
  return new AppError("This account has no available authorization context.", {
    code: "ACCOUNT_CONTEXT_UNAVAILABLE",
    statusCode: 403,
  });
}

function buildContext(user, assignment) {
  const assignmentActive = assignment.status === ASSIGNMENT_STATUSES.ACTIVE;
  const userActive = user.is_active === true;
  const scopeMatches = assignment.role_scope === assignment.role.scope;
  const hotelMatchesScope = assignment.role.scope === ROLE_SCOPES.COMPANY
    ? assignment.hotel_id === null
    : assignment.role.scope === ROLE_SCOPES.HOTEL && typeof assignment.hotel_id === "string";

  if (
    assignment.role.scope === ROLE_SCOPES.HOTEL
    && hotelMatchesScope
    && assignment.hotel?.status !== HOTEL_STATUSES.ACTIVE
  ) {
    throw inactiveHotelError();
  }

  if (
    assignment.role.scope === ROLE_SCOPES.HOTEL
    && hotelMatchesScope
    && assignment.hotel?.plan === HOTEL_PLANS.UNASSIGNED
  ) {
    throw contextError();
  }

  if (
    !userActive
    || user.password_change_required === true
    || !assignmentActive
    || !scopeMatches
    || !hotelMatchesScope
    || !isKnownRoleDefinition(assignment.role.system_key, assignment.role.scope)
  ) {
    throw contextError();
  }

  return {
    assignmentActive,
    credentialVersion: user.credential_version ?? 0,
    email: user.email,
    hotelId: assignment.hotel_id,
    name: user.name,
    role: assignment.role.name,
    roleKey: assignment.role.system_key,
    scope: assignment.role.scope,
    userActive,
    userId: user.id,
    userRoleId: assignment.id,
  };
}

export async function authenticateCredentials(email, password, { remember = false } = {}) {
  const user = await prisma.users.findUnique({
    where: { email },
    select: {
      email: true,
      id: true,
      is_active: true,
      name: true,
      password_hash: true,
      credential_version: true,
      password_change_required: true,
      user_role: { select: assignmentSelection() },
    },
  });

  let passwordMatches = false;
  try {
    passwordMatches = await argon2.verify(user?.password_hash || await dummyHash, password, {
      type: argon2.argon2id,
    });
  } catch {
    passwordMatches = false;
  }

  if (!user || !passwordMatches || !user.is_active) {
    throw invalidCredentials();
  }

  if (user.password_change_required) {
    return { passwordChange: await createPasswordChangeSelection(user) };
  }

  const { eligible, inactiveHotel } = eligibleContexts(user);
  if (eligible.length === 0) {
    if (inactiveHotel) throw inactiveHotel;
    throw contextError();
  }

  if (eligible.length > 1) {
    return {
      contextSelection: await createContextSelection(user.id, eligible, remember, user.credential_version),
    };
  }

  const context = eligible[0].context;

  return { context, user: safeUser(context) };
}

export async function selectAuthenticationContext(challengeTokenValue, assignmentId) {
  const tokenHash = hashChallenge(challengeTokenValue);
  const now = new Date();

  return prisma.$transaction(async transaction => {
    const lockedChallenges = await transaction.$queryRaw`
      SELECT "id"
      FROM "auth_context_challenge"
      WHERE "token_hash" = ${tokenHash}
      FOR UPDATE
    `;
    if (lockedChallenges.length !== 1) throw selectionError();

    const challenge = await transaction.auth_context_challenge.findUnique({
      where: { token_hash: tokenHash },
      select: { credential_version: true, expires_at: true, id: true, remember: true, user_id: true },
    });
    if (!challenge || challenge.expires_at <= now) {
      if (challenge) await transaction.auth_context_challenge.delete({ where: { id: challenge.id } });
      throw selectionError();
    }

    const lockedAssignments = await transaction.$queryRaw`
      SELECT "id"
      FROM "user_role"
      WHERE "id" = ${assignmentId}::uuid AND "user_id" = ${challenge.user_id}::uuid
      FOR UPDATE
    `;
    if (lockedAssignments.length !== 1) throw selectionError();

    let assignment = await transaction.user_role.findFirst({
      where: { id: assignmentId, user_id: challenge.user_id },
      select: {
        ...assignmentSelection(),
        users: { select: { credential_version: true, email: true, id: true, is_active: true, name: true, password_change_required: true } },
      },
    });
    if (!assignment) throw selectionError();
    if (assignment.users.credential_version !== challenge.credential_version) throw selectionError();

    if (assignment.hotel_id !== null) {
      const lockedHotels = await transaction.$queryRaw`
        SELECT "id"
        FROM "hotel"
        WHERE "id" = ${assignment.hotel_id}::uuid
        FOR UPDATE
      `;
      if (lockedHotels.length !== 1) throw selectionError();
      assignment = await transaction.user_role.findFirst({
        where: { id: assignmentId, user_id: challenge.user_id },
        select: {
          ...assignmentSelection(),
          users: { select: { credential_version: true, email: true, id: true, is_active: true, name: true, password_change_required: true } },
        },
      });
    }

    let context;
    try {
      context = buildContext(assignment.users, assignment);
    } catch (error) {
      if (error?.code === "HOTEL_INACTIVE") throw error;
      throw selectionError();
    }

    const consumed = await transaction.auth_context_challenge.deleteMany({
      where: { expires_at: { gt: now }, id: challenge.id, token_hash: tokenHash },
    });
    if (consumed.count !== 1) throw selectionError();

    return { context, remember: challenge.remember, user: safeUser(context) };
  });
}

export async function recordSuccessfulLogin(userId) {
  await prisma.users.update({
    data: { last_login: new Date() },
    where: { id: userId },
  });
}

export async function resolveAuthenticationContext(userId, userRoleId, credentialVersion = 0) {
  const assignment = await prisma.user_role.findFirst({
    where: { id: userRoleId, user_id: userId },
    select: {
      ...assignmentSelection(),
      users: {
        select: {
          email: true,
          credential_version: true,
          id: true,
          is_active: true,
          name: true,
          password_change_required: true,
        },
      },
    },
  });

  if (!assignment) {
    throw new AppError("Authentication is required.", {
      code: "UNAUTHENTICATED",
      statusCode: 401,
    });
  }

  if (assignment.users.credential_version !== credentialVersion) {
    throw new AppError("Authentication is required.", {
      code: "UNAUTHENTICATED",
      statusCode: 401,
    });
  }

  let context;
  try {
    context = buildContext(assignment.users, assignment);
  } catch (error) {
    if (error?.code === "HOTEL_INACTIVE") throw error;
    throw new AppError("Authentication is required.", {
      code: "UNAUTHENTICATED",
      statusCode: 401,
    });
  }

  return { context, user: safeUser(context) };
}

export async function completeForcedPasswordChange(challengeTokenValue, newPassword, requestContext, { hashPassword = argon2.hash } = {}) {
  if (!isValidPassword(newPassword)) {
    throw new AppError("password must contain between 8 and 1024 characters.", {
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });
  }

  const tokenHash = hashChallenge(challengeTokenValue);
  const now = new Date();

  return prisma.$transaction(async transaction => {
    const lockedChallenges = await transaction.$queryRaw`
      SELECT id
      FROM password_change_challenge
      WHERE token_hash = ${tokenHash}
      FOR UPDATE
    `;
    if (lockedChallenges.length !== 1) throw passwordChangeError();

    const challenge = await transaction.password_change_challenge.findUnique({
      where: { token_hash: tokenHash },
    });
    if (!challenge || challenge.expires_at <= now) throw passwordChangeError();

    const lockedUsers = await transaction.$queryRaw`
      SELECT id
      FROM users
      WHERE id = ${challenge.user_id}::uuid
      FOR UPDATE
    `;
    if (lockedUsers.length !== 1) throw passwordChangeError();

    const user = await transaction.users.findUnique({
      where: { id: challenge.user_id },
      select: {
        credential_version: true,
        email: true,
        id: true,
        is_active: true,
        name: true,
        password_change_required: true,
      },
    });
    if (!user?.is_active || !user.password_change_required
      || user.credential_version !== challenge.credential_version) {
      throw passwordChangeError();
    }

    const passwordHash = await hashPassword(newPassword, { type: argon2.argon2id });

    const updated = await transaction.users.update({
      where: { id: user.id },
      data: {
        credential_version: { increment: 1 },
        password_change_required: false,
        password_hash: passwordHash,
        updated_at: now,
      },
      select: { email: true, id: true, name: true },
    });
    await transaction.password_change_challenge.deleteMany({ where: { user_id: user.id } });
    await transaction.auth_context_challenge.deleteMany({ where: { user_id: user.id } });
    await createAuditEvent(transaction, {
      action: AUDIT_ACTIONS.USER_PASSWORD_CHANGED,
      actor: { scope: null, userId: user.id, userRoleId: null },
      hotelId: null,
      metadata: { current_state: "NORMAL", previous_state: "RESET_REQUIRED" },
      requestContext,
      targetId: user.id,
      targetType: AUDIT_TARGET_TYPES.USER_IDENTITY,
    });
    return { user: updated };
  });
}
