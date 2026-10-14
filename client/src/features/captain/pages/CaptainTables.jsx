import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, LayoutDashboard, Pencil, Play, TableProperties, UsersRound, UtensilsCrossed } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { TableCard } from "../../../components/tables/TableCard.jsx";
import { Badge } from "../../../components/ui/Badge.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent } from "../../../components/ui/Card.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { Input } from "../../../components/ui/Input.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { Modal } from "../../../components/ui/Modal.jsx";
import { Select } from "../../../components/ui/Select.jsx";
import { SemanticIcon } from "../../../components/ui/SemanticIcon.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { getCaptainDashboard, updateCaptainTable } from "../services/captainService.js";
import { captainNavigation, captainProfile } from "../captainConfig.js";
import { useAuth } from "../../auth/AuthContext.jsx";

const statusVariants = { occupied: "danger", available: "success", reserved: "warning" };
const money = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

function TableMetric({ icon: Icon, label, value }) {
  return <Card className="captain-table-stat"><CardContent><SemanticIcon icon={Icon} semantic={label} size="lg" /><div><strong>{value}</strong><small>{label}</small></div></CardContent></Card>;
}

function CaptainTableViewCard({ onEdit, onOrder, table }) {
  const action = table.status === "occupied" ? { label: "Manage Order", icon: ClipboardList } : table.status === "reserved" ? { label: "Start Order", icon: Play } : { label: "Take Order", icon: UtensilsCrossed };
  const guestTitle = table.customer || "Available now";
  const guestDescription = table.customer ? (table.status === "occupied" ? `${money(table.amount)} · ${table.duration} min · ${table.orders} orders` : "Reservation confirmed") : "Ready for a new order";
  const actions = <><Button icon={Pencil} onClick={() => onEdit(table)} size="sm" variant="outline">Edit</Button><Button icon={action.icon} onClick={() => onOrder(table)} size="sm" variant={table.status === "available" ? "success" : "primary"}>{action.label}</Button></>;
  return <TableCard actions={actions} className="captain-table-view-card" guestClassName="captain-table-view-card__guest" guestDescription={guestDescription} guestTitle={guestTitle} statusVariant={statusVariants[table.status]} table={table} />;
}

function TableEditor({ draft, onChange }) {
  const update = (field, value) => onChange({ ...draft, [field]: value });
  return <div className="captain-table-editor"><div className="captain-table-editor__row"><Input disabled label="Table ID" value={draft.id} /><Input disabled label="Area" value={draft.area} /></div><div className="captain-table-editor__row"><Input disabled label="Capacity" value={draft.capacity} /><Select label="Status" onChange={(event) => update("status", event.target.value)} value={draft.status}><option value="occupied">Occupied</option><option value="available">Available</option><option value="reserved">Reserved</option></Select></div></div>;
}

export function CaptainTables() {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [area, setArea] = useState("All areas");
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => { if (!user?.hotelId) return; getCaptainDashboard(user.hotelId).then(setWorkspace).catch(async (error) => { if (error.status === 401) await signOut().catch(() => {}); setLoadError(error.message || "Table data could not be loaded."); }); }, [signOut, user?.hotelId]);
  const counts = useMemo(() => ({ total: workspace?.tables.length || 0, occupied: workspace?.tables.filter((table) => table.status === "occupied").length || 0, available: workspace?.tables.filter((table) => table.status === "available").length || 0, reserved: workspace?.tables.filter((table) => table.status === "reserved").length || 0 }), [workspace]);
  const areas = useMemo(() => workspace ? [...new Set(workspace.tables.map((table) => table.area))].sort() : [], [workspace]);
  const visibleTables = useMemo(() => (workspace?.tables || []).filter((table) => area === "All areas" || table.area === area), [area, workspace]);

  const saveTable = async () => {
    if (!user?.hotelId || !editing?.databaseId) return;
    try { await updateCaptainTable(user.hotelId, editing.databaseId, editing.status); setWorkspace(await getCaptainDashboard(user.hotelId)); setEditing(null); setToast({ title: "Table updated", message: `${editing.id} status was saved.` }); }
    catch (error) { if (error.status === 401) await signOut().catch(() => {}); setToast({ title: "Table not updated", message: error.message, variant: "error" }); }
  };
  const openOrderFlow = (table) => {
    const order = workspace.orders.find((item) => item.tableId === table.databaseId && item.status !== "completed");
    const params = new URLSearchParams({ table: table.databaseId });
    if (order) params.set("order", order.id);
    navigate(`${table.status === "occupied" ? "/captain/manage-order" : "/captain/take-order"}?${params}`);
  };

  return <AppShell navigationGroups={captainNavigation} profile={captainProfile} title="Captain Dashboard">
    {loadError ? <main className="captain-tables-page"><EmptyState description={loadError} icon={TableProperties} title="Unable to load tables" /></main> : workspace ? <main className="captain-tables-page">
      <header className="captain-tables-header"><div><p className="eyebrow">Captain operations</p><h2>Table View</h2><Breadcrumb /><p>Select a table to begin or manage restaurant service.</p></div><div className="captain-tables-header__badges"><Badge variant="danger">{counts.occupied} Occupied</Badge><Badge variant="success">{counts.available} Available</Badge><Badge variant="warning">{counts.reserved} Reserved</Badge></div></header>
      <section aria-label="Captain table summary" className="captain-table-stats"><TableMetric icon={TableProperties} label="Total Tables" value={counts.total} /><TableMetric icon={UsersRound} label="Currently Occupied" value={counts.occupied} /><TableMetric icon={CheckCircle2} label="Available Now" value={counts.available} /><TableMetric icon={LayoutDashboard} label="Reserved" value={counts.reserved} /></section>
      <nav aria-label="Filter Captain Table View by area" className="captain-table-area-filters">{["All areas", ...areas].map((filterArea) => <button aria-pressed={area === filterArea} className={area === filterArea ? "is-active" : ""} key={filterArea} onClick={() => setArea(filterArea)} type="button">{filterArea}</button>)}</nav>
      {visibleTables.length ? <section className="captain-table-view-grid">{visibleTables.map((table) => <CaptainTableViewCard key={table.databaseId} onEdit={(item) => setEditing({ ...item })} onOrder={openOrderFlow} table={table} />)}</section> : <Card><CardContent><EmptyState description="Choose another dining area to view its tables." icon={TableProperties} title="No tables found in this area" /></CardContent></Card>}
      <Modal actions={<><Button onClick={() => setEditing(null)} variant="ghost">Cancel</Button><Button onClick={saveTable}>Save Changes</Button></>} description={editing ? `${editing.id} · Update table service status.` : ""} isOpen={Boolean(editing)} onClose={() => setEditing(null)} title="Edit Table">{editing ? <TableEditor draft={editing} onChange={setEditing} /> : null}</Modal>
      {toast ? <div className="toast-region"><Toast message={toast.message} onDismiss={() => setToast(null)} title={toast.title} /></div> : null}
    </main> : <LoadingState label="Loading Captain tables" />}
  </AppShell>;
}
