import { AppError } from "./errorHandler.js";

export function createPublicRateLimit({ code, maxRequests, message, windowMs = 60_000 }) {
  const clients = new Map();
  return function publicRateLimit(req, _res, next) {
    const now = Date.now();
    if (clients.size > 10_000) for (const [key, value] of clients) if (value.resetAt <= now) clients.delete(key);
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const current = clients.get(key);
    if (!current || current.resetAt <= now) {
      clients.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > maxRequests) {
      const error = new AppError(message, { code, statusCode: 429 });
      error.retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      return next(error);
    }
    return next();
  };
}
