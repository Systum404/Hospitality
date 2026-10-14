import { randomUUID } from "node:crypto";

function sanitizedUserAgent(value) {
  if (typeof value !== "string") return null;
  const sanitized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (/(authorization|bearer|cookie|jwt|password|secret|token|api.?key)/i.test(sanitized)) return null;
  return sanitized ? sanitized.slice(0, 512) : null;
}

function requestIp(req) {
  const value = req.ip || req.socket?.remoteAddress;
  return typeof value === "string" && value.length <= 64 ? value : null;
}

export function attachRequestContext(req, res, next) {
  const requestId = randomUUID();
  req.auditContext = Object.freeze({
    ipAddress: requestIp(req),
    requestId,
    userAgent: sanitizedUserAgent(req.get("user-agent")),
  });
  res.set("X-Request-ID", requestId);
  next();
}
