import { Router } from "express";
import { list, record } from "../controllers/receptionAttendanceController.js";

export const receptionAttendanceRouter = Router({ mergeParams: true });
receptionAttendanceRouter.get("/", list);
receptionAttendanceRouter.put("/", record);
