import { AppError } from "../middleware/errorHandler.js";
import {
  consumeInvitationAdministration,
  consumeInvitationToken,
} from "../middleware/authRateLimit.js";
import {
  acceptAdminInvitation,
  createAdminInvitation,
  listAdminInvitations,
  resendAdminInvitation,
  revokeAdminInvitation,
  selectAdminInvitationPlan,
  validateAdminInvitation,
} from "../services/adminInvitationService.js";
import { SELECTABLE_HOTEL_PLANS } from "../config/hotelPlans.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9 ()-]{7,20}$/;
const INVITE_FIELDS = new Set(["full_name", "email", "mobile_number"]);
const ACCEPT_FIELDS = new Set(["full_name", "mobile_number", "password"]);
const PLAN_FIELDS = new Set(["plan"]);

function invalid(message, code = "INVALID_ADMIN_INVITATION") {
  throw new AppError(message, { code, statusCode: 400 });
}

function validateUuid(value, label, code) {
  if (!UUID_PATTERN.test(value || "")) invalid(`${label} must be a valid UUID.`, code);
}

function requiredString(value, field, maximum) {
  if (typeof value !== "string" || !value.trim()) invalid(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > maximum) invalid(`${field} cannot exceed ${maximum} characters.`);
  return normalized;
}

function validateObject(body, fields) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("Request body must be a JSON object.", "INVALID_REQUEST_BODY");
  const unsupported = Object.keys(body).find(field => !fields.has(field));
  if (unsupported) invalid(`Unsupported invitation field: ${unsupported}.`, "UNSUPPORTED_ADMIN_INVITATION_FIELD");
  const missing = [...fields].find(field => !Object.hasOwn(body, field));
  if (missing) invalid(`${missing} is required.`);
}

function validateInviteBody(body) {
  validateObject(body, INVITE_FIELDS);
  const email = requiredString(body.email, "email", 255).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) invalid("email must be a valid email address.");
  const mobileNumber = requiredString(body.mobile_number, "mobile_number", 20);
  if (!PHONE_PATTERN.test(mobileNumber) || mobileNumber.replace(/\D/g, "").length < 7) invalid("mobile_number must be a valid phone number.");
  return { email, fullName: requiredString(body.full_name, "full_name", 255), mobileNumber };
}

function validateAcceptBody(body) {
  validateObject(body, ACCEPT_FIELDS);
  const mobileNumber = requiredString(body.mobile_number, "mobile_number", 20);
  if (!PHONE_PATTERN.test(mobileNumber) || mobileNumber.replace(/\D/g, "").length < 7) invalid("mobile_number must be a valid phone number.");
  if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 1024) {
    invalid("password must contain between 8 and 1024 characters.");
  }
  return { fullName: requiredString(body.full_name, "full_name", 255), mobileNumber, password: body.password };
}

function validatePlanBody(body) {
  validateObject(body, PLAN_FIELDS);
  if (!SELECTABLE_HOTEL_PLANS.has(body.plan)) invalid("plan must be FREE or PREMIUM.", "INVALID_HOTEL_PLAN");
  return body.plan;
}

function validateToken(token) {
  if (!TOKEN_PATTERN.test(token || "")) {
    throw new AppError("This invitation is invalid or no longer available.", { code: "ADMIN_INVITATION_INVALID", statusCode: 404 });
  }
  return token;
}

export function validateInvitationHotelId(req, _res, next) {
  try { validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID"); next(); } catch (error) { next(error); }
}

export async function companyCreate(req, res, next) {
  try {
    validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID");
    const input = validateInviteBody(req.body);
    consumeInvitationAdministration(req.auth.userId, req.params.hotelId, input.email);
    const data = await createAdminInvitation({ actor: req.auth, requestContext: req.auditContext, hotelId: req.params.hotelId, input });
    res.status(201).json({ status: "success", data });
  } catch (error) { next(error); }
}

export async function hotelCreate(req, res, next) {
  try {
    const input = validateInviteBody(req.body);
    consumeInvitationAdministration(req.auth.userId, req.hotelId, input.email);
    const data = await createAdminInvitation({ actor: req.auth, requestContext: req.auditContext, hotelId: req.hotelId, input });
    res.status(201).json({ status: "success", data });
  } catch (error) { next(error); }
}

export async function companyList(req, res, next) {
  try {
    validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID");
    res.status(200).json({ status: "success", data: { invitations: await listAdminInvitations(req.params.hotelId) } });
  } catch (error) { next(error); }
}

export async function hotelList(req, res, next) {
  try {
    res.status(200).json({ status: "success", data: { invitations: await listAdminInvitations(req.hotelId) } });
  } catch (error) { next(error); }
}

export async function companyResend(req, res, next) {
  try {
    validateUuid(req.params.invitationId, "invitationId", "INVALID_INVITATION_ID");
    res.status(201).json({ status: "success", data: await resendAdminInvitation({ actor: req.auth, requestContext: req.auditContext, invitationId: req.params.invitationId }) });
  } catch (error) { next(error); }
}

export async function hotelResend(req, res, next) {
  try {
    validateUuid(req.params.invitationId, "invitationId", "INVALID_INVITATION_ID");
    res.status(201).json({ status: "success", data: await resendAdminInvitation({ actor: req.auth, requestContext: req.auditContext, invitationId: req.params.invitationId, scopedHotelId: req.hotelId }) });
  } catch (error) { next(error); }
}

export async function companyRevoke(req, res, next) {
  try {
    validateUuid(req.params.invitationId, "invitationId", "INVALID_INVITATION_ID");
    res.status(200).json({ status: "success", data: await revokeAdminInvitation({ actor: req.auth, requestContext: req.auditContext, invitationId: req.params.invitationId }) });
  } catch (error) { next(error); }
}

export async function hotelRevoke(req, res, next) {
  try {
    validateUuid(req.params.invitationId, "invitationId", "INVALID_INVITATION_ID");
    res.status(200).json({ status: "success", data: await revokeAdminInvitation({ actor: req.auth, requestContext: req.auditContext, invitationId: req.params.invitationId, scopedHotelId: req.hotelId }) });
  } catch (error) { next(error); }
}

export async function publicValidate(req, res, next) {
  try {
    res.status(200).json({ status: "success", data: { invitation: await validateAdminInvitation(validateToken(req.params.token)) } });
  } catch (error) { next(error); }
}

export async function publicAccept(req, res, next) {
  try {
    const token = validateToken(req.params.token);
    const input = validateAcceptBody(req.body);
    consumeInvitationToken(token);
    res.status(200).json({ status: "success", data: await acceptAdminInvitation(token, input, req.auditContext) });
  } catch (error) { next(error); }
}

export async function publicSelectPlan(req, res, next) {
  try {
    const token = validateToken(req.params.token);
    consumeInvitationToken(token);
    const data = await selectAdminInvitationPlan(token, validatePlanBody(req.body), req.auditContext);
    res.status(200).json({ status: "success", data });
  } catch (error) { next(error); }
}
