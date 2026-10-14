import { Router } from "express";
import { list, markAllRead, markRead } from "../controllers/notificationController.js";

export const notificationRouter = Router({ mergeParams: true });
notificationRouter.get("/", list);
notificationRouter.patch("/read-all", markAllRead);
notificationRouter.patch("/:notificationId/read", markRead);
