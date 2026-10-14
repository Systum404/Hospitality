import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { environment } from "../config/environment.js";

const signingKey = new TextEncoder().encode(environment.authSecret);
const algorithm = "HS256";

export async function createAuthenticationToken({ credentialVersion = 0, userId, userRoleId }, expiresInSeconds) {
  return new SignJWT({ credentialVersion, userRoleId })
    .setProtectedHeader({ alg: algorithm, typ: "JWT" })
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setIssuer(environment.authIssuer)
    .setAudience(environment.authAudience)
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(signingKey);
}

export async function verifyAuthenticationToken(token) {
  const { payload } = await jwtVerify(token, signingKey, {
    algorithms: [algorithm],
    audience: environment.authAudience,
    issuer: environment.authIssuer,
  });

  const credentialVersion = payload.credentialVersion ?? 0;
  if (typeof payload.sub !== "string" || typeof payload.userRoleId !== "string" || typeof payload.jti !== "string"
    || !Number.isInteger(credentialVersion) || credentialVersion < 0) {
    throw new Error("Authentication token claims are invalid.");
  }

  return {
    jti: payload.jti,
    credentialVersion,
    userId: payload.sub,
    userRoleId: payload.userRoleId,
  };
}
