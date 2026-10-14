import { Router } from "express";
import { retrieve, search } from "../controllers/customerController.js";

export const customerRouter=Router({mergeParams:true});
customerRouter.get("/",search);
customerRouter.get("/:customerId",retrieve);
