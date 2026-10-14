import { randomUUID } from "node:crypto";
import { AUDIT_ACTIONS, AUDIT_OUTCOMES } from "../config/audit.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_METADATA = Object.freeze({
  [AUDIT_ACTIONS.HOTEL_ACTIVATED]: new Set(["current_status", "previous_status"]),
  [AUDIT_ACTIONS.HOTEL_CREATED]: new Set(["hotel_code"]),
  [AUDIT_ACTIONS.HOTEL_DEACTIVATED]: new Set(["current_status", "previous_status"]),
  [AUDIT_ACTIONS.HOTEL_METADATA_UPDATED]: new Set(["changed_fields"]),
  [AUDIT_ACTIONS.HOTEL_PLAN_SELECTED]: new Set(["current_plan", "previous_plan"]),
  [AUDIT_ACTIONS.HOTEL_PLAN_CHANGED]: new Set(["current_plan", "previous_plan"]),
  [AUDIT_ACTIONS.HOTEL_ASSIGNMENT_LIMIT_REACHED]: new Set(["current_count", "limit", "plan", "role"]),
  [AUDIT_ACTIONS.HOTEL_BILLING_SETTINGS_UPDATED]: new Set(["changed_fields"]),
  [AUDIT_ACTIONS.HOTEL_DEFAULT_TAX_UPDATED]: new Set(["changed_fields"]),
  [AUDIT_ACTIONS.HOTEL_SERVICE_CHARGE_UPDATED]: new Set(["changed_fields"]),
  [AUDIT_ACTIONS.HOTEL_ADMIN_INVITATION_CREATED]: new Set(["invitee_email", "role"]),
  [AUDIT_ACTIONS.HOTEL_ADMIN_INVITATION_RESENT]: new Set(["invitee_email", "replacement_invitation_id", "role", "superseded_invitation_id"]),
  [AUDIT_ACTIONS.HOTEL_ADMIN_INVITATION_REVOKED]: new Set(["invitee_email", "role"]),
  [AUDIT_ACTIONS.HOTEL_ADMIN_INVITATION_ACCEPTED]: new Set(["invitee_email", "role"]),
  [AUDIT_ACTIONS.HOTEL_ADMIN_ASSIGNMENT_DEACTIVATED]: new Set(["current_status", "previous_status", "role", "target_user_id"]),
  [AUDIT_ACTIONS.HOTEL_ADMIN_ASSIGNMENT_REACTIVATED]: new Set(["current_status", "previous_status", "role", "target_user_id"]),
  [AUDIT_ACTIONS.HOTEL_ADMIN_IDENTITY_DEACTIVATED]: new Set(["current_active", "previous_active"]),
  [AUDIT_ACTIONS.HOTEL_ADMIN_IDENTITY_REACTIVATED]: new Set(["current_active", "previous_active"]),
  [AUDIT_ACTIONS.USER_PASSWORD_RESET]: new Set(["current_state", "previous_state"]),
  [AUDIT_ACTIONS.USER_PASSWORD_CHANGED]: new Set(["current_state", "previous_state"]),
});
const FORBIDDEN_METADATA_KEY = /(authorization|cookie|jwt|password|secret|token|hash|credential|api.?key|mfa)/i;

function requireUuid(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (!UUID_PATTERN.test(value || "")) throw new TypeError(`${field} must be a UUID.`);
}

function safeMetadata(action, metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("Audit metadata must be an object.");
  }
  const allowed = ALLOWED_METADATA[action];
  if (!allowed) throw new TypeError(`Unsupported audit action: ${action}.`);
  const result = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!allowed.has(key) || FORBIDDEN_METADATA_KEY.test(key)) throw new TypeError(`Audit metadata field is not allowed: ${key}.`);
    if (key === "changed_fields") {
      if (!Array.isArray(value) || value.some(field => typeof field !== "string" || !field || FORBIDDEN_METADATA_KEY.test(field))) {
        throw new TypeError("changed_fields must contain safe field names.");
      }
      result[key] = [...new Set(value)].sort();
    } else {
      if (typeof value !== "string" || value.length > 255) throw new TypeError(`${key} must be a short string.`);
      result[key] = value;
    }
  }
  if (JSON.stringify(result).length > 4096) throw new TypeError("Audit metadata is too large.");
  return result;
}

function actorFields(actor) {
  if (actor === null) return { actor_assignment_id: null, actor_scope: null, actor_user_id: null };
  if (!actor || typeof actor !== "object") throw new TypeError("Authenticated audit actor context is required.");
  requireUuid(actor.userId, "actor.userId");
  if (actor.userRoleId === null && actor.scope === null) {
    return { actor_assignment_id: null, actor_scope: null, actor_user_id: actor.userId };
  }
  requireUuid(actor.userRoleId, "actor.userRoleId");
  if (!actor.scope) throw new TypeError("actor.scope is required.");
  return { actor_assignment_id: actor.userRoleId, actor_scope: actor.scope, actor_user_id: actor.userId };
}

export async function createAuditEvent(transaction, {
  action,
  actor,
  hotelId,
  metadata = {},
  outcome = AUDIT_OUTCOMES.SUCCESS,
  requestContext,
  targetId,
  targetType,
}) {
  if (!transaction?.audit_event?.create) throw new TypeError("A Prisma transaction client is required.");
  if (!Object.values(AUDIT_OUTCOMES).includes(outcome)) throw new TypeError("Invalid audit outcome.");
  requireUuid(requestContext?.requestId, "requestContext.requestId");
  requireUuid(hotelId, "hotelId", { nullable: true });
  requireUuid(targetId, "targetId", { nullable: true });
  if (typeof targetType !== "string" || !targetType) throw new TypeError("targetType is required.");
  return transaction.audit_event.create({
    data: {
      id: randomUUID(),
      ...actorFields(actor),
      action,
      target_type: targetType,
      target_id: targetId,
      hotel_id: hotelId,
      outcome,
      request_id: requestContext.requestId,
      metadata: safeMetadata(action, metadata),
      ip_address: requestContext.ipAddress || null,
      user_agent: requestContext.userAgent || null,
    },
  });
}
