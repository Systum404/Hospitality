import cors from "cors";
import express from "express";
import helmet from "helmet";
import { environment } from "./config/environment.js";
import { ROLE_KEYS } from "./config/roles.js";
import { requireAuthentication } from "./middleware/authentication.js";
import { authorizeRoleKeys } from "./middleware/authorizeRoles.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requireHotelScope } from "./middleware/hotelScope.js";
import { requireCompanyScope } from "./middleware/companyScope.js";
import { requireTrustedOrigin } from "./middleware/trustedOrigin.js";
import { authRouter } from "./routes/authRoutes.js";
import { billingRouter } from "./routes/billingRoutes.js";
import { diningAreaRouter } from "./routes/diningAreaRoutes.js";
import { diningTableRouter } from "./routes/diningTableRoutes.js";
import { discountRouter } from "./routes/discountRoutes.js";
import { validateDiscountHotelId } from "./controllers/discountController.js";
import { healthRouter } from "./routes/healthRoutes.js";
import { menuCategoryRouter } from "./routes/menuCategoryRoutes.js";
import { menuItemRouter } from "./routes/menuItemRoutes.js";
import { taxSlabRouter } from "./routes/taxSlabRoutes.js";
import { vendorRouter } from "./routes/vendorRoutes.js";
import { userAccountRouter } from "./routes/userAccountRoutes.js";
import { inventoryRouter } from "./routes/inventoryRoutes.js";
import { validateInventoryHotelId } from "./controllers/inventoryController.js";
import { roomBookingRouter } from "./routes/roomBookingRoutes.js";
import { roomAvailabilityRouter } from "./routes/roomAvailabilityRoutes.js";
import { validateRoomBookingHotelId } from "./controllers/roomBookingController.js";
import { roomRouter } from "./routes/roomRoutes.js";
import { validateRoomHotelId } from "./controllers/roomController.js";
import { roomOrderRouter } from "./routes/roomOrderRoutes.js";
import { validateRoomOrderHotelId } from "./controllers/roomOrderController.js";
import { captainRouter } from "./routes/captainRoutes.js";
import { validateCaptainHotelId } from "./controllers/captainController.js";
import { kitchenRouter } from "./routes/kitchenRoutes.js";
import { validateKitchenHotelId } from "./controllers/kitchenController.js";
import { managerRestaurantOrderRouter } from "./routes/managerRestaurantOrderRoutes.js";
import { validateManagerRestaurantOrderHotelId } from "./controllers/managerRestaurantOrderController.js";
import { managerDashboardRouter } from "./routes/managerDashboardRoutes.js";
import { validateManagerDashboardHotelId } from "./controllers/managerDashboardController.js";
import { adminDashboardRouter } from "./routes/adminDashboardRoutes.js";
import { validateAdminDashboardHotelId } from "./controllers/adminDashboardController.js";
import { adminReportsRouter } from "./routes/adminReportsRoutes.js";
import { validateAdminReportsHotelId } from "./controllers/adminReportsController.js";
import { managerReportsRouter } from "./routes/managerReportsRoutes.js";
import { validateManagerReportsHotelId } from "./controllers/managerReportsController.js";
import { receptionDashboardRouter } from "./routes/receptionDashboardRoutes.js";
import { validateReceptionDashboardHotelId } from "./controllers/receptionDashboardController.js";
import { receptionBookingLookupRouter } from "./routes/receptionBookingLookupRoutes.js";
import { receptionTableStatusRouter } from "./routes/receptionTableStatusRoutes.js";
import { receptionAttendanceRouter } from "./routes/receptionAttendanceRoutes.js";
import { validateReceptionAttendanceHotelId } from "./controllers/receptionAttendanceController.js";
import { notificationRouter } from "./routes/notificationRoutes.js";
import { validateNotificationHotelId } from "./controllers/notificationController.js";
import { customerRouter } from "./routes/customerRoutes.js";
import { validateCustomerHotelId } from "./controllers/customerController.js";
import { qrRouter } from "./routes/qrRoutes.js";
import { roomCapabilityRouter } from "./routes/roomCapabilityRoutes.js";
import { publicQrRouter } from "./routes/publicQrRoutes.js";
import { validateQrHotelId } from "./controllers/qrController.js";
import { publicQrRateLimit } from "./middleware/publicQrRateLimit.js";
import { publicOrderTrackingRateLimit } from "./middleware/publicOrderTrackingRateLimit.js";
import { customerBillingRateLimit } from "./middleware/customerBillingRateLimit.js";
import { publicOrderTrackingRouter } from "./routes/publicOrderTrackingRoutes.js";
import { customerBillingRouter } from "./routes/customerBillingRoutes.js";
import { companyHotelRouter } from "./routes/companyHotelRoutes.js";
import { companyAdminInvitationRouter } from "./routes/companyAdminInvitationRoutes.js";
import { companyUserIdentityRouter } from "./routes/companyUserIdentityRoutes.js";
import { hotelAdminInvitationRouter } from "./routes/hotelAdminInvitationRoutes.js";
import { publicAdminInvitationRouter } from "./routes/publicAdminInvitationRoutes.js";
import { validateInvitationHotelId } from "./controllers/adminInvitationController.js";
import { attachRequestContext } from "./middleware/requestContext.js";
import { hotelSettingsRouter } from "./routes/hotelSettingsRoutes.js";
import { validateHotelSettingsHotelId } from "./controllers/hotelSettingsController.js";

