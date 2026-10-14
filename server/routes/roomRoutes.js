import { Router } from "express";
import { create, list, patch, remove, status } from "../controllers/roomController.js";

export const roomRouter = Router({ mergeParams: true });

roomRouter.get("/", list);
roomRouter.post("/", create);
roomRouter.patch("/:roomId/status", status);
roomRouter.patch("/:roomId", patch);
roomRouter.delete("/:roomId", remove);
