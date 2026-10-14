import { AppError } from "../middleware/errorHandler.js";

export const ORDER_STATUSES = new Set(["pending", "preparing", "ready", "completed"]);
const NEXT_STATUS = { pending: "preparing", preparing: "ready", ready: "completed", completed: null };

export function assertOrderStatusTransition(currentStatus, nextStatus) {
  if (!ORDER_STATUSES.has(nextStatus)) {
    throw new AppError("status is invalid.", { code: "INVALID_ORDER_STATUS", statusCode: 400 });
  }

  if (nextStatus !== currentStatus && NEXT_STATUS[currentStatus] !== nextStatus) {
    throw new AppError("The requested order status transition is not supported.", {
      code: "INVALID_ORDER_STATUS_TRANSITION",
      statusCode: 409,
    });
  }
}
