import { Router } from "express";
import { list } from "../controllers/receptionTableStatusController.js";

export const receptionTableStatusRouter = Router({ mergeParams: true });
receptionTableStatusRouter.get("/", list);
