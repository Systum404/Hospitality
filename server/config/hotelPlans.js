import { ROLE_KEYS } from "./roles.js";

export const HOTEL_PLANS = Object.freeze({
  UNASSIGNED: "UNASSIGNED",
  FREE: "FREE",
  PREMIUM: "PREMIUM",
});

export const FREE_PLAN_LIMITS = Object.freeze({
  [ROLE_KEYS.HOTEL_ADMIN]: 1,
  [ROLE_KEYS.MANAGER]: 1,
  [ROLE_KEYS.RECEPTION]: 1,
  [ROLE_KEYS.KITCHEN]: 1,
  [ROLE_KEYS.CAPTAIN]: 10,
});

export const SELECTABLE_HOTEL_PLANS = new Set([
  HOTEL_PLANS.FREE,
  HOTEL_PLANS.PREMIUM,
]);
