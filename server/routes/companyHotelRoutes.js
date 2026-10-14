import { Router } from "express";
import {
  activateCompanyHotel,
  createHotel,
  deactivateCompanyHotel,
  getHotel,
  listHotels,
  patchHotel,
  changeHotelPlan,
} from "../controllers/companyHotelController.js";
import {
  deactivateHotelAdminAssignment,
  listHotelAdminAssignments,
  reactivateHotelAdminAssignment,
} from "../controllers/companyHotelAdminController.js";

export const companyHotelRouter = Router();

companyHotelRouter.get("/", listHotels);
companyHotelRouter.get("/:hotelId/admins", listHotelAdminAssignments);
companyHotelRouter.get("/:hotelId", getHotel);
companyHotelRouter.post("/", createHotel);
companyHotelRouter.post("/:hotelId/activate", activateCompanyHotel);
companyHotelRouter.post("/:hotelId/deactivate", deactivateCompanyHotel);
companyHotelRouter.patch("/:hotelId/plan", changeHotelPlan);
companyHotelRouter.post("/:hotelId/admins/:assignmentId/deactivate", deactivateHotelAdminAssignment);
companyHotelRouter.post("/:hotelId/admins/:assignmentId/reactivate", reactivateHotelAdminAssignment);
companyHotelRouter.patch("/:hotelId", patchHotel);
