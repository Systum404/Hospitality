import { Router } from "express";
import { showManagerDashboard } from "../controllers/managerDashboardController.js";

export const managerDashboardRouter = Router({ mergeParams: true });

managerDashboardRouter.get("/", showManagerDashboard);
