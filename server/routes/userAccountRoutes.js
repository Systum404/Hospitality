import { Router } from "express";
import {
  createHotelUser,
  deleteHotelUser,
  getHotelUsers,
  patchHotelUser,
  patchHotelUserStatus,
} from "../controllers/userAccountController.js";

export const userAccountRouter = Router({ mergeParams: true });

userAccountRouter.get("/", getHotelUsers);
userAccountRouter.post("/", createHotelUser);
userAccountRouter.patch("/:userId/status", patchHotelUserStatus);
userAccountRouter.patch("/:userId", patchHotelUser);
userAccountRouter.delete("/:userId", deleteHotelUser);
