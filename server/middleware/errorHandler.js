import { environment } from "../config/environment.js";
import { recordPlanLimitRejection } from "../services/planLimitAuditService.js";

export class AppError extends Error {
  constructor(message, { code = "INTERNAL_ERROR", statusCode = 500 } = {}) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function notFoundHandler(req, _res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, {
    code: "ROUTE_NOT_FOUND",
    statusCode: 404,
  }));
}

export async function errorHandler(error, req, res, _next) {
  if (!error.statusCode && `${error.message ?? ""} ${JSON.stringify(error.meta ?? {})}`.includes("HOTEL_INACTIVE")) {
    error = new AppError("Hotel operations are unavailable.", { code: "HOTEL_INACTIVE", statusCode: 403 });
  }
  // PostgreSQL billing guards also protect writes through the existing order APIs.
  const financialCodes = ["BILLED_SOURCE_LOCKED", "BILL_HISTORY_IMMUTABLE", "BILL_SOURCE_SCOPE_MISMATCH", "BILL_IDENTITY_IMMUTABLE", "BILL_SNAPSHOT_IMMUTABLE", "INVALID_BILL_TRANSITION", "PAYMENT_LEDGER_MISMATCH", "BILL_HAS_PAYMENTS", "PAYMENT_HISTORY_IMMUTABLE", "BILL_NOT_PAYABLE", "INVALID_PAYMENT_AMOUNT", "ROOM_ORDERS_UNFINISHED", "LEGACY_PAYMENT_RECONCILIATION_REQUIRED"];
  const diagnostic = `${error.message ?? ""} ${JSON.stringify(error.meta ?? {})}`;
  const guard = financialCodes.find(code => diagnostic.includes(code));
  if (guard && !error.statusCode) error = new AppError(
    guard === "BILLED_SOURCE_LOCKED" ? "This booking/order has a locked bill. No charges may be added, changed, or removed."
      : "This change conflicts with the bill's financial history or current payment state.",
    { code: guard, statusCode: 409 },
  );
  const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  const code = error.code || "INTERNAL_ERROR";
  const message = statusCode >= 500 && environment.isProduction
    ? "An unexpected server error occurred."
    : error.message;

  if (statusCode >= 500) {
    console.error(error);
  }

  if (["PLAN_LIMIT_REACHED", "PLAN_NOT_SELECTED"].includes(code) && error.planAudit) {
    try {
      await recordPlanLimitRejection(error, req);
    } catch (auditError) {
      console.error("Unable to persist plan-limit audit event.", auditError);
    }
  }

  if (statusCode === 429 && Number.isInteger(error.retryAfterSeconds)) {
    res.set("Retry-After", String(error.retryAfterSeconds));
  }

  res.status(statusCode).json({
    status: "error",
    error: {
      code,
      message,
    },
  });
}
