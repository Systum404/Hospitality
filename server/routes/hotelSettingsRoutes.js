import { Router } from "express";
import { ROLE_KEYS } from "../config/roles.js";
import { authorizeRoleKeys } from "../middleware/authorizeRoles.js";
import { requireTrustedOrigin } from "../middleware/trustedOrigin.js";
import { getSettings, patchBillingSettings, patchHotelSettings } from "../controllers/hotelSettingsController.js";

export const hotelSettingsRouter = Router({ mergeParams: true });
hotelSettingsRouter.get("/", authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER), getSettings);
hotelSettingsRouter.patch("/billing", authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN), requireTrustedOrigin, patchBillingSettings);
hotelSettingsRouter.patch("/hotel", authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN), requireTrustedOrigin, patchHotelSettings);
