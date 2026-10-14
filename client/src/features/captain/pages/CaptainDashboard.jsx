import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ClipboardList, IndianRupee, LayoutDashboard, Search, TableProperties, UtensilsCrossed } from "lucide-react";
import { Link } from "react-router-dom";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Badge } from "../../../components/ui/Badge.jsx";
import { FilterButton } from "../../../components/ui/FilterButton.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";
import { CopyableIdentifier } from "../../../components/ui/CopyableIdentifier.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { Select } from "../../../components/ui/Select.jsx";
import { SemanticIcon } from "../../../components/ui/SemanticIcon.jsx";
import { getCaptainDashboard } from "../services/captainService.js";
import { captainNavigation, captainProfile } from "../captainConfig.js";
import { useAuth } from "../../auth/AuthContext.jsx";

const tableBadgeVariants = { occupied: "danger", available: "success", reserved: "warning" };
const orderBadgeVariants = { pending: "warning", preparing: "warning", ready: "success", completed: "success" };
const money = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

function CaptainMetric({ icon: Icon, label, value }) {
  return <Card className="captain-stat"><CardContent><SemanticIcon icon={Icon} semantic={label} size="lg" /><div><strong>{value}</strong><small>{label}</small></div></CardContent></Card>;
}

function CaptainTableCard({ table }) {
  return <article className={`captain-table-card captain-table-card--${table.status}`}><header><h4>{table.id}</h4><Badge variant={tableBadgeVariants[table.status]}>{table.status}</Badge></header><p>{table.area} · {table.capacity} pax</p><div>{table.customer ? <><strong>{table.customer}</strong><small>{table.amount !== undefined ? money(table.amount) : "Order in progress"}</small></> : <><strong>Ready for guests</strong><small>Available now</small></>}</div></article>;
}

function RecentOrder({ order }) {
  const itemSummary = order.items.map((item) => item.name).filter(Boolean).join(", ");
  return <article className="captain-order"><header><div className="captain-order__identity"><strong className="captain-order__reference"><CopyableIdentifier label="order ID" value={order.number} /></strong><span>{order.table}</span></div><div className="captain-order__badges"><Badge variant={order.source === "dining_table_qr" ? "info" : "neutral"}>{order.source === "dining_table_qr" ? "Table QR" : "Captain"}</Badge><Badge variant={orderBadgeVariants[order.status] || "neutral"}>{order.status}</Badge></div></header><div className="captain-order__details"><div><span className="captain-order__guest" title={order.customer || ""}>{order.customer || "Guest"}</span><small title={itemSummary}>{itemSummary || `${order.itemCount} items`}</small></div><b>{money(order.amount)}</b></div><footer><span>{order.itemCount} {order.itemCount === 1 ? "item" : "items"}</span><time dateTime={order.createdAt}>{order.time}</time></footer></article>;
}

