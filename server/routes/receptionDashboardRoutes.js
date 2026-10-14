import { Router } from "express";
import { dashboard } from "../controllers/receptionDashboardController.js";

export const receptionDashboardRouter = Router({ mergeParams: true });
receptionDashboardRouter.get("/", dashboard);
