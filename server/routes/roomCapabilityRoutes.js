import { Router } from "express";
import { capability } from "../controllers/qrController.js";

export const roomCapabilityRouter = Router({ mergeParams: true });

roomCapabilityRouter.post("/:bookingId/capability", capability);
