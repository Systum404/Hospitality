export const ROLE_KEYS = Object.freeze({
  SUPER_ADMIN: "SUPER_ADMIN",
  HOTEL_ADMIN: "HOTEL_ADMIN",
  MANAGER: "MANAGER",
  RECEPTION: "RECEPTION",
  CAPTAIN: "CAPTAIN",
  KITCHEN: "KITCHEN",
});

export const ROLE_SCOPES = Object.freeze({
  COMPANY: "COMPANY",
  HOTEL: "HOTEL",
});

export const ASSIGNMENT_STATUSES = Object.freeze({
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
});

export const ROLE_DEFINITIONS = Object.freeze({
  [ROLE_KEYS.SUPER_ADMIN]: Object.freeze({ displayName: "Super Admin", scope: ROLE_SCOPES.COMPANY }),
  [ROLE_KEYS.HOTEL_ADMIN]: Object.freeze({ displayName: "Admin", scope: ROLE_SCOPES.HOTEL }),
  [ROLE_KEYS.MANAGER]: Object.freeze({ displayName: "Manager", scope: ROLE_SCOPES.HOTEL }),
  [ROLE_KEYS.RECEPTION]: Object.freeze({ displayName: "Reception", scope: ROLE_SCOPES.HOTEL }),
  [ROLE_KEYS.CAPTAIN]: Object.freeze({ displayName: "Captain", scope: ROLE_SCOPES.HOTEL }),
  [ROLE_KEYS.KITCHEN]: Object.freeze({ displayName: "Kitchen", scope: ROLE_SCOPES.HOTEL }),
});

export const HOTEL_ASSIGNABLE_ROLE_KEYS = new Set([
  ROLE_KEYS.HOTEL_ADMIN,
  ROLE_KEYS.MANAGER,
  ROLE_KEYS.RECEPTION,
  ROLE_KEYS.CAPTAIN,
  ROLE_KEYS.KITCHEN,
]);

export function isKnownRoleDefinition(systemKey, scope) {
  return ROLE_DEFINITIONS[systemKey]?.scope === scope;
}
