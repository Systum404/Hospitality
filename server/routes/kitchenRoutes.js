import { Router } from "express";
import { listKitchenOrders, patchKitchenOrderStatus } from "../controllers/kitchenController.js";
export const kitchenRouter = Router({ mergeParams: true });
kitchenRouter.get("/orders", listKitchenOrders);
kitchenRouter.patch("/orders/:orderId/status", patchKitchenOrderStatus);
