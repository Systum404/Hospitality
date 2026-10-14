import { Building2, LayoutDashboard, ShieldCheck } from "lucide-react";

export const superAdminProfile = { initials: "SA", name: "Super Admin", title: "Company Super Admin" };

export const superAdminNavigationGroups = [
  { label: "Company", items: [
    { icon: LayoutDashboard, label: "Overview", tone: "blue", to: "/company/overview" },
    { icon: Building2, label: "Hotels", tone: "purple", to: "/company/hotels" },
    { icon: ShieldCheck, label: "Hotel Admins", tone: "green", to: "/company/hotel-admins" },
  ] },
];
