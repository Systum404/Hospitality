import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../../../components/ui/Badge.jsx";
import { CopyableIdentifier } from "../../../components/ui/CopyableIdentifier.jsx";
import { PaginatedTableBody } from "../../../components/ui/TablePagination.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";

const variants = { completed: "success", preparing: "warning", ready: "info", pending: "neutral" };

export function RecentOrders({ orders, timezone }) {
  const navigate = useNavigate();
  const dateTime = value => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value));
  const currency = value => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value));
  return <Card className="admin-data-card admin-balanced-table-card"><CardHeader><div className="admin-card-heading"><div><CardTitle>Recent orders</CardTitle><CardDescription>Restaurant and room-service activity.</CardDescription></div><Button className="view-all-link" onClick={() => navigate("/admin/reports")} size="sm" variant="ghost">View all <ArrowRight size={15} /></Button></div></CardHeader><CardContent><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Order ID</th><th>Table</th><th>Area</th><th>Items</th><th>Amount</th><th>Status</th><th>Time</th></tr></thead><PaginatedTableBody colSpan={7} items={orders}>{(order) => <tr key={order.orderNumber}><td><strong><CopyableIdentifier label="order ID" value={order.orderNumber} /></strong></td><td>{order.tableNumber}</td><td>{order.areaName}</td><td>{order.itemCount}</td><td><strong>{currency(order.totalAmount)}</strong></td><td><Badge variant={variants[order.status] || "neutral"}>{order.status}</Badge></td><td>{dateTime(order.createdAt)}</td></tr>}</PaginatedTableBody></table>{!orders.length ? <p className="notification-popover__empty">No recent orders.</p> : null}</div></CardContent></Card>;
}
