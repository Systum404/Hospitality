import { createPublicRateLimit } from "./publicRateLimit.js";

export const customerBillingRateLimit = createPublicRateLimit({
  code: "CUSTOMER_BILLING_RATE_LIMITED",
  maxRequests: 60,
  message: "Too many billing requests. Please try again shortly.",
});
