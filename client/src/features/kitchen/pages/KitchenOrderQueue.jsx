import { useEffect, useMemo, useState } from "react";
import { ChefHat, Clock3, DoorOpen, ListOrdered, Search, TableProperties } from "lucide-react";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Badge } from "../../../components/ui/Badge.jsx";
import { FilterButton } from "../../../components/ui/FilterButton.jsx";
import { Card, CardContent } from "../../../components/ui/Card.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { SemanticIcon } from "../../../components/ui/SemanticIcon.jsx";
import { getKitchenOrders } from "../services/kitchenService.js";
import { formatElapsedTime } from "../utils/formatElapsedTime.js";
import { kitchenNavigation, kitchenProfile } from "../kitchenConfig.js";
import { useAuth } from "../../auth/AuthContext.jsx";

const filters = [
  { id: "all", label: "All Orders" },
  { id: "pending", label: "Pending" },
  { id: "preparing", label: "Preparing" },
  { id: "ready", label: "Ready" },
];

const statusVariants = { pending: "warning", preparing: "info", ready: "success" };

function QueueOrderCard({ order }) {
  const LocationIcon = order.source === "room" ? DoorOpen : TableProperties;
  const location = order.source === "room" ? `Room ${order.location}` : `Table ${order.location}`;

  return (
    <Card className={`kitchen-queue-card kitchen-queue-card--${order.kitchenStatus}`}>
      <CardContent>
        <div className="kitchen-queue-card__identity">
          <SemanticIcon className="kitchen-queue-card__icon" icon={LocationIcon} semantic={order.source === "room" ? "Room order" : "Table order"} size="sm" />
          <div>
            <small>{order.source === "room" ? "Room Service" : "Table Order"}</small>
            <h3>{location}</h3>
          </div>
        </div>
        <p className="kitchen-queue-card__guest">{order.guest || "Guest"}</p>
        <footer>
          <Badge variant={statusVariants[order.kitchenStatus]}>{order.kitchenStatus}</Badge>
          <span><Clock3 aria-hidden="true" size={14} />{formatElapsedTime(order.createdAt)}</span>
        </footer>
      </CardContent>
    </Card>
  );
}

export function KitchenOrderQueue() {
  const { signOut, user } = useAuth();
  const [orders, setOrders] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!user?.hotelId) return;
    getKitchenOrders(user.hotelId).then(setOrders).catch(async (error) => { if (error.status === 401) await signOut().catch(() => {}); setLoadError(error.message || "Kitchen orders could not be loaded."); });
  }, [signOut, user?.hotelId]);

  const summary = useMemo(() => ({
    total: orders?.length || 0,
    pending: orders?.filter((order) => order.kitchenStatus === "pending").length || 0,
    preparing: orders?.filter((order) => order.kitchenStatus === "preparing").length || 0,
    ready: orders?.filter((order) => order.kitchenStatus === "ready").length || 0,
  }), [orders]);

  const visibleOrders = useMemo(() => (orders || []).filter((order) => {
    const searchable = `${order.id} ${order.location} ${order.table || ""} ${order.room || ""} ${order.guest || ""}`.toLowerCase();
    return (status === "all" || order.kitchenStatus === status) && searchable.includes(query.trim().toLowerCase());
  }), [orders, query, status]);

  const badges = [
    { label: "Total", value: summary.total, variant: "neutral" },
    { label: "Pending", value: summary.pending, variant: "warning" },
    { label: "Preparing", value: summary.preparing, variant: "info" },
    { label: "Ready", value: summary.ready, variant: "success" },
  ];

  return (
    <AppShell navigationGroups={kitchenNavigation} profile={kitchenProfile} title="Kitchen Display">
      {loadError ? (
        <main className="kitchen-queue-page"><EmptyState description={loadError} icon={ChefHat} title="Unable to load Order Queue" /></main>
      ) : orders ? (
        <main className="kitchen-queue-page">
          <header className="kitchen-queue-header">
            <div>
              <h2>Order Queue</h2><Breadcrumb />
              <p>Track every active order through the preparation workflow.</p>
            </div>
            <div className="kitchen-queue-summary" aria-label="Active kitchen order summary">
              {badges.map((item) => <Badge key={item.label} variant={item.variant}><b>{item.value}</b> {item.label}</Badge>)}
            </div>
          </header>

          <section className="kitchen-queue-toolbar">
            <div className="search-with-filter">
              <label className="kitchen-queue-search">
                <Search aria-hidden="true" size={18} />
                <input aria-label="Search order queue" onChange={(event) => setQuery(event.target.value)} placeholder="Search order, table, room, or guest..." type="search" value={query} />
              </label>
              <FilterButton>
                <nav aria-label="Filter order queue by status" className="kitchen-queue-filters">
                  {filters.map((filter) => (
                    <button aria-pressed={status === filter.id} className={status === filter.id ? "is-active" : ""} key={filter.id} onClick={() => setStatus(filter.id)} type="button">{filter.label}</button>
                  ))}
                </nav>
              </FilterButton>
            </div>
          </section>

          {visibleOrders.length ? (
            <section aria-live="polite" className="kitchen-queue-grid">
              {visibleOrders.map((order) => <QueueOrderCard key={`${order.source}-${order.id}`} order={order} />)}
            </section>
          ) : (
            <Card className="kitchen-queue-empty"><CardContent><EmptyState description="There are currently no orders matching this status or search." icon={ListOrdered} title="No orders in queue" /></CardContent></Card>
          )}
        </main>
      ) : <LoadingState label="Loading Order Queue" />}
    </AppShell>
  );
}
