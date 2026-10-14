import { Router } from "express";
import { get, pdf } from "../controllers/customerBillingController.js";

export const customerBillingRouter = Router();
customerBillingRouter.get("/", get);
customerBillingRouter.get("/pdf", pdf);

