import { ClipboardList, LayoutDashboard, TableProperties, UtensilsCrossed } from "lucide-react";

export const captainProfile = { initials: "CP", name: "Captain", title: "Captain" };

export const captainNavigation = [
  { label: "Main", items: [{ icon: LayoutDashboard, label: "Dashboard", to: "/captain/dashboard" }] },
  {
    label: "Operations",
    items: [
      { icon: TableProperties, label: "Tables", to: "/captain/tables" },
      { icon: UtensilsCrossed, label: "Take Order", to: "/captain/take-order" },
      { icon: ClipboardList, label: "Manage Order", to: "/captain/manage-order" },
    ],
  },
];
