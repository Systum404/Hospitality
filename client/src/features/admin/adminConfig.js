import { BarChart3, BedDouble, BookOpenCheck, CirclePercent, ContactRound, Package, ReceiptIndianRupee, Settings, Store, TableProperties, Tags } from "lucide-react";

export const adminProfile = { initials: "AU", name: "Admin User", title: "Administrator" };

export const adminNavigationGroups = [
  { label: "Main", items: [{ icon: BarChart3, label: "Dashboard", to: "/admin/dashboard" }] },
  { label: "Setup", items: [{ icon: TableProperties, label: "Areas & Tables", to: "/admin/areas-tables" }, { icon: BedDouble, label: "Rooms", to: "/admin/rooms" }, { icon: BookOpenCheck, label: "Menu Management", to: "/admin/menu-management" }, { icon: CirclePercent, label: "Tax Slabs", to: "/admin/tax-slabs" }, { icon: Tags, label: "Discounts", to: "/admin/discounts" }, { icon: Store, label: "Vendor Management", to: "/admin/vendors" }] },
  { label: "People", items: [{ icon: ContactRound, label: "User Accounts", to: "/admin/users" }] },
  { label: "Insights", items: [{ icon: ReceiptIndianRupee, label: "Reports", to: "/admin/reports" }, { icon: Package, label: "Inventory", to: "/admin/inventory" }] },
  { label: "System", items: [{ icon: Settings, label: "Settings", to: "/admin/settings" }] },
];
