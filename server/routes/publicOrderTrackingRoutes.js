import { Router } from "express";
import { get } from "../controllers/publicOrderTrackingController.js";

export const publicOrderTrackingRouter = Router();
publicOrderTrackingRouter.get("/", get);
