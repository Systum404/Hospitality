import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { ASSIGNMENT_STATUSES, HOTEL_ASSIGNABLE_ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { assertCanIncreaseHotelRole, getHotelEntitlementUsage, lockHotelEntitlement } from "./hotelEntitlementService.js";

const userFields = {
  id: true,
  email: true,
  name: true,
  phone: true,
  is_active: true,
  created_at: true,
  updated_at: true,
  last_login: true,
};

const assignmentFields = {
  id: true,
  hotel_id: true,
  role_id: true,
  role_scope: true,
  status: true,
  restore_on_identity_reactivation: true,
  role: { select: { id: true, is_protected: true, name: true, scope: true, system_key: true } },
  users: { select: userFields },
};

function duplicate(message, code) {
  return new AppError(message, { code, statusCode: 409 });
}

async function requireHotel(client, hotelId) {
  const hotel = await client.hotel.findUnique({ where: { id: hotelId }, select: { id: true } });
  if (!hotel) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
}

async function requireRole(client, roleId) {
  const role = await client.role.findUnique({
    where: { id: roleId },
    select: { id: true, is_protected: true, name: true, scope: true, system_key: true },
  });
  if (!role) throw new AppError("Role not found.", { code: "ROLE_NOT_FOUND", statusCode: 404 });
  if (role.scope !== ROLE_SCOPES.HOTEL || !HOTEL_ASSIGNABLE_ROLE_KEYS.has(role.system_key)) {
    throw new AppError("This role cannot be assigned by a Hotel Admin.", {
      code: "ROLE_ASSIGNMENT_FORBIDDEN",
      statusCode: 403,
    });
  }
  return role;
}

function serializeAssignment(assignment) {
  return {
    ...assignment.users,
    role: assignment.role,
  };
}

async function requireScopedAssignment(client, hotelId, userId) {
  const user = await client.users.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new AppError("User not found.", { code: "USER_NOT_FOUND", statusCode: 404 });

  const assignments = await client.user_role.findMany({
    where: { user_id: userId },
    select: assignmentFields,
  });
  const scoped = assignments.filter((assignment) => assignment.hotel_id === hotelId);

  if (scoped.length === 0) {
    throw new AppError("The requested user is outside the authenticated hotel scope.", {
      code: "HOTEL_SCOPE_MISMATCH",
      statusCode: 403,
    });
  }
  if (scoped.length !== 1 || assignments.length !== 1) {
    throw duplicate("Account context selection is required.", "ACCOUNT_CONTEXT_REQUIRED");
  }
  return scoped[0];
}

async function getScopedUser(client, hotelId, userId) {
  const assignment = await requireScopedAssignment(client, hotelId, userId);
  return serializeAssignment(assignment);
}

function translatePrismaError(error) {
  if (error?.code === "P2002") {
    return duplicate("A user account with that email or role assignment already exists.", "USER_ACCOUNT_CONFLICT");
  }
  return error;
}

export async function getUsersForHotel(hotelId) {
  await requireHotel(prisma, hotelId);
  const [assignments, roles, entitlement] = await Promise.all([
    prisma.user_role.findMany({
      where: { hotel_id: hotelId },
      orderBy: { users: { created_at: "desc" } },
      select: assignmentFields,
    }),
    prisma.role.findMany({
      where: { scope: ROLE_SCOPES.HOTEL, system_key: { in: [...HOTEL_ASSIGNABLE_ROLE_KEYS] } },
      select: { id: true, is_protected: true, name: true, scope: true, system_key: true },
      orderBy: { name: "asc" },
    }),
    getHotelEntitlementUsage(prisma, hotelId),
  ]);

  return {
    entitlement,
    roles,
    users: assignments.map(serializeAssignment),
  };
}

export async function createUserForHotel(hotelId, input) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const hotel = await lockHotelEntitlement(transaction, hotelId);
      const role = await requireRole(transaction, input.role_id);
      await assertCanIncreaseHotelRole(transaction, hotelId, role.system_key, {
        increasesActive: input.is_active !== false,
        lockedHotel: hotel,
      });
      const existing = await transaction.users.findUnique({ where: { email: input.email }, select: { id: true } });
      if (existing) throw duplicate("A user account with that email already exists.", "USER_EMAIL_EXISTS");

      const user = await transaction.users.create({
        data: {
          email: input.email,
          id: randomUUID(),
          is_active: input.is_active ?? true,
          name: input.name,
          password_hash: await argon2.hash(input.password, { type: argon2.argon2id }),
        },
        select: { id: true },
      });
      await transaction.user_role.create({
        data: {
          hotel_id: hotelId,
          id: randomUUID(),
          role_id: input.role_id,
          role_scope: role.scope,
          restore_on_identity_reactivation: input.is_active === false,
          status: input.is_active === false ? ASSIGNMENT_STATUSES.INACTIVE : ASSIGNMENT_STATUSES.ACTIVE,
          user_id: user.id,
        },
      });
      return getScopedUser(transaction, hotelId, user.id);
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

export async function updateUserForHotel(hotelId, userId, input) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const hotel = await lockHotelEntitlement(transaction, hotelId);
      const current = await requireScopedAssignment(transaction, hotelId, userId);
      const role = Object.hasOwn(input, "role_id") ? await requireRole(transaction, input.role_id) : null;

      if (role && input.role_id !== current.role_id && current.status === ASSIGNMENT_STATUSES.ACTIVE) {
        await assertCanIncreaseHotelRole(transaction, hotelId, role.system_key, { lockedHotel: hotel });
      }

      const data = {};
      for (const field of ["email", "name"]) if (Object.hasOwn(input, field)) data[field] = input[field];
      if (Object.hasOwn(input, "password")) {
        data.password_hash = await argon2.hash(input.password, { type: argon2.argon2id });
      }
      if (Object.keys(data).length) {
        await transaction.users.update({ where: { id: userId }, data });
      }
      if (Object.hasOwn(input, "role_id") && input.role_id !== current.role_id) {
        await transaction.user_role.update({
          where: { id: current.id },
          data: { role_id: input.role_id, role_scope: role.scope },
        });
      }
      return getScopedUser(transaction, hotelId, userId);
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

export async function updateUserStatusForHotel(hotelId, userId, isActive) {
  return prisma.$transaction(async (transaction) => {
    const hotel = await lockHotelEntitlement(transaction, hotelId);
    const assignment = await requireScopedAssignment(transaction, hotelId, userId);
    if (isActive && assignment.status === ASSIGNMENT_STATUSES.INACTIVE && assignment.restore_on_identity_reactivation) {
      await assertCanIncreaseHotelRole(transaction, hotelId, assignment.role.system_key, { lockedHotel: hotel });
      await transaction.user_role.update({
        where: { id: assignment.id },
        data: { restore_on_identity_reactivation: false, status: ASSIGNMENT_STATUSES.ACTIVE },
      });
    } else if (!isActive && assignment.status === ASSIGNMENT_STATUSES.ACTIVE) {
      await transaction.user_role.update({
        where: { id: assignment.id },
        data: { restore_on_identity_reactivation: true, status: ASSIGNMENT_STATUSES.INACTIVE },
      });
    }
    await transaction.users.update({ where: { id: userId }, data: { is_active: isActive } });
    return getScopedUser(transaction, hotelId, userId);
  });
}

export async function deleteUserForHotel(hotelId, userId, actingUserId) {
  if (userId === actingUserId) {
    throw duplicate("You cannot delete your own currently authenticated account.", "SELF_DELETE_FORBIDDEN");
  }

  try {
    return await prisma.$transaction(async (transaction) => {
      await requireHotel(transaction, hotelId);
      const user = await getScopedUser(transaction, hotelId, userId);
      const orders = await transaction.orders.count({ where: { captain_id: userId } });
      if (orders > 0) {
        throw duplicate("User cannot be deleted while historical business records reference this account.", "USER_HAS_BUSINESS_HISTORY");
      }

      await transaction.users.delete({ where: { id: userId } });
      return user;
    });
  } catch (error) {
    if (error?.code === "P2003") {
      throw duplicate("User cannot be deleted while historical business records reference this account.", "USER_HAS_BUSINESS_HISTORY");
    }
    throw error;
  }
}
