import { FREE_PLAN_LIMITS, HOTEL_PLANS } from "../config/hotelPlans.js";
import { ASSIGNMENT_STATUSES, HOTEL_ASSIGNABLE_ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { AppError } from "../middleware/errorHandler.js";

function hotelNotFound() {
  return new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
}

function planMessage(plan, roleKey) {
  if (plan === HOTEL_PLANS.UNASSIGNED) {
    return "A hotel plan must be selected before staff access can be activated.";
  }
  const role = roleKey.toLowerCase().replaceAll("_", " ");
  return `Your hotel's Free plan has reached the maximum number of active ${role} accounts.`;
}

export class PlanLimitError extends AppError {
  constructor({ currentCount, hotelId, limit, plan, roleKey }) {
    super(planMessage(plan, roleKey), {
      code: plan === HOTEL_PLANS.UNASSIGNED ? "PLAN_NOT_SELECTED" : "PLAN_LIMIT_REACHED",
      statusCode: 409,
    });
    this.planAudit = Object.freeze({ currentCount, hotelId, limit, plan, roleKey });
  }
}

export async function lockHotelEntitlements(transaction, hotelIds) {
  const ids = [...new Set(hotelIds)].sort();
  const result = new Map();
  for (const hotelId of ids) {
    const rows = await transaction.$queryRaw`
      SELECT id, plan, status
      FROM hotel
      WHERE id = ${hotelId}::uuid
      FOR UPDATE
    `;
    if (!rows[0]) throw hotelNotFound();
    result.set(hotelId, rows[0]);
  }
  return result;
}

export async function lockHotelEntitlement(transaction, hotelId) {
  return (await lockHotelEntitlements(transaction, [hotelId])).get(hotelId);
}

export async function countActiveHotelRoleAssignments(transaction, hotelId, roleKey) {
  const count = await transaction.user_role.count({
    where: {
      hotel_id: hotelId,
      role_scope: ROLE_SCOPES.HOTEL,
      status: ASSIGNMENT_STATUSES.ACTIVE,
      role: { scope: ROLE_SCOPES.HOTEL, system_key: roleKey },
    },
  });
  return count;
}

export async function assertCanIncreaseHotelRole(transaction, hotelId, roleKey, { increasesActive = true, lockedHotel = null } = {}) {
  if (!HOTEL_ASSIGNABLE_ROLE_KEYS.has(roleKey)) return;
  const hotel = lockedHotel || await lockHotelEntitlement(transaction, hotelId);
  if (hotel.plan === HOTEL_PLANS.UNASSIGNED) {
    throw new PlanLimitError({ currentCount: 0, hotelId, limit: 0, plan: hotel.plan, roleKey });
  }
  if (!increasesActive) return;
  if (hotel.plan === HOTEL_PLANS.PREMIUM) return;

  const limit = FREE_PLAN_LIMITS[roleKey];
  const currentCount = await countActiveHotelRoleAssignments(transaction, hotelId, roleKey);
  if (currentCount >= limit) {
    throw new PlanLimitError({ currentCount, hotelId, limit, plan: hotel.plan, roleKey });
  }
}

export async function getHotelEntitlementUsage(client, hotelId) {
  const hotel = await client.hotel.findUnique({ where: { id: hotelId }, select: { id: true, plan: true } });
  if (!hotel) throw hotelNotFound();
  const roles = await client.role.findMany({
    where: { scope: ROLE_SCOPES.HOTEL, system_key: { in: [...HOTEL_ASSIGNABLE_ROLE_KEYS] } },
    select: {
      system_key: true,
      _count: {
        select: {
          user_role: {
            where: { hotel_id: hotelId, role_scope: ROLE_SCOPES.HOTEL, status: ASSIGNMENT_STATUSES.ACTIVE },
          },
        },
      },
    },
  });
  const counts = Object.fromEntries(roles.map(role => [role.system_key, role._count.user_role]));
  const usage = Object.fromEntries([...HOTEL_ASSIGNABLE_ROLE_KEYS].map(roleKey => {
    const active = counts[roleKey] || 0;
    const limit = hotel.plan === HOTEL_PLANS.FREE ? FREE_PLAN_LIMITS[roleKey] : null;
    return [roleKey, {
      active,
      limit,
      grandfathered: limit !== null && active > limit ? active - limit : 0,
      remaining: limit === null ? null : Math.max(0, limit - active),
    }];
  }));
  return { plan: hotel.plan, usage };
}
