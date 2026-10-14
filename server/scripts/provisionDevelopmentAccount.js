import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { INITIAL_HOTEL_BILLING_SETTINGS } from "../config/hotelBillingSettings.js";
import { ASSIGNMENT_STATUSES, ROLE_DEFINITIONS, ROLE_KEYS } from "../config/roles.js";
import { HOTEL_PLANS } from "../config/hotelPlans.js";
import { prisma } from "../db/prisma.js";
import { assertCanIncreaseHotelRole, lockHotelEntitlement } from "../services/hotelEntitlementService.js";

const DEVELOPMENT_HOTEL_EMAIL = "hotel@local.aazira.test";
const DEVELOPMENT_HOTEL_NAME = "AAZIRA Local Development Hotel";
const DEVELOPMENT_ACCOUNTS = [
  { email: "admin@local.aazira.test", name: "AAZIRA Local Admin", passwordVariable: "DEV_ADMIN_PASSWORD", roleKey: ROLE_KEYS.HOTEL_ADMIN },
  { email: "manager@local.aazira.test", name: "AAZIRA Local Manager", passwordVariable: "DEV_MANAGER_PASSWORD", roleKey: ROLE_KEYS.MANAGER },
  { email: "reception@local.aazira.test", name: "AAZIRA Local Reception", passwordVariable: "DEV_RECEPTION_PASSWORD", roleKey: ROLE_KEYS.RECEPTION },
  { email: "captain@local.aazira.test", name: "AAZIRA Local Captain", passwordVariable: "DEV_CAPTAIN_PASSWORD", roleKey: ROLE_KEYS.CAPTAIN },
  { email: "kitchen@local.aazira.test", name: "AAZIRA Local Kitchen", passwordVariable: "DEV_KITCHEN_PASSWORD", roleKey: ROLE_KEYS.KITCHEN },
];

function requireLocalDevelopmentEnvironment() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development provisioning is disabled in production.");
  }

  const databaseUrl = new URL(process.env.DATABASE_URL);
  if (!["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname)) {
    throw new Error("Development provisioning may only target a local PostgreSQL host.");
  }

  return DEVELOPMENT_ACCOUNTS.map((account) => {
    const password = process.env[account.passwordVariable];
    if (typeof password !== "string" || !password.trim()) {
      throw new Error(`Set ${account.passwordVariable} before running npm run provision:dev.`);
    }
    if (password.length < 12 || password.length > 1024) {
      throw new Error(`${account.passwordVariable} must contain between 12 and 1024 characters.`);
    }
    return { ...account, password };
  });
}

async function findDevelopmentHotel(transaction) {
  const matches = await transaction.hotel.findMany({
    where: {
      OR: [
        { name: DEVELOPMENT_HOTEL_NAME },
        { email: DEVELOPMENT_HOTEL_EMAIL },
      ],
    },
    select: { email: true, id: true, name: true, plan: true },
  });

  if (matches.length === 0) return null;
  if (
    matches.length !== 1
    || matches[0].name !== DEVELOPMENT_HOTEL_NAME
    || matches[0].email !== DEVELOPMENT_HOTEL_EMAIL
  ) {
    throw new Error("Conflicting local development hotel record detected; no records were changed.");
  }

  return matches[0];
}

