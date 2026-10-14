import { Router } from "express";
import { createHotelDiscount, deleteHotelDiscount, getHotelDiscounts, updateHotelDiscount, updateHotelDiscountStatus } from "../controllers/discountController.js";

export const discountRouter = Router({ mergeParams: true });

discountRouter.get("/", getHotelDiscounts);
discountRouter.post("/", createHotelDiscount);
discountRouter.patch("/:discountId/status", updateHotelDiscountStatus);
discountRouter.patch("/:discountId", updateHotelDiscount);
discountRouter.delete("/:discountId", deleteHotelDiscount);
