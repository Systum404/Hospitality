import { environment } from "../config/environment.js";
import { authenticationCookieName } from "../middleware/authentication.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  assertContextChallengeAvailable,
  assertLoginIdentifierAvailable,
  clearContextChallengeFailures,
  clearLoginIdentifierFailures,
  consumePasswordChangeChallenge,
  registerContextChallengeFailure,
  registerLoginIdentifierFailure,
} from "../middleware/authRateLimit.js";
import { authenticateCredentials, completeForcedPasswordChange, recordSuccessfulLogin, selectAuthenticationContext } from "../services/authService.js";
import { createAuthenticationToken } from "../services/tokenService.js";

const allowedLoginFields = new Set(["identifier", "password", "remember"]);
const allowedContextFields = new Set(["assignmentId", "challenge"]);
const allowedPasswordChangeFields = new Set(["challenge", "newPassword"]);

function cookieOptions() {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "strict",
    secure: environment.isProduction,
  };
}

function validateLoginBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("A JSON request body is required.", { code: "VALIDATION_ERROR", statusCode: 400 });
  }

  const unsupported = Object.keys(body).filter((field) => !allowedLoginFields.has(field));
  if (unsupported.length) {
    throw new AppError(`Unsupported request field: ${unsupported[0]}.`, { code: "VALIDATION_ERROR", statusCode: 400 });
  }

  if (typeof body.identifier !== "string" || !body.identifier.trim() || body.identifier.trim().length > 255) {
    throw new AppError("A valid email is required.", { code: "VALIDATION_ERROR", statusCode: 400 });
  }

  const email = body.identifier.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError("A valid email is required.", { code: "VALIDATION_ERROR", statusCode: 400 });
  }

  if (typeof body.password !== "string" || !body.password || body.password.length > 1024) {
    throw new AppError("A password is required.", { code: "VALIDATION_ERROR", statusCode: 400 });
  }

  if (body.remember !== undefined && typeof body.remember !== "boolean") {
    throw new AppError("remember must be a boolean.", { code: "VALIDATION_ERROR", statusCode: 400 });
  }

  return { email, password: body.password, remember: body.remember === true };
}

export async function login(req, res) {
  const credentials = validateLoginBody(req.body);
  assertLoginIdentifierAvailable(credentials.email);
  let result;
  try {
    result = await authenticateCredentials(credentials.email, credentials.password, { remember: credentials.remember });
  } catch (error) {
    if (error?.code === "INVALID_CREDENTIALS") registerLoginIdentifierFailure(credentials.email);
    throw error;
  }
  clearLoginIdentifierFailures(credentials.email);
  if (result.passwordChange) {
    res.clearCookie(authenticationCookieName, cookieOptions());
    return res.status(409).json({
      status: "error",
      error: {
        code: "PASSWORD_CHANGE_REQUIRED",
        message: "A new permanent password is required before application access can be granted.",
      },
      passwordChange: result.passwordChange,
    });
  }
  if (result.contextSelection) {
    res.clearCookie(authenticationCookieName, cookieOptions());
    return res.status(409).json({
      status: "error",
      error: {
        code: "ACCOUNT_CONTEXT_REQUIRED",
        message: "Account context selection is required.",
      },
      contextSelection: result.contextSelection,
    });
  }

  const { context, user } = result;
  const ttl = credentials.remember ? environment.authRememberTtlSeconds : environment.authTokenTtlSeconds;
  const token = await createAuthenticationToken(context, ttl);
  await recordSuccessfulLogin(context.userId);
  const options = cookieOptions();

  if (credentials.remember) options.maxAge = ttl * 1000;
  res.cookie(authenticationCookieName, token, options);
  res.status(200).json({ status: "success", user });
}

function validateContextBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("A JSON request body is required.", { code: "VALIDATION_ERROR", statusCode: 400 });
  }
  const unsupported = Object.keys(body).filter(field => !allowedContextFields.has(field));
  if (unsupported.length) {
    throw new AppError(`Unsupported request field: ${unsupported[0]}.`, { code: "VALIDATION_ERROR", statusCode: 400 });
  }
  if (typeof body.challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.challenge)) {
    throw new AppError("A valid context-selection challenge is required.", { code: "VALIDATION_ERROR", statusCode: 400 });
  }
  if (typeof body.assignmentId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.assignmentId)) {
    throw new AppError("A valid assignment identifier is required.", { code: "VALIDATION_ERROR", statusCode: 400 });
  }
  return { assignmentId: body.assignmentId, challenge: body.challenge };
}

export async function selectContext(req, res) {
  const input = validateContextBody(req.body);
  assertContextChallengeAvailable(input.challenge);
  let selection;
  try {
    selection = await selectAuthenticationContext(input.challenge, input.assignmentId);
  } catch (error) {
    if (error?.code === "CONTEXT_SELECTION_INVALID") registerContextChallengeFailure(input.challenge);
    throw error;
  }
  clearContextChallengeFailures(input.challenge);
  const { context, remember, user } = selection;
  const ttl = remember ? environment.authRememberTtlSeconds : environment.authTokenTtlSeconds;
  const token = await createAuthenticationToken(context, ttl);
  await recordSuccessfulLogin(context.userId);
  const options = cookieOptions();
  if (remember) options.maxAge = ttl * 1000;
  res.cookie(authenticationCookieName, token, options);
  res.status(200).json({ status: "success", user });
}

function validatePasswordChangeBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("A JSON request body is required.", { code: "VALIDATION_ERROR", statusCode: 400 });
  }
  const unsupported = Object.keys(body).find(field => !allowedPasswordChangeFields.has(field));
  if (unsupported) {
    throw new AppError(`Unsupported request field: ${unsupported}.`, { code: "VALIDATION_ERROR", statusCode: 400 });
  }
  if (typeof body.challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.challenge)) {
    throw new AppError("A valid password-change challenge is required.", { code: "VALIDATION_ERROR", statusCode: 400 });
  }
  return { challenge: body.challenge, newPassword: body.newPassword };
}

export async function changePassword(req, res) {
  const input = validatePasswordChangeBody(req.body);
  consumePasswordChangeChallenge(input.challenge);
  const data = await completeForcedPasswordChange(input.challenge, input.newPassword, req.auditContext);
  res.clearCookie(authenticationCookieName, cookieOptions());
  res.status(200).json({ status: "success", data });
}

export function session(req, res) {
  const { assignmentActive, email, hotelId, name, role, roleKey, scope, userActive, userId } = req.auth;
  res.status(200).json({
    status: "success",
    user: { assignmentActive, email, hotelId, id: userId, name, role, roleKey, scope, userActive },
  });
}

export function logout(_req, res) {
  res.clearCookie(authenticationCookieName, cookieOptions());
  res.status(200).json({ status: "success" });
}
