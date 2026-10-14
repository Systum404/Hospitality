import { AppError } from "../middleware/errorHandler.js";
import { consumeCompanyPasswordReset } from "../middleware/authRateLimit.js";
import {
  deactivateCompanyUserIdentity,
  reactivateCompanyUserIdentity,
  resetCompanyUserPassword,
} from "../services/companyUserIdentityService.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalid(message, code) {
  throw new AppError(message, { code, statusCode: 400 });
}

function validateRequest(req) {
  if (!UUID_PATTERN.test(req.params.userId || "")) {
    invalid("userId must be a valid UUID.", "INVALID_USER_ID");
  }
  if (req.body === undefined) return;
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    invalid("Request body must be an empty JSON object.", "INVALID_REQUEST_BODY");
  }
  const field = Object.keys(req.body)[0];
  if (field) invalid(`Unsupported identity lifecycle field: ${field}.`, "UNSUPPORTED_IDENTITY_LIFECYCLE_FIELD");
}

async function transition(req, res, next, operation) {
  try {
    validateRequest(req);
    const data = await operation(req.params.userId, {
      actor: req.auth,
      requestContext: req.auditContext,
    });
    res.status(200).json({ status: "success", data });
  } catch (error) {
    next(error);
  }
}

export async function deactivateUserIdentity(req, res, next) {
  return transition(req, res, next, deactivateCompanyUserIdentity);
}

export async function reactivateUserIdentity(req, res, next) {
  return transition(req, res, next, reactivateCompanyUserIdentity);
}

export async function resetUserPassword(req, res, next) {
  try {
    validateRequest(req);
    consumeCompanyPasswordReset(req.auth.userId, req.params.userId);
    const data = await resetCompanyUserPassword(req.params.userId, {
      actor: req.auth,
      requestContext: req.auditContext,
    });
    res.status(200).json({ status: "success", data });
  } catch (error) {
    next(error);
  }
}
