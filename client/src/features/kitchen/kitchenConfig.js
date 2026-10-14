import { LayoutDashboard, ListOrdered } from "lucide-react";

export const kitchenProfile = { initials: "KS", name: "Kitchen Staff", title: "Kitchen" };

export const kitchenNavigation = [
  { label: "Main", items: [{ icon: LayoutDashboard, label: "Dashboard", to: "/kitchen/dashboard" }] },
  { label: "Kitchen", items: [{ icon: ListOrdered, label: "Order Queue", to: "/kitchen/order-queue" }] },
];
