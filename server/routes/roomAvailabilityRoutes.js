import { Router } from "express";
import { availability } from "../controllers/roomBookingController.js";

export const roomAvailabilityRouter = Router({ mergeParams: true });
roomAvailabilityRouter.get("/", availability);
