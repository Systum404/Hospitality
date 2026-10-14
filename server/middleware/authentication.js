import { resolveAuthenticationContext } from "../services/authService.js";
import { verifyAuthenticationToken } from "../services/tokenService.js";
import { AppError } from "./errorHandler.js";

export const authenticationCookieName = "aazira_auth";

function cookieValue(header, name) {
  if (!header) return null;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }

  return null;
}

export async function requireAuthentication(req, _res, next) {
  const token = cookieValue(req.headers.cookie, authenticationCookieName);

  if (!token) {
    return next(new AppError("Authentication is required.", {
      code: "UNAUTHENTICATED",
      statusCode: 401,
    }));
  }

  try {
    const claims = await verifyAuthenticationToken(token);
    const { context } = await resolveAuthenticationContext(claims.userId, claims.userRoleId, claims.credentialVersion);
    req.auth = context;
    return next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(new AppError("Authentication is required.", {
      code: "UNAUTHENTICATED",
      statusCode: 401,
    }));
  }
}
