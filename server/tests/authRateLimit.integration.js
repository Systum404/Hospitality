import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  assertContextChallengeAvailable,
  assertLoginIdentifierAvailable,
  authRateLimitTestSupport,
  clearLoginIdentifierFailures,
  consumeCompanyPasswordReset,
  consumeInvitationAdministration,
  consumeInvitationToken,
  consumePasswordChangeChallenge,
  contextIpRateLimit,
  invitationAcceptanceIpRateLimit,
  invitationInspectionIpRateLimit,
  loginIpRateLimit,
  passwordChangeIpRateLimit,
  registerContextChallengeFailure,
  registerLoginIdentifierFailure,
} from "../middleware/authRateLimit.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { app } from "../app.js";
import { acceptAdminInvitation } from "../services/adminInvitationService.js";
import { completeForcedPasswordChange } from "../services/authService.js";
import { prisma } from "../db/prisma.js";

const results = [];
const pass = name => results.push(name);
const limited = operation => assert.throws(operation, error => error?.statusCode === 429 && error?.code === "AUTH_RATE_LIMITED" && Number.isInteger(error.retryAfterSeconds));
const middlewareAttempt = (middleware, ip = "192.0.2.10") => {
  let outcome = null;
  middleware({ ip, socket: {} }, {}, error => { outcome = error || true; });
  if (outcome instanceof Error) throw outcome;
  assert.equal(outcome, true);
};

