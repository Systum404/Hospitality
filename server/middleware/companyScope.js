import { ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { AppError } from "./errorHandler.js";

export function requireCompanyScope(req, _res, next) {
  if (!req.auth) {
    return next(new AppError("Authentication is required.", {
      code: "UNAUTHENTICATED",
      statusCode: 401,
    }));
  }

  if (
    req.auth.scope !== ROLE_SCOPES.COMPANY
    || req.auth.roleKey !== ROLE_KEYS.SUPER_ADMIN
    || req.auth.hotelId !== null
    || req.auth.userActive !== true
    || req.auth.assignmentActive !== true
  ) {
    return next(new AppError("A company authorization scope is required.", {
      code: "COMPANY_SCOPE_REQUIRED",
      statusCode: 403,
    }));
  }

  return next();
}
