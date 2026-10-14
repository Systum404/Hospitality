import { useEffect, useMemo, useState } from "react";
import { Armchair, CheckCircle2, TableProperties, UsersRound } from "lucide-react";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { TableCard } from "../../../components/tables/TableCard.jsx";
import { Badge } from "../../../components/ui/Badge.jsx";
import { Card, CardContent } from "../../../components/ui/Card.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { SemanticIcon } from "../../../components/ui/SemanticIcon.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { receptionNavigationGroups, receptionProfile } from "../receptionConfig.js";
import { getReceptionTableStatus } from "../services/receptionService.js";

const statusVariants = { occupied: "danger", available: "success" };

function StatusSummary({ icon: Icon, label, value }) {
  return <Card className="table-status-stat"><CardContent><SemanticIcon icon={Icon} semantic={label} size="lg" /><div><strong>{value}</strong><small>{label}</small></div></CardContent></Card>;
}

function ReceptionTableCard({ table }) {
  const occupied = table.effectiveStatus === "occupied";
  const view = { id: table.tableNumber, area: table.area.name, capacity: table.capacity, status: table.effectiveStatus };
  const activity = table.activeOrder ? <time dateTime={table.activeOrder.createdAt}>Opened {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(table.activeOrder.createdAt))}</time> : <span>No active order</span>;
  return <TableCard
    actions={<span className="reception-table-card__activity">{activity}</span>}
    className="reception-table-card"
    guestClassName="reception-table-card__guest"
    guestDescription={occupied ? `${table.activeOrder.status} · Captain order` : "No active Captain order"}
    guestTitle={occupied ? "Active restaurant service" : "Ready for guests"}
    headingLabel="Table Number"
    statusVariant={statusVariants[table.effectiveStatus]}
    styledSeparator
    table={view}
  />;
}

export function TableStatus() {
  const { signOut, user } = useAuth();
  const [tables, setTables] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [area, setArea] = useState("All areas");

  useEffect(() => {
    if (!user?.hotelId) return;
    const controller = new AbortController();
    getReceptionTableStatus(user.hotelId, { signal: controller.signal })
      .then(data => { setTables(data); setLoadError(""); })
      .catch(async error => {
        if (error.name === "AbortError") return;
        if (error.status === 401) await signOut().catch(() => {});
        else { setTables([]); setLoadError(error.message || "Table status could not be loaded."); }
      });
    return () => controller.abort();
  }, [signOut, user?.hotelId]);

  const counts = useMemo(() => ({
    total: tables?.length || 0,
    occupied: tables?.filter(table => table.effectiveStatus === "occupied").length || 0,
    available: tables?.filter(table => table.effectiveStatus === "available").length || 0,
  }), [tables]);
  const areas = useMemo(() => tables ? [...new Set(tables.map(table => table.area.name))].sort() : [], [tables]);
  const visibleTables = useMemo(() => (tables || []).filter(table => area === "All areas" || table.area.name === area), [area, tables]);

  return <AppShell navigationGroups={receptionNavigationGroups} profile={receptionProfile} title="Reception Dashboard">
    {loadError ? <main className="table-status-page"><EmptyState description={loadError} icon={TableProperties} title="Unable to load tables" /></main> : tables ? <main className="table-status-page">
      <header className="table-status-header"><div><p className="eyebrow">Reception operations</p><h2>Table Status</h2><Breadcrumb /><p>Monitor live dining-table availability.</p></div><div className="table-status-header__badges"><Badge variant="danger">{counts.occupied} Occupied</Badge><Badge variant="success">{counts.available} Available</Badge></div></header>
      <section aria-label="Table status summary" className="table-status-stats table-status-stats--operational"><StatusSummary icon={TableProperties} label="Total Tables" value={counts.total} /><StatusSummary icon={UsersRound} label="Currently Occupied" value={counts.occupied} /><StatusSummary icon={CheckCircle2} label="Available Now" value={counts.available} /></section>
      {tables.length ? <><nav aria-label="Filter tables by dining area" className="table-area-filters">{["All areas", ...areas].map(filterArea => <button aria-pressed={area === filterArea} className={area === filterArea ? "is-active" : ""} key={filterArea} onClick={() => setArea(filterArea)} type="button">{filterArea}</button>)}</nav>{visibleTables.length ? <section aria-live="polite" className="reception-table-grid">{visibleTables.map(table => <ReceptionTableCard key={table.id} table={table} />)}</section> : <Card className="table-status-empty"><CardContent><EmptyState description="Choose another dining area to view its tables." icon={Armchair} title="No tables found in this area" /></CardContent></Card>}</> : <Card className="table-status-empty"><CardContent><EmptyState description="Configured dining tables will appear here." icon={Armchair} title="No dining tables configured" /></CardContent></Card>}
    </main> : <LoadingState label="Loading table availability" />}
  </AppShell>;
}
