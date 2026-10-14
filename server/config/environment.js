import "dotenv/config";
import { randomBytes } from "node:crypto";
import { isIP } from "node:net";

const isProduction = process.env.NODE_ENV === "production";

function required(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parsePort(value) {
  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return port;
}

const configuredCorsOrigins = process.env.CORS_ORIGIN?.trim();
if (isProduction && !configuredCorsOrigins) {
  throw new Error("Missing required environment variable: CORS_ORIGIN");
}

const corsOrigins = (configuredCorsOrigins || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

for (const origin of corsOrigins) {
  let parsed;
  try { parsed = new URL(origin); } catch { throw new Error("CORS_ORIGIN must contain valid HTTP(S) origins."); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin || origin === "*") {
    throw new Error("CORS_ORIGIN must contain explicit HTTP(S) origins without paths or wildcards.");
  }
  if (isProduction && parsed.protocol !== "https:") {
    throw new Error("CORS_ORIGIN must contain only HTTPS origins in production.");
  }
}

const trustedProxies = (process.env.TRUST_PROXY || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

for (const proxy of trustedProxies) {
  const [address, prefix, extra] = proxy.split("/");
  const family = isIP(address);
  const prefixNumber = prefix === undefined ? null : Number(prefix);
  const maximumPrefix = family === 4 ? 32 : 128;
  if (!family || extra !== undefined || (prefix !== undefined && (!Number.isInteger(prefixNumber) || prefixNumber < 0 || prefixNumber > maximumPrefix))) {
    throw new Error("TRUST_PROXY must contain only explicit IP addresses or CIDR ranges.");
  }
}

function positiveInteger(name, value, fallback) {
  const parsed = Number.parseInt(value || fallback, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function authenticationSecret(isProduction) {
  const configuredSecret = process.env.AUTH_SECRET?.trim();

  if (configuredSecret) {
    if (configuredSecret.length < 32) {
      throw new Error("AUTH_SECRET must contain at least 32 characters.");
    }

    return configuredSecret;
  }

  if (isProduction) {
    throw new Error("Missing required environment variable: AUTH_SECRET");
  }

  console.warn("AUTH_SECRET is not configured; using an ephemeral development-only secret. Set AUTH_SECRET in the root .env for stable local sessions.");
  return randomBytes(32).toString("hex");
}

export const environment = Object.freeze({
  authAudience: process.env.AUTH_AUDIENCE?.trim() || "aazira-hms-web",
  authContextChallengeTtlSeconds: positiveInteger("AUTH_CONTEXT_CHALLENGE_TTL_SECONDS", process.env.AUTH_CONTEXT_CHALLENGE_TTL_SECONDS, "300"),
  passwordChangeChallengeTtlSeconds: positiveInteger("PASSWORD_CHANGE_CHALLENGE_TTL_SECONDS", process.env.PASSWORD_CHANGE_CHALLENGE_TTL_SECONDS, "600"),
  authIssuer: process.env.AUTH_ISSUER?.trim() || "aazira-hms",
  authRememberTtlSeconds: positiveInteger("AUTH_REMEMBER_TTL_SECONDS", process.env.AUTH_REMEMBER_TTL_SECONDS, "28800"),
  authSecret: authenticationSecret(isProduction),
  authTokenTtlSeconds: positiveInteger("AUTH_TOKEN_TTL_SECONDS", process.env.AUTH_TOKEN_TTL_SECONDS, "1800"),
  corsOrigins,
  databaseUrl: required("DATABASE_URL"),
  isProduction,
  nodeEnv: process.env.NODE_ENV || "development",
  port: parsePort(process.env.PORT || "4000"),
  trustedProxies,
});
