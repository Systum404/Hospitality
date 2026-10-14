import {
  AlertTriangle, ArrowRight, BookOpenCheck, Boxes,
  CirclePercent, ContactRound, Package, ReceiptIndianRupee,
  Store, TableProperties, Tags,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";
import { SemanticIcon } from "../../../components/ui/SemanticIcon.jsx";

const quickAccess = [
  { icon: TableProperties, label: "Areas & Tables", description: "Manage dining layout", to: "/admin/areas-tables" },
  { icon: BookOpenCheck, label: "Menu Management", description: "Edit items & categories", to: "/admin/menu-management" },
  { icon: ContactRound, label: "User Accounts", description: "Staff & role management", to: "/admin/users" },
  { icon: Store, label: "Vendor Management", description: "Suppliers & contracts", to: "/admin/vendors" },
  { icon: CirclePercent, label: "Tax Slabs", description: "Configure tax rates", to: "/admin/tax-slabs" },
  { icon: Tags, label: "Discounts", description: "Promo & offers", to: "/admin/discounts" },
  { icon: ReceiptIndianRupee, label: "Reports", description: "Sales & analytics", to: "/admin/reports" },
  { icon: Package, label: "Inventory", description: "Stock management", to: "/admin/inventory" },
];

export function AdminDashboardUtilities({ alerts }) {
  return <div className="admin-dashboard-utilities">
    <Card className="admin-utility-card admin-alerts-card">
      <CardHeader><div className="admin-utility-heading"><Boxes aria-hidden="true" size={18} /><CardTitle>System Alerts</CardTitle></div></CardHeader>
      <CardContent><div className="admin-system-alerts">{alerts.length ? alerts.map(({ description, itemName, title }) => <article className="admin-system-alert admin-system-alert--red" key={itemName}><SemanticIcon className="admin-system-alert__icon" icon={AlertTriangle} semantic={title} size="sm" tone="red" /><div><strong>{title}</strong><p>{description}</p></div></article>) : <p className="notification-popover__empty">No system alerts.</p>}</div></CardContent>
    </Card>
    <Card className="admin-utility-card admin-quick-access-card">
      <CardHeader><div className="admin-utility-heading"><ArrowRight aria-hidden="true" size={18} /><CardTitle>Quick Access</CardTitle></div></CardHeader>
      <CardContent><div className="admin-quick-access">{quickAccess.map(({ description, icon, label, to }) => <Link key={label} to={to}><SemanticIcon className="admin-quick-access__icon" icon={icon} semantic={label} size="sm" /><span><strong>{label}</strong><small>{description}</small></span><ArrowRight aria-hidden="true" className="admin-quick-access__arrow" size={17} /></Link>)}</div></CardContent>
    </Card>
  </div>;
}
