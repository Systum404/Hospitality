import { createPublicRateLimit } from "./publicRateLimit.js";

export const publicOrderTrackingRateLimit = createPublicRateLimit({
  code: "TRACKING_RATE_LIMITED",
  maxRequests: 60,
  message: "Too many tracking requests. Please try again shortly.",
});
