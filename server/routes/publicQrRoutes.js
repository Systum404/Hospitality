import { Router } from "express";
import { menu, order, resolve, verify } from "../controllers/publicQrController.js";
import { publicOrderRateLimit } from "../middleware/publicOrderRateLimit.js";

export const publicQrRouter = Router();
publicQrRouter.get("/:token/menu", menu);
publicQrRouter.post("/:token/room-capability", verify);
publicQrRouter.post("/:token/orders", publicOrderRateLimit, order);
publicQrRouter.get("/:token", resolve);
