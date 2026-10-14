import { Router } from "express";
import {
  createHotelMenuItem,
  deleteHotelMenuItem,
  getHotelMenuItems,
  patchHotelMenuItem,
  patchHotelMenuItemStatus,
} from "../controllers/menuItemController.js";

export const menuItemRouter = Router({ mergeParams: true });

menuItemRouter.get("/", getHotelMenuItems);
menuItemRouter.post("/", createHotelMenuItem);
menuItemRouter.patch("/:itemId/status", patchHotelMenuItemStatus);
menuItemRouter.patch("/:itemId", patchHotelMenuItem);
menuItemRouter.delete("/:itemId", deleteHotelMenuItem);
