import { Router } from "express";
import {
  createHotelDiningTable,
  deleteHotelDiningTable,
  patchHotelDiningTable,
  patchHotelDiningTableStatus,
} from "../controllers/diningTableController.js";

export const diningTableRouter = Router({ mergeParams: true });

diningTableRouter.post("/", createHotelDiningTable);
diningTableRouter.patch("/:tableId/status", patchHotelDiningTableStatus);
diningTableRouter.patch("/:tableId", patchHotelDiningTable);
diningTableRouter.delete("/:tableId", deleteHotelDiningTable);
