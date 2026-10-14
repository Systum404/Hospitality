import { Navigate, createBrowserRouter, useRouteError } from "react-router-dom";
import { DesignSystemPage } from "../pages/DesignSystemPage.jsx";
import { AdminDashboard as AdminDashboardPage } from "../features/admin/pages/AdminDashboard.jsx";
import { AdminAreasTablesPage } from "../features/admin/pages/AdminAreasTablesPage.jsx";
import { AdminMenuManagementPage } from "../features/admin/pages/AdminMenuManagementPage.jsx";
import { AdminTaxSlabsPage } from "../features/admin/pages/AdminTaxSlabsPage.jsx";
import { AdminDiscountsPage } from "../features/admin/pages/AdminDiscountsPage.jsx";
import { AdminVendorManagementPage } from "../features/admin/pages/AdminVendorManagementPage.jsx";
import { AdminUserAccountsPage } from "../features/admin/pages/AdminUserAccountsPage.jsx";
import { AdminReportsPage } from "../features/admin/pages/AdminReportsPage.jsx";
import { AdminInventoryPage } from "../features/admin/pages/AdminInventoryPage.jsx";
import { RoomManagementPage } from "../features/admin/pages/RoomManagementPage.jsx";
import { AdminSettingsPage } from "../features/admin/pages/AdminSettingsPage.jsx";
import { ManagerDashboard as ManagerDashboardPage } from "../features/manager/pages/ManagerDashboard.jsx";
import { ManagerRestaurantOrdersPage } from "../features/manager/pages/ManagerRestaurantOrdersPage.jsx";
import { ManagerRestaurantBillingPage } from "../features/manager/pages/ManagerRestaurantBillingPage.jsx";
import { managerNavigationGroups, managerProfile } from "../features/manager/managerConfig.js";
import { ReceptionDashboard as ReceptionDashboardPage } from "../features/reception/pages/ReceptionDashboard.jsx";
import { GuestCheckIn as ReceptionGuestCheckInPage } from "../features/reception/pages/GuestCheckIn.jsx";
import { TableStatus as ReceptionTableStatusPage } from "../features/reception/pages/TableStatus.jsx";
import { RoomBooking as ReceptionRoomBookingPage } from "../features/reception/pages/RoomBooking.jsx";
import { Billing as ReceptionBillingPage } from "../features/reception/pages/Billing.jsx";
import { Attendance as ReceptionAttendancePage } from "../features/reception/pages/Attendance.jsx";
import { CaptainDashboard as CaptainDashboardPage } from "../features/captain/pages/CaptainDashboard.jsx";
import { CaptainTables as CaptainTablesPage } from "../features/captain/pages/CaptainTables.jsx";
import { CaptainTakeOrder as CaptainTakeOrderPage } from "../features/captain/pages/CaptainTakeOrder.jsx";
import { CaptainManageOrders as CaptainManageOrdersPage } from "../features/captain/pages/CaptainManageOrders.jsx";
import { KitchenDashboard as KitchenDashboardPage } from "../features/kitchen/pages/KitchenDashboard.jsx";
import { KitchenOrderQueue as KitchenOrderQueuePage } from "../features/kitchen/pages/KitchenOrderQueue.jsx";
import { ProtectedRoute, PublicOnlyRoute, StaffAuthBoundary } from "../features/auth/AuthContext.jsx";
import { Login } from "../features/auth/pages/Login.jsx";
import { SuperAdminOverview } from "../features/super-admin/pages/SuperAdminOverview.jsx";
import { SuperAdminHotels } from "../features/super-admin/pages/SuperAdminHotels.jsx";
import { SuperAdminHotelDetails } from "../features/super-admin/pages/SuperAdminHotelDetails.jsx";
import { SuperAdminHotelAdmins } from "../features/super-admin/pages/SuperAdminHotelAdmins.jsx";
import { PublicQrOrderingPage } from "../features/public-ordering/pages/PublicQrOrderingPage.jsx";
import { PublicOrderTrackingPage } from "../features/public-ordering/pages/PublicOrderTrackingPage.jsx";
import { AdminInvitationAcceptancePage } from "../features/admin-invitation/pages/AdminInvitationAcceptancePage.jsx";
import { RolePlaceholder } from "../pages/RolePlaceholder.jsx";

const demonstrationNavigationRoutes = ["guests", "rooms", "tables", "bookings", "orders", "billing"];

function RouteError() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : "This route could not be displayed.";

  return (
    <main className="route-state" role="alert">
      <p className="eyebrow">AAZIRA</p>
      <h1>Something needs attention.</h1>
      <p>{message}</p>
    </main>
  );
}

