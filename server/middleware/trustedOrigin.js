import { environment } from "../config/environment.js";
import { AppError } from "./errorHandler.js";

export function requireTrustedOrigin(req, _res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const origin = req.get("origin");

  if (!origin || environment.corsOrigins.includes(origin)) {
    return next();
  }

  return next(new AppError("Request origin is not allowed.", {
    code: "UNTRUSTED_ORIGIN",
    statusCode: 403,
  }));
}
