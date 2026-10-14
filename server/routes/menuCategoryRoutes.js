import { Router } from "express";
import {
  createHotelMenuCategory,
  deleteHotelMenuCategory,
  getHotelMenuCategories,
  patchHotelMenuCategory,
  patchHotelMenuCategoryStatus,
} from "../controllers/menuCategoryController.js";

export const menuCategoryRouter = Router({ mergeParams: true });

menuCategoryRouter.get("/", getHotelMenuCategories);
menuCategoryRouter.post("/", createHotelMenuCategory);
menuCategoryRouter.patch("/:categoryId/status", patchHotelMenuCategoryStatus);
menuCategoryRouter.patch("/:categoryId", patchHotelMenuCategory);
menuCategoryRouter.delete("/:categoryId", deleteHotelMenuCategory);
