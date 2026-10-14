import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Search, ShoppingBag, Trash2, UsersRound } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Badge } from "../../../components/ui/Badge.jsx";
import { FilterButton } from "../../../components/ui/FilterButton.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { Input } from "../../../components/ui/Input.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { Select } from "../../../components/ui/Select.jsx";
import { Textarea } from "../../../components/ui/Textarea.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { createCaptainOrder, getCaptainDashboard, updateCaptainOrder } from "../services/captainService.js";
import { captainNavigation, captainProfile } from "../captainConfig.js";

const money = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

export function CaptainMenuItemCard({ item, onAdd }) {
  return <Card className="captain-menu-item"><CardContent><Badge variant="info">{item.category}</Badge><h4>{item.name}</h4><footer><strong>{money(item.price)}</strong><Button icon={Plus} onClick={() => onAdd(item)} size="sm" variant="success">Add</Button></footer></CardContent></Card>;
}

function OrderSummary({ cart, canPlace, isExistingOrder, onChangeQuantity, onPlace, onRemove, table }) {
  const subtotal = cart.reduce((total, item) => total + item.price * item.quantity, 0);
  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);
  return <Card className="captain-order-summary"><CardHeader><div className="captain-section-header"><span aria-hidden="true" className="captain-section-header__icon"><ShoppingBag size={20} /></span><div><CardTitle>Order Summary</CardTitle><p>{table ? `Table ${table.id}` : "Select a service table"}</p></div></div></CardHeader><CardContent>{cart.length ? <div className="captain-cart-lines">{cart.map((item) => <article className="captain-cart-line" key={item.id}><div><strong>{item.name}</strong><small>{money(item.price)} × {item.quantity}</small></div><b>{money(item.price * item.quantity)}</b><div className="captain-quantity"><button aria-label={`Decrease ${item.name}`} onClick={() => onChangeQuantity(item.id, -1)} type="button"><Minus size={14} /></button><span>{item.quantity}</span><button aria-label={`Increase ${item.name}`} onClick={() => onChangeQuantity(item.id, 1)} type="button"><Plus size={14} /></button></div><button aria-label={`Remove ${item.name}`} className="captain-cart-remove" onClick={() => onRemove(item.id)} type="button"><Trash2 size={16} /></button></article>)}</div> : <EmptyState description="Choose items from the menu to build this order." icon={ShoppingBag} title="Your order is empty" />}<div className="captain-order-total"><span>Subtotal</span><strong>{money(subtotal)}</strong><span>Total</span><strong>{money(subtotal)}</strong></div><Button className="captain-place-order" disabled={!canPlace || !cart.length} onClick={onPlace} size="lg" variant="success">{isExistingOrder ? "Update Order" : `Place Order · ${itemCount} ${itemCount === 1 ? "item" : "items"}`}</Button></CardContent></Card>;
}

