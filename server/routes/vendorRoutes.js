import { Router } from "express"; import { create,list,patch,remove,status } from "../controllers/vendorController.js";
export const vendorRouter=Router({mergeParams:true});vendorRouter.get("/",list);vendorRouter.post("/",create);vendorRouter.patch("/:vendorId/status",status);vendorRouter.patch("/:vendorId",patch);vendorRouter.delete("/:vendorId",remove);
