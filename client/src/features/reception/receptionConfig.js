import {
  BedDouble,
  ClipboardCheck,
  LayoutDashboard,
  ReceiptIndianRupee,
  TableProperties,
  UserRoundPlus,
} from "lucide-react";

export const receptionProfile = { initials: "RS", name: "Reception", title: "Receptionist" };

export const receptionNavigationGroups = [
  { label: "Main", items: [{ icon: LayoutDashboard, label: "Dashboard", to: "/reception/dashboard" }] },
  {
    label: "Operations",
    items: [
      { icon: UserRoundPlus, label: "Guest Check-In", to: "/reception/guest-check-in" },
      { icon: TableProperties, label: "Table Status", to: "/reception/tables" },
      { icon: BedDouble, label: "Room Booking", to: "/reception/room-booking" },
    ],
  },
  { label: "Billing", items: [{ icon: ReceiptIndianRupee, label: "Billing", to: "/reception/billing" }] },
  { label: "Staff", items: [{ icon: ClipboardCheck, label: "Attendance", to: "/reception/attendance" }] },
];
