import { Router } from "express";
import {
  createHotelDiningArea,
  deleteHotelDiningArea,
  getHotelDiningAreas,
  patchHotelDiningArea,
  patchHotelDiningAreaStatus,
} from "../controllers/diningAreaController.js";

export const diningAreaRouter = Router({ mergeParams: true });

diningAreaRouter.get("/", getHotelDiningAreas);
diningAreaRouter.post("/", createHotelDiningArea);
diningAreaRouter.patch("/:areaId/status", patchHotelDiningAreaStatus);
diningAreaRouter.patch("/:areaId", patchHotelDiningArea);
diningAreaRouter.delete("/:areaId", deleteHotelDiningArea);