function NotFound() {
  return (
    <main className="route-state">
      <p className="eyebrow">AAZIRA</p>
      <h1>Page not found.</h1>
      <p>The requested workspace is not available.</p>
    </main>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    errorElement: <RouteError />,
    children: [
      { path: "qr/:token", element: <PublicQrOrderingPage /> },
      { path: "order-tracking", element: <PublicOrderTrackingPage /> },
      { path: "accept-admin-invitation", element: <AdminInvitationAcceptancePage /> },
      { element: <StaffAuthBoundary />, children: [
      { index: true, element: <Navigate replace to="/login" /> },
      { element: <PublicOnlyRoute />, children: [{ path: "login", element: <Login /> }] },
      { path: "design-system", element: <DesignSystemPage /> },
      { element: <ProtectedRoute allowedRoleKeys={["SUPER_ADMIN"]} allowedScopes={["COMPANY"]} />, children: [
        { path: "company", element: <Navigate replace to="/company/overview" /> },
        { path: "company/overview", element: <SuperAdminOverview /> },
        { path: "company/hotels", element: <SuperAdminHotels /> },
        { path: "company/hotels/:hotelId", element: <SuperAdminHotelDetails /> },
        { path: "company/hotel-admins", element: <SuperAdminHotelAdmins /> },
      ] },
      { element: <ProtectedRoute allowedRoles={["Admin"]} />, children: [
        { path: "admin", element: <Navigate replace to="/admin/dashboard" /> },
        { path: "admin/dashboard", element: <AdminDashboardPage /> },
        { path: "admin/areas-tables", element: <AdminAreasTablesPage /> },
        { path: "admin/menu-management", element: <AdminMenuManagementPage /> },
        { path: "admin/tax-slabs", element: <AdminTaxSlabsPage /> },
        { path: "admin/discounts", element: <AdminDiscountsPage /> },
        { path: "admin/vendors", element: <AdminVendorManagementPage /> },
        { path: "admin/users", element: <AdminUserAccountsPage /> },
        { path: "admin/reports", element: <AdminReportsPage /> },
        { path: "admin/inventory", element: <AdminInventoryPage /> },
        { path: "admin/rooms", element: <RoomManagementPage /> },
        { path: "admin/settings", element: <AdminSettingsPage /> },
        { path: "admin/*", element: <RolePlaceholder role="Admin" /> },
      ] },
      { element: <ProtectedRoute allowedRoles={["Manager"]} />, children: [
        { path: "manager", element: <Navigate replace to="/manager/dashboard" /> },
        { path: "manager/tables", element: <AdminAreasTablesPage navigationGroups={managerNavigationGroups} profile={managerProfile} /> },
        { path: "manager/rooms", element: <RoomManagementPage navigationGroups={managerNavigationGroups} profile={managerProfile} /> },
        { path: "manager/attendance", element: <ReceptionAttendancePage navigationGroups={managerNavigationGroups} profile={managerProfile} title="Hotel Management System" /> },
        { path: "manager/restaurant-orders", element: <ManagerRestaurantOrdersPage /> },
        { path: "manager/restaurant-billing", element: <ManagerRestaurantBillingPage /> },
        { path: "manager/:view", element: <ManagerDashboardPage /> },
      ] },
      { element: <ProtectedRoute allowedRoles={["Reception"]} />, children: [
        { path: "reception", element: <Navigate replace to="/reception/dashboard" /> },
        { path: "reception/dashboard", element: <ReceptionDashboardPage /> },
        { path: "reception/guest-check-in", element: <ReceptionGuestCheckInPage /> },
        { path: "reception/tables", element: <ReceptionTableStatusPage /> },
        { path: "reception/room-booking", element: <ReceptionRoomBookingPage /> },
        { path: "reception/billing", element: <ReceptionBillingPage /> },
        { path: "reception/attendance", element: <ReceptionAttendancePage /> },
        { path: "reception/*", element: <RolePlaceholder role="Reception" /> },
      ] },
      { element: <ProtectedRoute allowedRoles={["Captain"]} />, children: [
        { path: "captain", element: <Navigate replace to="/captain/dashboard" /> },
        { path: "captain/dashboard", element: <CaptainDashboardPage /> },
        { path: "captain/tables", element: <CaptainTablesPage /> },
        { path: "captain/take-order", element: <CaptainTakeOrderPage /> },
        { path: "captain/manage-order", element: <CaptainManageOrdersPage /> },
        { path: "captain/*", element: <RolePlaceholder role="Captain" /> },
      ] },
      { element: <ProtectedRoute allowedRoles={["Kitchen"]} />, children: [
        { path: "kitchen", element: <Navigate replace to="/kitchen/dashboard" /> },
        { path: "kitchen/dashboard", element: <KitchenDashboardPage /> },
        { path: "kitchen/order-queue", element: <KitchenOrderQueuePage /> },
        { path: "kitchen/*", element: <RolePlaceholder role="Kitchen" /> },
      ] },
      ...demonstrationNavigationRoutes.map((path) => ({
        path,
        element: <Navigate replace to="/design-system" />,
      })),
      ] },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
