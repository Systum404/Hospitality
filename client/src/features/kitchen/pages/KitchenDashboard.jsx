import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, ChefHat, Clock3, DoorOpen, ListOrdered, Play, Search, TableProperties, UtensilsCrossed } from "lucide-react";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Badge } from "../../../components/ui/Badge.jsx";
import { FilterButton } from "../../../components/ui/FilterButton.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent } from "../../../components/ui/Card.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { SemanticIcon } from "../../../components/ui/SemanticIcon.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { getKitchenOrders, updateKitchenOrderStatus } from "../services/kitchenService.js";
import { createKitchenOrderPoller, filterKitchenOrders } from "../services/kitchenOrderRefresh.js";
import { formatElapsedTime } from "../utils/formatElapsedTime.js";
import { kitchenNavigation, kitchenProfile } from "../kitchenConfig.js";
import { useAuth } from "../../auth/AuthContext.jsx";

const typeFilters = [{ id: "all", label: "All Orders" }, { id: "table", label: "Table Orders" }, { id: "room", label: "Room Service" }];
const statusFilters = [{ id: "all", label: "All Status" }, { id: "pending", label: "Pending" }, { id: "preparing", label: "Preparing" }, { id: "ready", label: "Ready" }];
const statusVariants = { pending: "warning", preparing: "info", ready: "success" };
const statusActions = { pending: { label: "Start Preparing", next: "preparing", icon: Play }, preparing: { label: "Mark Ready", next: "ready", icon: CheckCircle2 }, ready: { label: "Complete Order", next: "completed", icon: UtensilsCrossed } };

function KitchenOrderCard({ onAdvance, order }) {
  const action = statusActions[order.kitchenStatus];
  const LocationIcon = order.source === "room" ? DoorOpen : TableProperties;
  return <Card className={`kitchen-order-card kitchen-order-card--${order.kitchenStatus}`}><CardContent><header><div className="kitchen-order-card__location"><SemanticIcon icon={LocationIcon} semantic={order.source === "room" ? "Room order" : "Table order"} size="sm" /><div><small>{order.source === "room" ? "Room Service" : "Table Order"}</small><h3>{order.source === "room" ? `Room ${order.location}` : `Table ${order.location}`}</h3></div></div><Badge variant={statusVariants[order.kitchenStatus]}>{order.kitchenStatus}</Badge></header><div className="kitchen-order-card__guest"><strong>{order.guest}</strong><span><Clock3 aria-hidden="true" size={14} />{formatElapsedTime(order.createdAt, { includeDays: false, roundMinutes: true })}</span></div><div className="kitchen-order-card__items">{order.items.map((item) => <div key={item.id || item.name}><span>{item.name}</span><strong>×{item.quantity}</strong></div>)}</div>{order.specialRequest ? <p className="kitchen-order-card__request"><b>Special:</b> {order.specialRequest}</p> : null}<Button className="kitchen-order-card__action" icon={action.icon} onClick={() => onAdvance(order, action.next)} variant={order.kitchenStatus === "ready" ? "success" : "primary"}>{action.label}</Button></CardContent></Card>;
}

export function KitchenDashboard() {
  const { signOut, user } = useAuth();
  const [orders, setOrders] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!user?.hotelId) return undefined;
    let hasLoaded = false;
    const poller = createKitchenOrderPoller({
      load: ({ signal }) => getKitchenOrders(user.hotelId, { signal }),
      onData: (nextOrders) => { hasLoaded = true; setOrders(nextOrders); setLoadError(""); },
      onError: async (error) => {
        if (error.status === 401) { await signOut().catch(() => {}); return false; }
        if (!hasLoaded) setLoadError(error.message || "Kitchen orders could not be loaded.");
        return true;
      },
    });
    return () => poller.stop();
  }, [signOut, user?.hotelId]);
  const summary = useMemo(() => ({ total: orders?.length || 0, tables: orders?.filter((order) => order.source === "table").length || 0, rooms: orders?.filter((order) => order.source === "room").length || 0, pending: orders?.filter((order) => order.kitchenStatus === "pending").length || 0, preparing: orders?.filter((order) => order.kitchenStatus === "preparing").length || 0, ready: orders?.filter((order) => order.kitchenStatus === "ready").length || 0 }), [orders]);
  const visibleOrders = useMemo(() => filterKitchenOrders(orders, { query, status, type }), [orders, query, status, type]);
  const advanceOrder = async (order, nextStatus) => {
    try { await updateKitchenOrderStatus(user.hotelId, order.id, nextStatus); setOrders(await getKitchenOrders(user.hotelId)); setToast({ title: "Order updated", message: `${order.number || order.id} is now ${nextStatus}.` }); }
    catch (error) { if (error.status === 401) await signOut().catch(() => {}); setToast({ title: "Order not updated", message: error.message, variant: "error" }); }
  };
  const summaryBadges = [{ label: "Total", value: summary.total }, { label: "Tables", value: summary.tables }, { label: "Rooms", value: summary.rooms }, { label: "Pending", value: summary.pending, variant: "warning" }, { label: "Preparing", value: summary.preparing, variant: "info" }, { label: "Ready", value: summary.ready, variant: "success" }];
  const today = new Intl.DateTimeFormat("en-IN", { dateStyle: "full" }).format(new Date());

  return <AppShell navigationGroups={kitchenNavigation} profile={kitchenProfile} title="Kitchen Display">{loadError ? <main className="kitchen-dashboard-page"><EmptyState description={loadError} icon={ChefHat} title="Unable to load Kitchen Display" /></main> : orders ? <main className="kitchen-dashboard-page"><header className="kitchen-display-header"><div><h2>Kitchen Display</h2><Breadcrumb /><p>Coordinate incoming orders and preparation status.</p></div><div className="dashboard-heading-aside"><p className="dashboard-heading-date"><CalendarDays aria-hidden="true" size={15} />{today}</p><div className="kitchen-summary-badges">{summaryBadges.map((item) => <Badge key={item.label} variant={item.variant || "neutral"}><b>{item.value}</b> {item.label}</Badge>)}</div></div></header><section className="kitchen-order-controls"><div className="search-with-filter"><label className="kitchen-order-search"><Search aria-hidden="true" size={18} /><input aria-label="Search kitchen orders" onChange={(event) => setQuery(event.target.value)} placeholder="Search table, room, guest, or order ID..." value={query} /></label><FilterButton><div className="kitchen-filter-group" aria-label="Filter kitchen orders by type">{typeFilters.map((filter) => <button aria-pressed={type === filter.id} className={type === filter.id ? "is-active" : ""} key={filter.id} onClick={() => setType(filter.id)} type="button">{filter.label}</button>)}</div><div className="kitchen-filter-group" aria-label="Filter kitchen orders by status">{statusFilters.map((filter) => <button aria-pressed={status === filter.id} className={status === filter.id ? "is-active" : ""} key={filter.id} onClick={() => setStatus(filter.id)} type="button">{filter.label}</button>)}</div></FilterButton></div></section>{visibleOrders.length ? <section className="kitchen-order-grid" aria-live="polite">{visibleOrders.map((order) => <KitchenOrderCard key={`${order.source}-${order.id}`} onAdvance={advanceOrder} order={order} />)}</section> : <Card><CardContent><EmptyState description="No kitchen orders currently match your selected filters." icon={ListOrdered} title="No orders found" /></CardContent></Card>}{toast ? <div className="toast-region"><Toast message={toast.message} onDismiss={() => setToast(null)} title={toast.title} variant={toast.variant} /></div> : null}</main> : <LoadingState label="Loading Kitchen Display" />}</AppShell>;
}
