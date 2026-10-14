import { Router } from "express";
import { listManagerRestaurantOrders } from "../controllers/managerRestaurantOrderController.js";

export const managerRestaurantOrderRouter = Router({ mergeParams: true });

managerRestaurantOrderRouter.get("/", listManagerRestaurantOrders);
