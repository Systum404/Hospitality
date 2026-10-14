import { Router } from "express";
import { showManagerReport } from "../controllers/managerReportsController.js";

export const managerReportsRouter = Router({ mergeParams: true });

managerReportsRouter.get("/", showManagerReport);
