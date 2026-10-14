import { Router } from "express";
import { showAdminDashboard } from "../controllers/adminDashboardController.js";

export const adminDashboardRouter = Router({ mergeParams: true });
adminDashboardRouter.get("/", showAdminDashboard);