try {
  let clock = 1_800_000_000_000;
  authRateLimitTestSupport.setNow(() => clock);

  for (let index = 0; index < 30; index += 1) middlewareAttempt(loginIpRateLimit);
  limited(() => middlewareAttempt(loginIpRateLimit));
  pass("login IP threshold is enforced");

  authRateLimitTestSupport.clearAll();
  const identifier = "Rate-Limit.User@Example.invalid";
  for (let index = 0; index < 4; index += 1) registerLoginIdentifierFailure(identifier);
  assertLoginIdentifierAvailable(identifier.toLowerCase());
  limited(() => registerLoginIdentifierFailure(identifier));
  limited(() => assertLoginIdentifierAvailable(identifier));
  clock += 15 * 60_000 + 1;
  assertLoginIdentifierAvailable(identifier);
  registerLoginIdentifierFailure(identifier);
  clearLoginIdentifierFailures(identifier);
  assertLoginIdentifierAvailable(identifier);
  pass("identifier cooldown is normalized, expiring, and cleared after success");

  authRateLimitTestSupport.clearAll();
  for (let index = 0; index < 20; index += 1) middlewareAttempt(contextIpRateLimit);
  limited(() => middlewareAttempt(contextIpRateLimit));
  const challenge = randomBytes(32).toString("base64url");
  for (let index = 0; index < 4; index += 1) registerContextChallengeFailure(challenge);
  assertContextChallengeAvailable(challenge);
  limited(() => registerContextChallengeFailure(challenge));
  pass("context IP and invalid-challenge thresholds are enforced");

  authRateLimitTestSupport.clearAll();
  for (let index = 0; index < 10; index += 1) middlewareAttempt(passwordChangeIpRateLimit);
  limited(() => middlewareAttempt(passwordChangeIpRateLimit));
  for (let index = 0; index < 5; index += 1) consumePasswordChangeChallenge(challenge);
  limited(() => consumePasswordChangeChallenge(challenge));
  pass("forced-password IP and challenge thresholds are enforced");

  authRateLimitTestSupport.clearAll();
  for (let index = 0; index < 60; index += 1) middlewareAttempt(invitationInspectionIpRateLimit);
  limited(() => middlewareAttempt(invitationInspectionIpRateLimit));
  for (let index = 0; index < 10; index += 1) middlewareAttempt(invitationAcceptanceIpRateLimit, "192.0.2.11");
  limited(() => middlewareAttempt(invitationAcceptanceIpRateLimit, "192.0.2.11"));
  const invitationToken = randomBytes(32).toString("base64url");
  for (let index = 0; index < 5; index += 1) consumeInvitationToken(invitationToken);
  limited(() => consumeInvitationToken(invitationToken));
  pass("invitation inspection, acceptance IP, and token thresholds are enforced");

  authRateLimitTestSupport.clearAll();
  const actor = randomUUID();
  const hotel = randomUUID();
  for (let index = 0; index < 5; index += 1) consumeInvitationAdministration(actor, hotel, "Invitee@Example.invalid");
  limited(() => consumeInvitationAdministration(actor, hotel, "invitee@example.invalid"));
  authRateLimitTestSupport.clearAll();
  for (let index = 0; index < 10; index += 1) consumeCompanyPasswordReset(actor, randomUUID());
  limited(() => consumeCompanyPasswordReset(actor, randomUUID()));
  authRateLimitTestSupport.clearAll();
  const target = randomUUID();
  for (let index = 0; index < 3; index += 1) consumeCompanyPasswordReset(randomUUID(), target);
  limited(() => consumeCompanyPasswordReset(randomUUID(), target));
  pass("administrative invitation and password-reset subject limits are enforced");

  const keys = authRateLimitTestSupport.keys().join("|");
  assert.equal(keys.includes(identifier.toLowerCase()), false);
  assert.equal(keys.includes(challenge), false);
  assert.equal(keys.includes(invitationToken), false);
  assert.match(keys, /^[a-z0-9-]+:[0-9a-f]{64}(\|[a-z0-9-]+:[0-9a-f]{64})*$/);
  pass("limiter state contains only namespaced HMAC-derived subjects");

  const randomChallenge = randomBytes(32).toString("base64url");
  let passwordHashCalls = 0;
  await assert.rejects(
    () => completeForcedPasswordChange(randomChallenge, "valid-audit-password", {}, { hashPassword: async () => { passwordHashCalls += 1; return "unused"; } }),
    error => error?.code === "PASSWORD_CHANGE_INVALID",
  );
  assert.equal(passwordHashCalls, 0);
  pass("invalid password-change challenges are rejected before Argon2 hashing");

  let invitationHashCalls = 0;
  await assert.rejects(
    () => acceptAdminInvitation(randomChallenge, { fullName: "Audit", mobileNumber: "+91 90000 00000", password: "valid-audit-password" }, {}, { hashPassword: async () => { invitationHashCalls += 1; return "unused"; } }),
    error => error?.code === "ADMIN_INVITATION_INVALID",
  );
  assert.equal(invitationHashCalls, 0);
  pass("invalid invitation tokens are rejected before Argon2 hashing");

  const error = Object.assign(new Error("Too many requests. Please try again later."), { code: "AUTH_RATE_LIMITED", statusCode: 429, retryAfterSeconds: 37 });
  const headers = {};
  let responseStatus;
  let responseBody;
  const response = {
    set(name, value) { headers[name] = value; return this; },
    status(value) { responseStatus = value; return this; },
    json(value) { responseBody = value; return this; },
  };
  errorHandler(error, {}, response, () => {});
  assert.equal(responseStatus, 429);
  assert.equal(headers["Retry-After"], "37");
  assert.deepEqual(responseBody, { status: "error", error: { code: "AUTH_RATE_LIMITED", message: "Too many requests. Please try again later." } });
  pass("429 responses use the standard generic envelope and Retry-After");

  const known = await prisma.users.findFirst({ where: { is_active: true, password_hash: { not: null } }, select: { email: true } });
  assert.ok(known, "A local active credential fixture is required for indistinguishability verification.");
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const attempt = async identifier => {
      const current = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
        body: JSON.stringify({ identifier, password: `wrong-${randomUUID()}`, remember: false }),
      });
      return { body: await current.json(), retryAfter: current.headers.get("retry-after"), status: current.status };
    };
    const exercise = async identifier => {
      const responses = [];
      for (let index = 0; index < 5; index += 1) responses.push(await attempt(identifier));
      return responses;
    };
    authRateLimitTestSupport.clearAll();
    const unknownResponses = await exercise(`unknown-${randomUUID()}@example.invalid`);
    authRateLimitTestSupport.clearAll();
    const knownResponses = await exercise(known.email);
    assert.deepEqual(knownResponses.map(item => item.status), unknownResponses.map(item => item.status));
    assert.deepEqual(knownResponses.map(item => item.body.error.code), ["INVALID_CREDENTIALS", "INVALID_CREDENTIALS", "INVALID_CREDENTIALS", "INVALID_CREDENTIALS", "AUTH_RATE_LIMITED"]);
    assert.deepEqual(knownResponses.map(item => item.body.error.code), unknownResponses.map(item => item.body.error.code));
    assert.equal(Number(knownResponses.at(-1).retryAfter) > 0, true);
    assert.equal(Number(unknownResponses.at(-1).retryAfter) > 0, true);
    pass("known and unknown identifiers remain indistinguishable through cooldown");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
} finally {
  authRateLimitTestSupport.clearAll();
  authRateLimitTestSupport.resetNow();
  await prisma.$disconnect();
}

console.log(`Authentication rate-limit integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