export const app = express();

app.disable("x-powered-by");
if (environment.trustedProxies.length) app.set("trust proxy", environment.trustedProxies);
app.use(helmet());
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || environment.corsOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  },
}));
app.use(express.json({ limit: "1mb" }));
app.use(attachRequestContext);
app.use(requireTrustedOrigin);

app.use("/api/auth", authRouter);
app.use("/api/health", healthRouter);
app.use("/api/public/admin-invitations", publicAdminInvitationRouter);
app.use(
  "/api/company",
  requireAuthentication,
  requireCompanyScope,
  authorizeRoleKeys(ROLE_KEYS.SUPER_ADMIN),
  companyUserIdentityRouter,
);
app.use(
  "/api/company",
  requireAuthentication,
  requireCompanyScope,
  authorizeRoleKeys(ROLE_KEYS.SUPER_ADMIN),
  companyAdminInvitationRouter,
);
app.use(
  "/api/company/hotels",
  requireAuthentication,
  requireCompanyScope,
  authorizeRoleKeys(ROLE_KEYS.SUPER_ADMIN),
  companyHotelRouter,
);
app.use(
  "/api/hotels/:hotelId/admin-invitations",
  requireAuthentication,
  validateInvitationHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN),
  hotelAdminInvitationRouter,
);
app.use("/api/public/order-tracking", (_req, res, next) => {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Referrer-Policy", "no-referrer");
  next();
}, publicOrderTrackingRateLimit, publicOrderTrackingRouter);
app.use("/api/public/order-billing", (_req, res, next) => {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Referrer-Policy", "no-referrer");
  next();
}, customerBillingRateLimit, customerBillingRouter);
app.use("/api/public/qr", (_req, res, next) => {
  res.set("Cache-Control", "no-store, max-age=0");
  res.set("Pragma", "no-cache");
  next();
}, publicQrRateLimit, publicQrRouter);
app.use(
  "/api/hotels/:hotelId/reception/dashboard",
  requireAuthentication,
  validateReceptionDashboardHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.RECEPTION),
  receptionDashboardRouter,
);
app.use(
  "/api/hotels/:hotelId/reception/booking-lookup",
  requireAuthentication,
  validateReceptionDashboardHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.RECEPTION),
  receptionBookingLookupRouter,
);
app.use(
  "/api/hotels/:hotelId/notifications",
  requireAuthentication,
  validateNotificationHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION, ROLE_KEYS.CAPTAIN, ROLE_KEYS.KITCHEN),
  notificationRouter,
);
// Preserve the established Reception URL while existing external clients migrate.
// It uses the same self-recipient implementation and remains Reception-only.
app.use(
  "/api/hotels/:hotelId/reception/notifications",
  requireAuthentication,
  validateNotificationHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.RECEPTION),
  notificationRouter,
);
app.use(
  "/api/hotels/:hotelId/reception/attendance",
  requireAuthentication,
  validateReceptionAttendanceHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.RECEPTION, ROLE_KEYS.MANAGER, ROLE_KEYS.HOTEL_ADMIN),
  receptionAttendanceRouter,
);
app.use(
  "/api/hotels/:hotelId/reception/table-status",
  requireAuthentication,
  validateReceptionDashboardHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.RECEPTION),
  receptionTableStatusRouter,
);
app.use("/api/hotels/:hotelId", billingRouter);
app.use(
  "/api/hotels/:hotelId/settings",
  requireAuthentication,
  validateHotelSettingsHotelId,
  requireHotelScope,
  hotelSettingsRouter,
);
app.use(
  "/api/hotels/:hotelId/dining-areas",
  requireAuthentication,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER),
  diningAreaRouter,
);
app.use(
  "/api/hotels/:hotelId/dining-tables",
  requireAuthentication,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER),
  diningTableRouter,
);
app.use(
  "/api/hotels/:hotelId/discounts",
  requireAuthentication,
  validateDiscountHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER),
  discountRouter,
);
app.use(
  "/api/hotels/:hotelId/menu-categories",
  requireAuthentication,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER),
  menuCategoryRouter,
);
app.use(
  "/api/hotels/:hotelId/menu-items",
  requireAuthentication,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER),
  menuItemRouter,
);
app.use(
  "/api/hotels/:hotelId/tax-slabs",
  requireAuthentication,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER),
  taxSlabRouter,
);
app.use(
  "/api/hotels/:hotelId/vendors",
  requireAuthentication,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER),
  vendorRouter,
);
app.use(
  "/api/hotels/:hotelId/inventory",
  requireAuthentication,
  validateInventoryHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER),
  inventoryRouter,
);
app.use(
  "/api/hotels/:hotelId/qr-codes/room-bookings",
  requireAuthentication,
  validateQrHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION),
  roomCapabilityRouter,
);
app.use(
  "/api/hotels/:hotelId/qr-codes",
  requireAuthentication,
  validateQrHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER),
  qrRouter,
);
app.use(
  "/api/hotels/:hotelId/customers",
  requireAuthentication,
  validateCustomerHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.RECEPTION, ROLE_KEYS.MANAGER, ROLE_KEYS.HOTEL_ADMIN),
  customerRouter,
);
app.use(
  "/api/hotels/:hotelId/room-availability",
  requireAuthentication,
  validateRoomBookingHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION),
  roomAvailabilityRouter,
);
app.use(
  "/api/hotels/:hotelId/room-bookings",
  requireAuthentication,
  validateRoomBookingHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION),
  roomBookingRouter,
);
app.use(
  "/api/hotels/:hotelId/rooms",
  requireAuthentication,
  validateRoomHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER),
  roomRouter,
);
app.use(
  "/api/hotels/:hotelId/room-orders",
  requireAuthentication,
  validateRoomOrderHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.MANAGER),
  roomOrderRouter,
);
app.use(
  "/api/hotels/:hotelId/admin/dashboard",
  requireAuthentication,
  validateAdminDashboardHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN),
  adminDashboardRouter,
);
app.use(
  "/api/hotels/:hotelId/admin/reports",
  requireAuthentication,
  validateAdminReportsHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN),
  adminReportsRouter,
);
app.use(
  "/api/hotels/:hotelId/manager/dashboard",
  requireAuthentication,
  validateManagerDashboardHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.MANAGER),
  managerDashboardRouter,
);
app.use(
  "/api/hotels/:hotelId/manager/reports",
  requireAuthentication,
  validateManagerReportsHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.MANAGER),
  managerReportsRouter,
);
app.use(
  "/api/hotels/:hotelId/manager/restaurant-orders",
  requireAuthentication,
  validateManagerRestaurantOrderHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.MANAGER),
  managerRestaurantOrderRouter,
);
app.use(
  "/api/hotels/:hotelId/captain",
  requireAuthentication,
  validateCaptainHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.CAPTAIN),
  captainRouter,
);
app.use(
  "/api/hotels/:hotelId/kitchen",
  requireAuthentication,
  validateKitchenHotelId,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.KITCHEN),
  kitchenRouter,
);
app.use(
  "/api/hotels/:hotelId/users",
  requireAuthentication,
  requireHotelScope,
  authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN),
  userAccountRouter,
);

app.use(notFoundHandler);
app.use(errorHandler);
