import { Router } from "express";
import { ROLE_KEYS } from "../config/roles.js";
import { create, list, patch, remove, status } from "../controllers/roomBookingController.js";
import { authorizeRoleKeys } from "../middleware/authorizeRoles.js";

export const roomBookingRouter = Router({ mergeParams: true });
roomBookingRouter.get("/", list);
roomBookingRouter.post("/", create);
roomBookingRouter.patch("/:bookingId/status", status);
roomBookingRouter.patch("/:bookingId", patch);
roomBookingRouter.delete("/:bookingId", authorizeRoleKeys(ROLE_KEYS.MANAGER), remove);
