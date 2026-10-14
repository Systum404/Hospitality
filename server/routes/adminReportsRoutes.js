import { Router } from "express";
import { showAdminReport } from "../controllers/adminReportsController.js";

export const adminReportsRouter = Router({ mergeParams: true });

adminReportsRouter.get("/", showAdminReport);
