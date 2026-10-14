import { Router } from "express";
import { companyCreate, companyList, companyResend, companyRevoke } from "../controllers/adminInvitationController.js";

export const companyAdminInvitationRouter = Router();

companyAdminInvitationRouter.get("/hotels/:hotelId/admin-invitations", companyList);
companyAdminInvitationRouter.post("/hotels/:hotelId/admin-invitations", companyCreate);
companyAdminInvitationRouter.post("/admin-invitations/:invitationId/resend", companyResend);
companyAdminInvitationRouter.post("/admin-invitations/:invitationId/revoke", companyRevoke);
