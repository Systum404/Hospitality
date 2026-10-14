import { Router } from "express";
import { createOrder, handoffOrder, patchOrder, patchTableStatus, removeOrder, workspace } from "../controllers/captainController.js";
export const captainRouter = Router({ mergeParams: true });
captainRouter.get("/workspace", workspace);
captainRouter.post("/orders", createOrder);
captainRouter.post("/orders/:orderId/kitchen-handoff", handoffOrder);
captainRouter.patch("/orders/:orderId", patchOrder);
captainRouter.delete("/orders/:orderId", removeOrder);
captainRouter.patch("/tables/:tableId/status", patchTableStatus);