async function provision(accounts) {
  return prisma.$transaction(async (transaction) => {
    let hotel = await findDevelopmentHotel(transaction);
    const hotelCreated = hotel === null;
    if (!hotel) {
      hotel = await transaction.hotel.create({
        data: {
          email: DEVELOPMENT_HOTEL_EMAIL,
          id: randomUUID(),
          name: DEVELOPMENT_HOTEL_NAME,
          plan: HOTEL_PLANS.FREE,
          status: "ACTIVE",
        },
        select: { email: true, id: true, name: true, plan: true },
      });
    }
    if (hotel.plan === HOTEL_PLANS.UNASSIGNED) {
      throw new Error("The local development hotel needs an explicit plan before staff provisioning; no records were changed.");
    }
    await transaction.hotel_billing_settings.upsert({
      where: { hotel_id: hotel.id },
      create: { hotel_id: hotel.id, ...INITIAL_HOTEL_BILLING_SETTINGS },
      update: {},
    });
    const lockedHotel = await lockHotelEntitlement(transaction, hotel.id);

    const results = [];
    for (const account of accounts) {
      const definition = ROLE_DEFINITIONS[account.roleKey];
      let role = await transaction.role.findUnique({
        where: { system_key: account.roleKey },
        select: { id: true, name: true, scope: true, system_key: true },
      });
      const roleCreated = role === null;
      if (!role) {
        role = await transaction.role.create({
          data: { name: definition.displayName, system_key: account.roleKey, scope: definition.scope, is_protected: true },
          select: { id: true, name: true, scope: true, system_key: true },
        });
      }

      let user = await transaction.users.findUnique({
        where: { email: account.email },
        select: { id: true, is_active: true, name: true, password_hash: true },
      });
      const userCreated = user === null;
      if (user && (user.name !== account.name || !user.is_active)) {
        throw new Error(`Conflicting local development user record detected for ${account.email}; no records were changed.`);
      }

      const existingAssignments = user
        ? await transaction.user_role.findMany({
          where: { user_id: user.id },
          select: { hotel_id: true, id: true, role_id: true },
        })
        : [];
      const expectedAssignment = existingAssignments.find((assignment) => (
        assignment.hotel_id === hotel.id && assignment.role_id === role.id
      ));
      if (existingAssignments.some((assignment) => assignment.id !== expectedAssignment?.id)) {
        throw new Error(`The development user ${account.email} has another assignment; no records were changed.`);
      }

      let passwordUpdated = false;
      if (user) {
        const passwordMatches = await argon2.verify(user.password_hash, account.password, {
          type: argon2.argon2id,
        }).catch(() => false);
        if (!passwordMatches) {
          user = await transaction.users.update({
            data: { password_hash: await argon2.hash(account.password, { type: argon2.argon2id }) },
            where: { id: user.id },
            select: { id: true, is_active: true, name: true, password_hash: true },
          });
          passwordUpdated = true;
        }
      } else {
        user = await transaction.users.create({
          data: {
            email: account.email,
            id: randomUUID(),
            is_active: true,
            name: account.name,
            password_hash: await argon2.hash(account.password, { type: argon2.argon2id }),
          },
          select: { id: true, is_active: true, name: true, password_hash: true },
        });
      }

      const assignmentCreated = !expectedAssignment;
      if (!expectedAssignment) {
        await assertCanIncreaseHotelRole(transaction, hotel.id, account.roleKey, { lockedHotel });
        await transaction.user_role.create({
          data: { hotel_id: hotel.id, id: randomUUID(), role_id: role.id, role_scope: role.scope, status: ASSIGNMENT_STATUSES.ACTIVE, user_id: user.id },
          select: { id: true },
        });
      }

      results.push({
        assignmentCreated,
        email: account.email,
        passwordUpdated,
        role: definition.displayName,
        roleCreated,
        userCreated,
      });
    }

    return { accounts: results, hotelCreated };
  });
}

try {
  const accounts = requireLocalDevelopmentEnvironment();
  const result = await provision(accounts);

  console.log("Development accounts provisioned");
  console.log(`Hotel: ${DEVELOPMENT_HOTEL_NAME} (${result.hotelCreated ? "created" : "found"})`);
  for (const account of result.accounts) {
    console.log(`Role: ${account.role} (${account.roleCreated ? "created" : "found"})`);
    console.log(`Email: ${account.email}`);
    console.log(`User: ${account.userCreated ? "created" : "found"}`);
    if (account.passwordUpdated) console.log("Development credential: updated");
    console.log(`Assignment: ${account.assignmentCreated ? "created" : "found"}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Development provisioning failed.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
