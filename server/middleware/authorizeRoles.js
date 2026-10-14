import { AppError } from "./errorHandler.js";

export function authorizeRoleKeys(...allowedRoleKeys) {
  const allowed = new Set(allowedRoleKeys);

  return function requireRole(req, _res, next) {
    if (!req.auth) {
      return next(new AppError("Authentication is required.", {
        code: "UNAUTHENTICATED",
        statusCode: 401,
      }));
    }

    if (!allowed.has(req.auth.roleKey)) {
      return next(new AppError("You do not have permission to perform this action.", {
        code: "FORBIDDEN",
        statusCode: 403,
      }));
    }

    return next();
  };
}
