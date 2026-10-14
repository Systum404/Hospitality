import { Router } from "express";
import {
  deactivateUserIdentity,
  reactivateUserIdentity,
  resetUserPassword,
} from "../controllers/companyUserIdentityController.js";

export const companyUserIdentityRouter = Router();

companyUserIdentityRouter.post("/users/:userId/deactivate", deactivateUserIdentity);
companyUserIdentityRouter.post("/users/:userId/reactivate", reactivateUserIdentity);
companyUserIdentityRouter.post("/users/:userId/password-reset", resetUserPassword);
