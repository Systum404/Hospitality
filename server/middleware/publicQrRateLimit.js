import { createPublicRateLimit } from "./publicRateLimit.js";

export const publicQrRateLimit = createPublicRateLimit({
  code: "QR_RATE_LIMITED",
  maxRequests: 120,
  message: "Too many QR requests. Please try again shortly.",
});
