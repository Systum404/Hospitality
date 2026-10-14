import { ChevronRight, House } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

const breadcrumbsByPath = {
  "/admin/dashboard": { parent: "Dashboard", current: "Admin Dashboard" },
  "/admin/areas-tables": { parent: "Setup", current: "Areas & Tables" },
  "/admin/menu-management": { parent: "Setup", current: "Menu Management" },
  "/admin/tax-slabs": { parent: "Setup", current: "Tax Slabs" },
  "/admin/discounts": { parent: "Setup", current: "Discounts" },
  "/admin/vendors": { parent: "Setup", current: "Vendor Management" },
  "/admin/users": { parent: "People", current: "User Accounts" },
  "/admin/reports": { parent: "Insights", current: "Reports" },
  "/admin/inventory": { parent: "Insights", current: "Inventory" },
  "/admin/settings": { parent: "System", current: "Settings" },
  "/manager/dashboard": { parent: "Dashboard", current: "Manager Dashboard" },
  "/manager/tables": { parent: "Operations", current: "Areas & Tables" },
  "/manager/room-booking": { parent: "Dashboard", current: "Room Booking" },
  "/manager/room-orders": { parent: "Dashboard", current: "Room Orders" },
  "/manager/room-billing": { parent: "Dashboard", current: "Room Billing" },
  "/manager/menu": { parent: "Operations", current: "Menu Management" },
  "/manager/vendors": { parent: "Operations", current: "Vendor Management" },
  "/manager/reports": { parent: "Operations", current: "Reports & Analytics" },
  "/manager/inventory": { parent: "Operations", current: "Inventory Management" },
  "/reception/dashboard": { parent: "Dashboard", current: "Reception Dashboard" },
  "/reception/guest-check-in": { parent: "Operations", current: "Guest Check-In" },
  "/reception/tables": { parent: "Operations", current: "Table Status" },
  "/reception/room-booking": { parent: "Operations", current: "Room Booking" },
  "/reception/billing": { parent: "Billing", current: "Billing" },
  "/reception/attendance": { parent: "Staff", current: "Attendance" },
  "/captain/dashboard": { parent: "Dashboard", current: "Captain Dashboard" },
  "/captain/tables": { parent: "Operations", current: "Tables" },
  "/captain/take-order": { parent: "Operations", current: "Take Order" },
  "/captain/manage-order": { parent: "Operations", current: "Manage Order" },
  "/kitchen/dashboard": { parent: "Dashboard", current: "Kitchen Display" },
  "/kitchen/order-queue": { parent: "Kitchen", current: "Order Queue" },
};

const dashboardByRole = {
  admin: "/admin/dashboard",
  manager: "/manager/dashboard",
  reception: "/reception/dashboard",
  captain: "/captain/dashboard",
  kitchen: "/kitchen/dashboard",
};

export function Breadcrumb() {
  const { pathname } = useLocation();
  const normalizedPath = pathname.replace(/\/$/, "") || "/";
  const entry = breadcrumbsByPath[normalizedPath];
  const role = normalizedPath.split("/")[1];
  const homePath = dashboardByRole[role];

  if (!entry || !homePath) return null;

  return (
    <nav aria-label="Breadcrumb" className="breadcrumb">
      <Link aria-label="Home" className="breadcrumb__home" to={homePath}><House aria-hidden="true" size={14} /></Link>
      <ChevronRight aria-hidden="true" size={13} />
      {entry.parent === "Dashboard" && normalizedPath !== homePath ? <Link to={homePath}>{entry.parent}</Link> : <span>{entry.parent}</span>}
      <ChevronRight aria-hidden="true" size={13} />
      <span aria-current="page" className="breadcrumb__current">{entry.current}</span>
    </nav>
  );
}
