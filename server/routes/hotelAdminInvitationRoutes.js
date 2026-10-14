import { Router } from "express";
import { hotelCreate, hotelList, hotelResend, hotelRevoke } from "../controllers/adminInvitationController.js";

export const hotelAdminInvitationRouter = Router({ mergeParams: true });

hotelAdminInvitationRouter.get("/", hotelList);
hotelAdminInvitationRouter.post("/", hotelCreate);
hotelAdminInvitationRouter.post("/:invitationId/resend", hotelResend);
hotelAdminInvitationRouter.post("/:invitationId/revoke", hotelRevoke);
