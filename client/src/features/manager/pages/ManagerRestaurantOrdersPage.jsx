import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Badge } from "../../../components/ui/Badge.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";
import { CopyableIdentifier } from "../../../components/ui/CopyableIdentifier.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { Select } from "../../../components/ui/Select.jsx";
import { PaginatedTableBody } from "../../../components/ui/TablePagination.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { createRestaurantBill, getBills } from "../../billing/services/billingService.js";
import { managerNavigationGroups, managerProfile } from "../managerConfig.js";
import { filterRestaurantOrders, isRestaurantOrderBillable, restaurantOrderStatuses } from "../services/managerRestaurantOrdersFilter.js";
import { getManagerRestaurantOrders } from "../services/managerRestaurantOrdersService.js";

const statusVariants = { pending: "warning", preparing: "warning", ready: "success", completed: "success" };
const sourceLabels = { captain: "Captain", dining_table_qr: "Table QR" };
const money = value => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

function itemSummary(items) {
  return items.map(item => `${item.item_name} ×${item.quantity}`).join(", ");
}

export function ManagerRestaurantOrdersPage() {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState(null);
  const [bills, setBills] = useState([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [busyOrderId, setBusyOrderId] = useState("");
  const [toast, setToast] = useState(null);
  const submitting = useRef(false);

  useEffect(() => {
    if (!user?.hotelId) return;
    const controller = new AbortController();
    setOrders(null);
    setError("");
    Promise.all([getManagerRestaurantOrders(user.hotelId, { signal: controller.signal }), getBills(user.hotelId, { signal: controller.signal })])
      .then(([restaurantOrders, allBills]) => { setOrders(restaurantOrders); setBills(allBills.filter(bill => bill.type === "CAPTAIN")); })
      .catch(async failure => {
        if (failure.name === "AbortError") return;
        if (failure.status === 401) await signOut().catch(() => {});
        else setError(failure.message || "Restaurant orders could not be loaded.");
      });
    return () => controller.abort();
  }, [signOut, user?.hotelId]);

  const rows = useMemo(() => filterRestaurantOrders(orders || [], filter), [filter, orders]);
  const billsByOrder = useMemo(() => new Map(bills.map(bill => [bill.order_id, bill])), [bills]);
  const openBill = bill => navigate("/manager/restaurant-billing", { state: { billId: bill.id } });
  const createBill = async order => {
    if (!user?.hotelId || submitting.current || billsByOrder.has(order.id) || !isRestaurantOrderBillable(order)) return;
    submitting.current = true; setBusyOrderId(order.id);
    try {
      const bill = await createRestaurantBill(user.hotelId, order.id);
      navigate("/manager/restaurant-billing", { state: { billId: bill.id } });
    } catch (failure) {
      if (failure.status === 401) await signOut().catch(() => {});
      else setToast({ title: "Unable to generate bill", message: failure.message || "Restaurant bill could not be generated.", variant: "error" });
      try { setBills((await getBills(user.hotelId)).filter(bill => bill.type === "CAPTAIN")); } catch { /* Preserve the original error. */ }
    } finally { submitting.current = false; setBusyOrderId(""); }
  };

  return <AppShell navigationGroups={managerNavigationGroups} profile={managerProfile} title="Hotel Management System">
    <main className="manager-workspace">
      <section className="manager-heading"><div><h2>Restaurant Orders</h2><Breadcrumb /></div></section>
      <div className="manager-toolbar manager-toolbar--filters"><Select aria-label="Filter orders" onChange={event => setFilter(event.target.value)} value={filter}><option value="all">All orders</option>{restaurantOrderStatuses.map(status => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}</Select></div>
      <Card className="manager-restaurant-orders-card">
        <CardHeader><div><CardTitle>Restaurant Orders</CardTitle><CardDescription>Captain and Table QR orders for this hotel.</CardDescription></div></CardHeader>
        <CardContent>
          {error ? <EmptyState description={error} icon={ClipboardList} title="Unable to load restaurant orders" />
            : orders === null ? <LoadingState label="Loading restaurant orders" />
              : rows.length ? <div className="manager-table-wrap"><table className="manager-table manager-restaurant-orders-table"><thead><tr><th>Order</th><th>Table</th><th>Area</th><th>Source</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Created</th><th>Billing</th></tr></thead><PaginatedTableBody colSpan={10} items={rows}>{order => { const bill = billsByOrder.get(order.id); return <tr key={order.id}><td><strong><CopyableIdentifier label="order ID" value={order.order_number} /></strong></td><td>{order.dining_table?.table_number || "—"}</td><td>{order.dining_table?.dining_area?.name || "—"}</td><td><Badge variant="info">{sourceLabels[order.source] || order.source}</Badge></td><td><strong>{order.customer_name}</strong><small>{order.customer_phone}{order.customer_email ? ` · ${order.customer_email}` : ""}</small></td><td className="manager-restaurant-order-items" title={itemSummary(order.items)}>{itemSummary(order.items)}</td><td><strong>{money(order.total_amount)}</strong></td><td><Badge variant={statusVariants[order.status] || "neutral"}>{order.status}</Badge></td><td>{new Date(order.created_at).toLocaleString()}</td><td>{bill ? <Button onClick={() => openBill(bill)} size="sm" variant="outline">View Bill</Button> : isRestaurantOrderBillable(order) ? <Button disabled={Boolean(busyOrderId)} onClick={() => createBill(order)} size="sm">{busyOrderId === order.id ? "Generating…" : "Create Bill"}</Button> : "—"}</td></tr>; }}</PaginatedTableBody></table></div>
                : <EmptyState description={orders.length ? "Choose another order status." : "Captain and Table QR orders will appear here."} icon={ClipboardList} title={orders.length ? "No restaurant orders match this status" : "No restaurant orders yet"} />}
        </CardContent>
      </Card>
    </main>
    {toast ? <div className="toast-region"><Toast message={toast.message} onDismiss={() => setToast(null)} title={toast.title} variant={toast.variant} /></div> : null}
  </AppShell>;
}
