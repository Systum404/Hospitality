import { createPublicRateLimit } from "./publicRateLimit.js";

export const publicOrderRateLimit = createPublicRateLimit({
  code: "PUBLIC_ORDER_RATE_LIMITED",
  maxRequests: 30,
  message: "Too many order requests. Please try again shortly.",
});
