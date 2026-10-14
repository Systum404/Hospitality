import { Router } from "express";
import { lookup } from "../controllers/receptionBookingLookupController.js";

export const receptionBookingLookupRouter = Router({ mergeParams: true });
receptionBookingLookupRouter.post("/", lookup);
