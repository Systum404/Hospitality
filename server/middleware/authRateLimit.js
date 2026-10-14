import { createHmac } from "node:crypto";
import { AUTH_RATE_LIMITS } from "../config/authRateLimits.js";
import { environment } from "../config/environment.js";
import { AppError } from "./errorHandler.js";

// This bounded TTL store is intentionally process-local because the repository
// defines no shared cache infrastructure. A multi-process or multi-instance
// deployment must replace this store with a shared atomic backend.
const entries = new Map();
let now = () => Date.now();

function derivedKey(namespace, subject) {
  return `${namespace}:${createHmac("sha256", environment.authSecret).update(String(subject)).digest("hex")}`;
}

function prune(currentTime) {
  for (const [key, entry] of entries) {
    if (entry.resetAt <= currentTime) entries.delete(key);
  }
  while (entries.size >= AUTH_RATE_LIMITS.storage.maximumKeys) {
    entries.delete(entries.keys().next().value);
  }
}

function rateLimited(retryAfterMs) {
  const error = new AppError("Too many requests. Please try again later.", {
    code: "AUTH_RATE_LIMITED",
    statusCode: 429,
  });
  error.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return error;
}

function currentEntry(key, windowMs) {
  const currentTime = now();
  let entry = entries.get(key);
  if (!entry || entry.resetAt <= currentTime) {
    prune(currentTime);
    entry = { count: 0, resetAt: currentTime + windowMs };
    entries.set(key, entry);
  }
  return { currentTime, entry };
}

function assertAvailable(namespace, subject, policy) {
  const key = derivedKey(namespace, subject);
  const entry = entries.get(key);
  const currentTime = now();
  if (entry && entry.resetAt > currentTime && entry.count >= policy.limit) {
    throw rateLimited(entry.resetAt - currentTime);
  }
  if (entry?.resetAt <= currentTime) entries.delete(key);
}

function consume(namespace, subject, policy) {
  const key = derivedKey(namespace, subject);
  const { currentTime, entry } = currentEntry(key, policy.windowMs);
  if (entry.count >= policy.limit) throw rateLimited(entry.resetAt - currentTime);
  entry.count += 1;
}

function registerFailure(namespace, subject, policy) {
  const key = derivedKey(namespace, subject);
  const { currentTime, entry } = currentEntry(key, policy.windowMs);
  entry.count += 1;
  if (entry.count >= policy.limit) throw rateLimited(entry.resetAt - currentTime);
}

function clear(namespace, subject) {
  entries.delete(derivedKey(namespace, subject));
}

function requestIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function ipMiddleware(namespace, policy) {
  return function authenticationIpRateLimit(req, _res, next) {
    try {
      consume(namespace, requestIp(req), policy);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const loginIpRateLimit = (req, _res, next) => {
  try {
    const ip = requestIp(req);
    consume("login-ip-5m", ip, AUTH_RATE_LIMITS.login.ipShort);
    consume("login-ip-1h", ip, AUTH_RATE_LIMITS.login.ipLong);
    next();
  } catch (error) {
    next(error);
  }
};

export const contextIpRateLimit = ipMiddleware("context-ip", AUTH_RATE_LIMITS.context.ip);
export const passwordChangeIpRateLimit = ipMiddleware("password-change-ip", AUTH_RATE_LIMITS.passwordChange.ip);
export const invitationInspectionIpRateLimit = ipMiddleware("invitation-inspection-ip", AUTH_RATE_LIMITS.invitationInspection.ip);
export const invitationAcceptanceIpRateLimit = ipMiddleware("invitation-acceptance-ip", AUTH_RATE_LIMITS.invitationAcceptance.ip);

export function assertLoginIdentifierAvailable(identifier) {
  assertAvailable("login-identifier", identifier.trim().toLowerCase(), AUTH_RATE_LIMITS.login.identifierFailures);
}

export function registerLoginIdentifierFailure(identifier) {
  registerFailure("login-identifier", identifier.trim().toLowerCase(), AUTH_RATE_LIMITS.login.identifierFailures);
}

export function clearLoginIdentifierFailures(identifier) {
  clear("login-identifier", identifier.trim().toLowerCase());
}

export function assertContextChallengeAvailable(challenge) {
  assertAvailable("context-challenge", challenge, AUTH_RATE_LIMITS.context.challengeFailures);
}

export function registerContextChallengeFailure(challenge) {
  registerFailure("context-challenge", challenge, AUTH_RATE_LIMITS.context.challengeFailures);
}

export function clearContextChallengeFailures(challenge) {
  clear("context-challenge", challenge);
}

export function consumePasswordChangeChallenge(challenge) {
  consume("password-change-challenge", challenge, AUTH_RATE_LIMITS.passwordChange.challenge);
}

export function consumeInvitationToken(token) {
  consume("invitation-token", token, AUTH_RATE_LIMITS.invitationAcceptance.token);
}

export function consumeInvitationAdministration(actorId, hotelId, email) {
  consume("invitation-admin-actor", actorId, AUTH_RATE_LIMITS.invitationAdministration.actor);
  consume("invitation-admin-hotel-email", `${hotelId}:${email.trim().toLowerCase()}`, AUTH_RATE_LIMITS.invitationAdministration.hotelEmail);
}

export function consumeCompanyPasswordReset(actorId, targetId) {
  consume("company-password-reset-actor", actorId, AUTH_RATE_LIMITS.companyPasswordReset.actor);
  consume("company-password-reset-target", targetId, AUTH_RATE_LIMITS.companyPasswordReset.target);
}

export const authRateLimitTestSupport = Object.freeze({
  clearAll() { entries.clear(); },
  keys() { return [...entries.keys()]; },
  setNow(value) { now = typeof value === "function" ? value : () => value; },
  resetNow() { now = () => Date.now(); },
});
