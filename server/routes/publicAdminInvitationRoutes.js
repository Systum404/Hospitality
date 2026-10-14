import { Router } from "express";
import { publicAccept, publicSelectPlan, publicValidate } from "../controllers/adminInvitationController.js";
import { invitationAcceptanceIpRateLimit, invitationInspectionIpRateLimit } from "../middleware/authRateLimit.js";

export const publicAdminInvitationRouter = Router();

publicAdminInvitationRouter.get("/:token", invitationInspectionIpRateLimit, publicValidate);
publicAdminInvitationRouter.post("/:token/accept", invitationAcceptanceIpRateLimit, publicAccept);
publicAdminInvitationRouter.post("/:token/plan", invitationAcceptanceIpRateLimit, publicSelectPlan);
