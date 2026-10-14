import { BedDouble, CalendarDays, ClipboardList, LayoutDashboard, ReceiptIndianRupee, UsersRound, UtensilsCrossed } from "lucide-react";
import { NavLink } from "react-router-dom";
import { SemanticIcon } from "../ui/SemanticIcon.jsx";

const navigationGroups = [
  { label: "Main", items: [{ icon: LayoutDashboard, label: "Dashboard", to: "/design-system" }] },
  { label: "Operations", items: [{ icon: UsersRound, label: "Guests", to: "/guests" }, { icon: BedDouble, label: "Rooms", to: "/rooms" }, { icon: UtensilsCrossed, label: "Tables", to: "/tables" }] },
  { label: "Management", items: [{ icon: CalendarDays, label: "Bookings", to: "/bookings" }, { icon: ClipboardList, label: "Orders", to: "/orders" }] },
  { label: "Finance", items: [{ icon: ReceiptIndianRupee, label: "Billing", to: "/billing" }] },
];

export function Sidebar({ collapsed = false, isOpen, navigationGroups: groups = navigationGroups, onClose }) {
  return (
    <aside className={`sidebar ${isOpen ? "sidebar--open" : ""} ${collapsed ? "sidebar--collapsed" : ""}`.trim()}>
      <div className="sidebar__brand">
        <span className="brand-mark" aria-hidden="true">A</span>
        <span className="sidebar__brand-copy"><strong>AAZIRA</strong><small>Hotel Management System</small></span>
      </div>
      <nav className="sidebar__nav" aria-label="Demonstration navigation">
        {groups.map((group) => (
          <div className="nav-group" key={group.label}>
            <p>{group.label}</p>
            {group.items.map(({ icon: Icon, label, tone, to }) => (
              <NavLink aria-label={collapsed ? label : undefined} className={({ isActive }) => `nav-link ${isActive ? "nav-link--active" : ""}`} data-tooltip={label} key={label} onClick={onClose} title={collapsed ? label : undefined} to={to}>
                <SemanticIcon icon={Icon} semantic={label} size="nav" tone={tone} /><span className="nav-link__label">{label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
