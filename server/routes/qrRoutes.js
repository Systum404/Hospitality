import { Router } from "express";
import { create, list, retrieve, rotate, status } from "../controllers/qrController.js";

export const qrRouter = Router({ mergeParams: true });
qrRouter.get("/", list);
qrRouter.post("/", create);
qrRouter.get("/:qrId", retrieve);
qrRouter.patch("/:qrId/status", status);
qrRouter.post("/:qrId/rotate", rotate);
