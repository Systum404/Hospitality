import { Router } from "express";
import {
  createHotelTaxSlab,
  deleteHotelTaxSlab,
  getHotelTaxSlabs,
  patchHotelTaxSlab,
  patchHotelTaxSlabStatus,
} from "../controllers/taxSlabController.js";

export const taxSlabRouter = Router({ mergeParams: true });

taxSlabRouter.get("/", getHotelTaxSlabs);
taxSlabRouter.post("/", createHotelTaxSlab);
taxSlabRouter.patch("/:taxSlabId/status", patchHotelTaxSlabStatus);
taxSlabRouter.patch("/:taxSlabId", patchHotelTaxSlab);
taxSlabRouter.delete("/:taxSlabId", deleteHotelTaxSlab);
