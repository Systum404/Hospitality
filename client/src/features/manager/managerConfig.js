import { BarChart3, BedDouble, BookOpenCheck, ClipboardCheck, ClipboardList, Package, ReceiptIndianRupee, Store, TableProperties, UtensilsCrossed } from "lucide-react";

export const managerProfile = { initials: "MM", name: "Manav Mehta", title: "Manager" };

export const managerNavigationGroups = [
  { label: "Main", items: [{ icon: BarChart3, label: "Dashboard", to: "/manager/dashboard" }] },
  { label: "Operations", items: [{ icon: TableProperties, label: "Areas & Tables", to: "/manager/tables" }, { icon: BedDouble, label: "Rooms", to: "/manager/rooms" }, { icon: BookOpenCheck, label: "Menu", to: "/manager/menu" }, { icon: Store, label: "Vendors", to: "/manager/vendors" }, { icon: ReceiptIndianRupee, label: "Reports", to: "/manager/reports" }, { icon: Package, label: "Inventory", to: "/manager/inventory" }, { icon: BedDouble, label: "Room Booking", to: "/manager/room-booking" }, { icon: ClipboardList, label: "Room Orders", to: "/manager/room-orders" }, { icon: UtensilsCrossed, label: "Restaurant Orders", to: "/manager/restaurant-orders" }, { icon: ReceiptIndianRupee, label: "Room Billing", to: "/manager/room-billing" }, { icon: ReceiptIndianRupee, label: "Restaurant Billing", to: "/manager/restaurant-billing" }] },
  { label: "Staff", items: [{ icon: ClipboardCheck, label: "Attendance", to: "/manager/attendance" }] },
];