export function CaptainTakeOrder() {
  const { signOut, user } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedTable = searchParams.get("table") || "";
  const [workspace, setWorkspace] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [form, setForm] = useState({ table_id: requestedTable, customer_name: "", customer_phone: "", notes: "" });
  const [cart, setCart] = useState([]);
  const [activeOrder, setActiveOrder] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => { setForm((current) => ({ ...current, table_id: requestedTable || current.table_id })); }, [requestedTable]);
  useEffect(() => { if (!user?.hotelId) return; getCaptainDashboard(user.hotelId).then(setWorkspace).catch(async (error) => { if (error.status === 401) await signOut().catch(() => {}); setLoadError(error.message || "Order data could not be loaded."); }); }, [signOut, user?.hotelId]);
  const tables = useMemo(() => workspace?.tables || [], [workspace]);
  const selectedTable = tables.find((table) => table.databaseId === form.table_id);
  const selectedActiveOrder = useMemo(() => workspace?.orders.find((order) => order.tableId === form.table_id && order.status !== "completed"), [form.table_id, workspace]);
  useEffect(() => {
    if (!selectedTable || selectedTable.status !== "occupied") { setActiveOrder(null); return; }
    if (!selectedActiveOrder) { setActiveOrder(null); setCart([]); setToast({ title: "Unable to open order", message: "Unable to open this table's active order.", variant: "error" }); return; }
    setActiveOrder(selectedActiveOrder);
    setForm((current) => ({ ...current, customer_name: selectedActiveOrder.customer || "", customer_phone: selectedActiveOrder.phone || "", notes: selectedActiveOrder.notes || "" }));
    setCart(selectedActiveOrder.items.map((item) => ({ ...item })));
  }, [selectedActiveOrder, selectedTable]);
  const categories = useMemo(() => ["All", ...new Set((workspace?.menuItems || []).map((item) => item.category))], [workspace]);
  const filteredMenu = useMemo(() => (workspace?.menuItems || []).filter((item) => item.status === "available" && (category === "All" || item.category === category) && `${item.name} ${item.category}`.toLowerCase().includes(search.trim().toLowerCase())), [category, search, workspace]);
  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const addItem = (item) => setCart((current) => current.some((entry) => entry.id === item.id) ? current.map((entry) => entry.id === item.id ? { ...entry, quantity: entry.quantity + 1 } : entry) : [...current, { ...item, quantity: 1 }]);
  const changeQuantity = (id, delta) => setCart((current) => current.map((item) => item.id === id ? { ...item, quantity: item.quantity + delta } : item).filter((item) => item.quantity > 0));
  const selectTable = (tableId) => { setActiveOrder(null); setCart([]); setForm((current) => ({ ...current, table_id: tableId, customer_name: "", customer_phone: "", notes: "" })); };
  const placeOrder = async () => { if (!user?.hotelId || !selectedTable || !form.customer_name.trim() || !form.customer_phone.trim() || !cart.length || (selectedTable.status === "occupied" && !activeOrder)) return; setSubmitting(true); try { const payload = { items: cart.map((item) => ({ menu_item_id: item.id, quantity: item.quantity })), notes: form.notes.trim() }; const order = activeOrder ? await updateCaptainOrder(user.hotelId, activeOrder.id, payload) : await createCaptainOrder(user.hotelId, { ...form, customer_name: form.customer_name.trim(), customer_phone: form.customer_phone.trim(), ...payload }); setWorkspace(await getCaptainDashboard(user.hotelId)); setToast(activeOrder ? { title: "Order updated", message: `${order.number} changes were saved.` } : { title: "Order placed", message: `${order.number} was sent to the kitchen.` }); } catch (error) { if (error.status === 401) await signOut().catch(() => {}); setToast({ title: activeOrder ? "Order not updated" : "Order not placed", message: error.message, variant: "error" }); } finally { setSubmitting(false); } };

  return <AppShell navigationGroups={captainNavigation} profile={captainProfile} title="Captain Dashboard">{loadError ? <main className="captain-take-order-page"><EmptyState description={loadError} icon={ShoppingBag} title="Unable to load Take Order" /></main> : workspace ? <main className="captain-take-order-page"><header className="captain-take-order-header"><div><p className="eyebrow">Captain operations</p><h2>Take Order</h2><Breadcrumb /><p>{activeOrder ? `Continuing the order for table ${selectedTable?.id}.` : selectedTable ? `Preparing an order for table ${selectedTable.id}.` : "Create a restaurant service order."}</p></div><div className="captain-order-indicators"><span><b>{itemCount}</b> Items</span><span><b>{money(total)}</b> Total</span></div></header><Card className="captain-customer-card"><CardHeader><div className="captain-section-header"><span aria-hidden="true" className="captain-section-header__icon"><UsersRound size={20} /></span><div><CardTitle>Customer Information</CardTitle><p>Enter the guest and table for this order.</p></div></div></CardHeader><CardContent><div className="captain-customer-form"><Input disabled={Boolean(activeOrder)} label="Customer Name *" onChange={(event) => setForm((current) => ({ ...current, customer_name: event.target.value }))} placeholder="Enter customer name" value={form.customer_name} /><Input disabled={Boolean(activeOrder)} label="Phone Number *" onChange={(event) => setForm((current) => ({ ...current, customer_phone: event.target.value }))} placeholder="Enter phone number" value={form.customer_phone} /><Select label="Service Table *" onChange={(event) => selectTable(event.target.value)} value={form.table_id}><option value="">Select table</option>{tables.map((table) => <option key={table.databaseId} value={table.databaseId}>{table.id} · {table.area}</option>)}</Select><Textarea className="captain-customer-form__request" label="Special Requests" onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Any special requests or dietary requirements..." rows="3" value={form.notes} /></div></CardContent></Card><section className="captain-menu-order-layout"><div className="captain-menu-browser"><div className="captain-menu-toolbar"><div className="search-with-filter"><label className="captain-menu-search"><Search aria-hidden="true" size={18} /><input onChange={(event) => setSearch(event.target.value)} placeholder="Search menu items..." value={search} /></label><FilterButton><nav aria-label="Filter menu by category" className="captain-menu-filters">{categories.map((item) => <button aria-pressed={category === item} className={category === item ? "is-active" : ""} key={item} onClick={() => setCategory(item)} type="button">{item}</button>)}</nav></FilterButton></div></div>{filteredMenu.length ? <div className="captain-menu-grid">{filteredMenu.map((item) => <CaptainMenuItemCard item={item} key={item.id} onAdd={addItem} />)}</div> : <Card><CardContent><EmptyState description="Try another search or category." icon={Search} title="No menu items found" /></CardContent></Card>}</div><OrderSummary canPlace={Boolean(selectedTable && (!selectedTable.status || selectedTable.status !== "occupied" || activeOrder) && form.customer_name.trim() && form.customer_phone.trim() && !submitting)} cart={cart} isExistingOrder={Boolean(activeOrder)} onChangeQuantity={changeQuantity} onPlace={placeOrder} onRemove={(id) => setCart((current) => current.filter((item) => item.id !== id))} table={selectedTable} /></section>{toast ? <div className="toast-region"><Toast message={toast.message} onDismiss={() => setToast(null)} title={toast.title} variant={toast.variant} /></div> : null}</main> : <LoadingState label="Loading Take Order" />}</AppShell>;
}
