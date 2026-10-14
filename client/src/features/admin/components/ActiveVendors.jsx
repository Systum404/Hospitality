import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../../components/ui/Button.jsx";
import { PaginatedTableBody } from "../../../components/ui/TablePagination.jsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";

export function ActiveVendors({ vendors }) {
  const navigate = useNavigate();
  return <Card className="admin-data-card admin-balanced-table-card"><CardHeader><div className="admin-card-heading"><div><CardTitle>Active vendors</CardTitle><CardDescription>Supplier partnerships and current activity.</CardDescription></div><Button className="view-all-link" onClick={() => navigate("/admin/vendors")} size="sm" variant="ghost">View all <ArrowRight size={15} /></Button></div></CardHeader><CardContent><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Vendor ID</th><th>Name</th><th>Category</th><th>Contact</th><th>Items</th><th>Amount</th></tr></thead><PaginatedTableBody colSpan={6} items={vendors}>{(vendor) => <tr key={vendor.name}><td><strong>{vendor.reference || "—"}</strong></td><td><strong>{vendor.name}</strong></td><td>{vendor.category || "—"}</td><td>{vendor.contact}</td><td>{vendor.inventoryItemCount}</td><td><strong>{vendor.amount || "—"}</strong></td></tr>}</PaginatedTableBody></table>{!vendors.length ? <p className="notification-popover__empty">No active vendors.</p> : null}</div></CardContent></Card>;
}