export function CaptainDashboard() {
  const { signOut, user } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [area, setArea] = useState("All areas");

  useEffect(() => { if (!user?.hotelId) return; getCaptainDashboard(user.hotelId).then(setDashboard).catch(async (error) => { if (error.status === 401) await signOut().catch(() => {}); setLoadError(error.message || "Captain dashboard data could not be loaded."); }); }, [signOut, user?.hotelId]);
  const summary = useMemo(() => {
    const tables = dashboard?.tables || [];
    const orders = dashboard?.recentOrders || [];
    return {
      total: tables.length,
      occupied: tables.filter((table) => table.status === "occupied").length,
      available: tables.filter((table) => table.status === "available").length,
      reserved: tables.filter((table) => table.status === "reserved").length,
      activeOrders: orders.filter((order) => order.status !== "completed").length,
      revenue: orders.reduce((total, order) => total + order.amount, 0),
    };
  }, [dashboard]);
  const areas = useMemo(() => dashboard ? [...new Set(dashboard.tables.map((table) => table.area))].sort() : [], [dashboard]);
  const filteredTables = useMemo(() => (dashboard?.tables || []).filter((table) => {
    const matchesQuery = `${table.id} ${table.customer}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (status === "all" || table.status === status) && (area === "All areas" || table.area === area);
  }), [area, dashboard, query, status]);
  const recentOrders = useMemo(() => (dashboard?.recentOrders || []).slice(0, 5), [dashboard]);
  const today = new Intl.DateTimeFormat("en-IN", { dateStyle: "full" }).format(new Date());

  return <AppShell navigationGroups={captainNavigation} profile={captainProfile} title="Captain Dashboard">
    {loadError ? <main className="captain-dashboard"><EmptyState description={loadError} icon={TableProperties} title="Unable to load Captain dashboard" /></main> : dashboard ? <main className="captain-dashboard">
      <header className="captain-dashboard-header"><div><h2>Captain Dashboard</h2><Breadcrumb /><p>Monitor tables and active restaurant orders.</p></div><div className="dashboard-heading-aside"><p className="dashboard-heading-date"><CalendarDays aria-hidden="true" size={15} />{today}</p><div className="captain-dashboard-header__badges"><Badge variant="warning">{summary.activeOrders} Active Orders</Badge><Badge variant="danger">{summary.occupied} Tables Occupied</Badge></div></div></header>
      <section aria-label="Captain dashboard summary" className="captain-stats"><CaptainMetric icon={TableProperties} label="Total Tables" value={summary.total} /><CaptainMetric icon={UtensilsCrossed} label="Occupied" value={summary.occupied} /><CaptainMetric icon={LayoutDashboard} label="Available" value={summary.available} /><CaptainMetric icon={IndianRupee} label="Today's Revenue" value={money(summary.revenue)} /></section>
      <div className="captain-filter-row"><div className="search-with-filter"><label className="captain-search"><Search aria-hidden="true" size={18} /><input aria-label="Search tables or customers" onChange={(event) => setQuery(event.target.value)} placeholder="Search tables or customers..." value={query} /></label><FilterButton><Select aria-label="Filter tables by status" onChange={(event) => setStatus(event.target.value)} value={status}><option value="all">All Status</option><option value="occupied">Occupied</option><option value="available">Available</option><option value="reserved">Reserved</option></Select><nav aria-label="Filter Captain tables by area" className="captain-area-filters">{["All areas", ...areas].map((filterArea) => <button aria-pressed={area === filterArea} className={area === filterArea ? "is-active" : ""} key={filterArea} onClick={() => setArea(filterArea)} type="button">{filterArea}</button>)}</nav></FilterButton></div></div>
      <section className="captain-workspace"><Card className="captain-tables-panel"><CardHeader><div className="captain-panel-heading"><div><CardTitle>Tables</CardTitle><p>{filteredTables.length} of {summary.total} tables shown</p></div><Badge variant="info">{area}</Badge></div></CardHeader><CardContent>{filteredTables.length ? <div className="captain-table-grid">{filteredTables.map((table) => <CaptainTableCard key={table.databaseId} table={table} />)}</div> : <EmptyState description="Adjust the search, status, or area filters." icon={TableProperties} title="No matching tables" />}</CardContent></Card><Card className="captain-orders-panel"><CardHeader><CardTitle>Recent Orders</CardTitle><p>Latest restaurant activity</p></CardHeader><CardContent>{recentOrders.length ? <div className="captain-order-list">{recentOrders.map((order) => <RecentOrder key={order.id} order={order} />)}</div> : <div className="captain-orders-empty"><EmptyState description="New Captain orders will appear here." icon={ClipboardList} title="No recent orders" /></div>}{dashboard.recentOrders.length > recentOrders.length ? <footer className="captain-orders-panel__footer"><Link to="/captain/manage-order">View all</Link></footer> : null}</CardContent></Card></section>
    </main> : <LoadingState label="Preparing the Captain workspace" />}
  </AppShell>;
}
