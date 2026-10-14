import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { ASSIGNMENT_STATUSES, ROLE_DEFINITIONS, ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";

export const DEVELOPMENT_SUPER_ADMIN_NAME = "AAZIRA Development Super Admin";

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function validateDevelopmentSuperAdminEnvironment(source = process.env) {
  const nodeEnv = source.NODE_ENV?.trim();
  if (!new Set(["development", "test"]).has(nodeEnv)) {
    throw new Error("Development Super Admin bootstrap is allowed only when NODE_ENV is development or test.");
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(source.DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol) || !LOCAL_DATABASE_HOSTS.has(databaseUrl.hostname)) {
    throw new Error("Development Super Admin bootstrap may only target PostgreSQL on the local machine.");
  }

  const email = source.DEV_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Set DEV_SUPER_ADMIN_EMAIL to a valid development email address.");
  }

  const password = source.DEV_SUPER_ADMIN_PASSWORD;
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) {
    throw new Error("DEV_SUPER_ADMIN_PASSWORD must contain between 12 and 1024 characters.");
  }

  return Object.freeze({ databaseUrl: databaseUrl.toString(), email, nodeEnv, password });
}

function assertSuperAdminRole(role) {
  const expected = ROLE_DEFINITIONS[ROLE_KEYS.SUPER_ADMIN];
  if (
    !role
    || role.system_key !== ROLE_KEYS.SUPER_ADMIN
    || role.name !== expected.displayName
    || role.scope !== ROLE_SCOPES.COMPANY
    || role.is_protected !== true
  ) {
    throw new Error("The protected SUPER_ADMIN / COMPANY role definition is missing or invalid; no records were changed.");
  }
}

function isExpectedAssignment(assignment, roleId) {
  return assignment.role_id === roleId
    && assignment.role_scope === ROLE_SCOPES.COMPANY
    && assignment.hotel_id === null;
}

export async function bootstrapDevelopmentSuperAdmin(client, config) {
  if (!client || typeof client.$transaction !== "function") throw new TypeError("A Prisma client is required.");
  if (!config?.email || !config?.password) throw new TypeError("Validated development bootstrap configuration is required.");

  return client.$transaction(async transaction => {
    const [lock] = await transaction.$queryRaw`
      WITH acquired AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(hashtext('aazira-development-super-admin-bootstrap'))
      )
      SELECT TRUE AS locked FROM acquired
    `;
    if (lock?.locked !== true) throw new Error("Unable to lock the development Super Admin bootstrap transaction.");

    const role = await transaction.role.findUnique({
      where: { system_key: ROLE_KEYS.SUPER_ADMIN },
      select: { id: true, is_protected: true, name: true, scope: true, system_key: true },
    });
    assertSuperAdminRole(role);

    let user = await transaction.users.findUnique({
      where: { email: config.email },
      select: {
        credential_version: true,
        email: true,
        id: true,
        is_active: true,
        name: true,
        password_change_required: true,
        password_hash: true,
        user_role: { select: { hotel_id: true, id: true, role_id: true, role_scope: true, status: true } },
      },
    });

    if (user && user.name !== DEVELOPMENT_SUPER_ADMIN_NAME) {
      throw new Error("DEV_SUPER_ADMIN_EMAIL belongs to another identity; no records were changed.");
    }

    const existingAssignments = user?.user_role || [];
    if (existingAssignments.some(assignment => !isExpectedAssignment(assignment, role.id))) {
      throw new Error("The configured development identity has an incompatible assignment; no records were changed.");
    }
    if (existingAssignments.length > 1) {
      throw new Error("The configured development identity has duplicate assignments; no records were changed.");
    }

    let userCreated = false;
    let credentialUpdated = false;
    let identityReactivated = false;
    if (!user) {
      user = await transaction.users.create({
        data: {
          email: config.email,
          id: randomUUID(),
          is_active: true,
          name: DEVELOPMENT_SUPER_ADMIN_NAME,
          password_change_required: false,
          password_hash: await argon2.hash(config.password, { type: argon2.argon2id }),
        },
        select: { email: true, id: true, is_active: true },
      });
      userCreated = true;
    } else {
      const passwordMatches = typeof user.password_hash === "string"
        && await argon2.verify(user.password_hash, config.password, { type: argon2.argon2id }).catch(() => false);
      const needsCredentialUpdate = !passwordMatches || user.password_change_required;
      const needsIdentityReactivation = !user.is_active;
      if (needsCredentialUpdate || needsIdentityReactivation) {
        user = await transaction.users.update({
          where: { id: user.id },
          data: {
            ...(needsCredentialUpdate ? {
              password_hash: await argon2.hash(config.password, { type: argon2.argon2id }),
              password_change_required: false,
            } : {}),
            ...(needsIdentityReactivation ? { is_active: true } : {}),
            credential_version: { increment: 1 },
          },
          select: { email: true, id: true, is_active: true },
        });
        await transaction.auth_context_challenge.deleteMany({ where: { user_id: user.id } });
        await transaction.password_change_challenge.deleteMany({ where: { user_id: user.id } });
        credentialUpdated = needsCredentialUpdate;
        identityReactivated = needsIdentityReactivation;
      }
    }

    let assignment = existingAssignments[0] || null;
    const assignmentCreated = assignment === null;
    const assignmentReactivated = assignment !== null && assignment.status !== ASSIGNMENT_STATUSES.ACTIVE;
    if (!assignment) {
      assignment = await transaction.user_role.create({
        data: {
          hotel_id: null,
          id: randomUUID(),
          role_id: role.id,
          role_scope: ROLE_SCOPES.COMPANY,
          status: ASSIGNMENT_STATUSES.ACTIVE,
          user_id: user.id,
        },
        select: { hotel_id: true, id: true, role_scope: true, status: true },
      });
    } else if (assignmentReactivated) {
      assignment = await transaction.user_role.update({
        where: { id: assignment.id },
        data: { restore_on_identity_reactivation: false, status: ASSIGNMENT_STATUSES.ACTIVE },
        select: { hotel_id: true, id: true, role_scope: true, status: true },
      });
    }

    return {
      assignmentCreated,
      assignmentId: assignment.id,
      assignmentReactivated,
      credentialUpdated,
      email: config.email,
      hotelId: assignment.hotel_id,
      identityReactivated,
      roleKey: role.system_key,
      scope: assignment.role_scope,
      status: assignment.status,
      userCreated,
      userId: user.id,
    };
  });
}
