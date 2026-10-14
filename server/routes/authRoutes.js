import { Router } from "express";
import { changePassword, login, logout, selectContext, session } from "../controllers/authController.js";
import { requireAuthentication } from "../middleware/authentication.js";
import { contextIpRateLimit, loginIpRateLimit, passwordChangeIpRateLimit } from "../middleware/authRateLimit.js";
import { requireTrustedOrigin } from "../middleware/trustedOrigin.js";

export const authRouter = Router();

authRouter.post("/login", requireTrustedOrigin, loginIpRateLimit, login);
authRouter.post("/context", requireTrustedOrigin, contextIpRateLimit, selectContext);
authRouter.post("/password-change", requireTrustedOrigin, passwordChangeIpRateLimit, changePassword);
authRouter.get("/session", requireAuthentication, session);
authRouter.post("/logout", requireTrustedOrigin, logout);
