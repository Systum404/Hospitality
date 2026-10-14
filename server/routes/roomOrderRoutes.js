import { Router } from "express";
import { create, list, patch, remove, status } from "../controllers/roomOrderController.js";

export const roomOrderRouter = Router({ mergeParams: true });
roomOrderRouter.get("/", list);
roomOrderRouter.post("/", create);
roomOrderRouter.patch("/:orderId/status", status);
roomOrderRouter.patch("/:orderId", patch);
roomOrderRouter.delete("/:orderId", remove);
