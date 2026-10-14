import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle, Ban, BarChart3, BookOpenCheck, CalendarDays, CheckCircle2, ChevronDown, ClipboardCopy, ClipboardList,
  Download, FileSpreadsheet, Image, IndianRupee, Mail, Package, Pencil, Phone, Plus, Printer,
  ReceiptIndianRupee, Save, Search, SlidersHorizontal, Store, TableProperties, Trash2, UsersRound, UtensilsCrossed, XCircle,
} from "lucide-react";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Badge } from "../../../components/ui/Badge.jsx";
import { FilterButton } from "../../../components/ui/FilterButton.jsx";
import { PaginatedTableBody } from "../../../components/ui/TablePagination.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";
import { CopyableIdentifier } from "../../../components/ui/CopyableIdentifier.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { InventoryItemIcon } from "../../../components/ui/InventoryItemIcon.jsx";
import { Input } from "../../../components/ui/Input.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { MetricCard } from "../../../components/ui/MetricCard.jsx";
import { Modal } from "../../../components/ui/Modal.jsx";
import { SearchInput } from "../../../components/ui/SearchInput.jsx";
import { SemanticIcon } from "../../../components/ui/SemanticIcon.jsx";
import { Select } from "../../../components/ui/Select.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { Textarea } from "../../../components/ui/Textarea.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { getBills, getBill, createRoomBill, finalizeBill, getBillingAdjustments, recalculateBill, recordBillPayment, billingMoney } from "../../billing/services/billingService.js";
import { BillingAdjustmentFields, BillingAdjustmentSummary, emptyBillingSelection, selectionFromBill } from "../../billing/components/BillingAdjustments.jsx";
import { billingLineAmount } from "../../billing/utils/billingLinePresentation.js";
import {
  createMenuItem, deleteMenuItem, getMenuCategories, getMenuItems, updateMenuItem,
} from "../../admin/services/menuManagementService.js";
import { createVendor, deleteVendor, getVendors, updateVendor, updateVendorStatus } from "../../admin/services/vendorsService.js";
import { createInventoryItem, deleteInventoryItem, getInventoryItems, updateInventoryItem } from "../../admin/services/inventoryService.js";
import { createRoomBooking, deleteRoomBooking, getRoomAvailability, getRoomBookingWorkspace, updateRoomBooking, updateRoomBookingStatus } from "../../reception/services/roomBookingsService.js";
import { createRoomOrder, deleteRoomOrder, getRoomOrders, updateRoomOrder, updateRoomOrderStatus } from "../services/roomOrdersService.js";
import { issueRoomOrderingCapability } from "../services/qrCapabilityService.js";
import { managerNavigationGroups as navigationGroups, managerProfile as profile } from "../managerConfig.js";
import { getManagerDashboard, getManagerReports } from "../services/managerService.js";
const metricIcons = { collections: IndianRupee, totalOrders: ClipboardList, activeOrders: ReceiptIndianRupee, occupancy: TableProperties, staffPresent: UsersRound, lowStock: AlertTriangle };
const statusVariant = { available: "success", occupied: "warning", billed: "info", reserved: "warning", maintenance: "info", confirmed: "info", "checked-in": "success", "checked-out": "neutral", cancelled: "danger", active: "success", critical: "danger", low: "warning", preparing: "warning", ready: "success", delivered: "info", overdue: "danger", "due-soon": "warning", upcoming: "info" };
const money = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
const managerInventoryCategories = ["Meat", "Dairy", "Grains", "Vegetables", "Beverages", "Pantry"];

function WorkspaceHeader({ view, timezone }) {
  const activeLabel = {
    dashboard: "Overview",
    tables: "All Tables",
    "room-booking": "Room Booking",
    "room-orders": "Room Orders",
    "room-billing": "Room Billing",
    menu: "Menu Management",
    vendors: "Vendor Management",
  }[view];
  const today = new Intl.DateTimeFormat("en-IN", { dateStyle: "full", ...(timezone ? { timeZone: timezone } : {}) }).format(new Date());
  return <>
    <section className="manager-heading">
      <div><h2>{view === "dashboard" ? "Manager Dashboard" : activeLabel || "Manager Dashboard"}</h2><Breadcrumb /></div>
      <p className="dashboard-heading-date"><CalendarDays aria-hidden="true" size={15} />{today}</p>
    </section>
  </>;
}

function SectionCard({ children, description, title, action, className = "" }) {
  return <Card className={`manager-section-card ${className}`}><CardHeader><div className="manager-card-heading"><div><CardTitle>{title}</CardTitle>{description ? <CardDescription>{description}</CardDescription> : null}</div>{action}</div></CardHeader><CardContent>{children}</CardContent></Card>;
}

function Overview({ overview }) {
  const navigate = useNavigate();
  const sourceLabels = { room_qr: "Room Service", captain: "Captain", dining_table_qr: "Table QR" };
  const formatDateTime = value => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: overview.meta.timezone }).format(new Date(value));
  const metrics = [
    { id: "collections", label: "Today's Collections", value: billingMoney(overview.metrics.todayCollections), detail: "Recorded payments today" },
    { id: "totalOrders", label: "Total Orders", value: overview.metrics.totalOrders, detail: "Room service and restaurant" },
    { id: "activeOrders", label: "Active Orders", value: overview.metrics.activeOrders, detail: "Pending, preparing, or ready" },
    { id: "occupancy", label: "Tables Occupied", value: `${overview.metrics.occupiedTables} / ${overview.metrics.totalTables}`, detail: "Active restaurant orders" },
    { id: "staffPresent", label: "Staff Present", value: `${overview.metrics.presentStaff} / ${overview.metrics.totalStaff}`, detail: "Marked present today" },
    { id: "lowStock", label: "Low Stock Items", value: overview.metrics.lowStockCount, detail: "Require attention" },
  ];
  const quickActions = [
    { icon: BookOpenCheck, title: "Menu Management", subtitle: "Add, edit or remove items", to: "/manager/menu" },
    { icon: Package, title: "Inventory", subtitle: "Stock management", to: "/manager/inventory" },
    { icon: Store, title: "Vendors", subtitle: "Manage suppliers", to: "/manager/vendors" },
    { icon: BarChart3, title: "Reports", subtitle: "View analytics", to: "/manager/reports" },
  ];
  return <div className="manager-overview">
    <section className="manager-metrics">{metrics.map((metric) => <MetricCard description={metric.detail} icon={metricIcons[metric.id]} key={metric.id} label={metric.label} value={metric.value} />)}</section>
    <section aria-label="Quick actions" className="manager-action-grid">{quickActions.map(({ icon, title, subtitle, to }) => <button key={title} onClick={() => navigate(to)} type="button"><SemanticIcon className="manager-action-grid__icon" icon={icon} semantic={title} /><span className="manager-action-grid__copy"><strong>{title}</strong><small>{subtitle}</small></span></button>)}</section>
    <SectionCard className="manager-overview-table-card" description="Inventory items requiring immediate attention" title="Low Stock Alerts" action={<Button onClick={() => navigate("/manager/inventory")} size="sm" variant="ghost">View All</Button>}>{overview.lowStockAlerts.length ? <CompactTable columns={["Item Name", "Current Stock", "Required", "Status"]} rows={overview.lowStockAlerts.map((item) => [<strong key={`${item.name}-name`}>{item.name}</strong>, `${item.quantity} ${item.unit || ""}`.trim(), `${item.minimumQuantity} ${item.unit || ""}`.trim(), <Badge key={`${item.name}-status`} variant={statusVariant[item.status]}>{item.status}</Badge>])} /> : <EmptyState description="Inventory levels are above their configured minimums." icon={Package} title="No low stock items" />}</SectionCard>
    <section className="manager-overview-pair">
      <SectionCard className="manager-overview-table-card" description="Latest room-service and restaurant activity" title="Recent Orders">{overview.recentOrders.length ? <CompactTable columns={["Order", "Source", "Location", "Items", "Amount", "Status", "Created"]} rows={overview.recentOrders.map((order) => [<strong key={`${order.orderNumber}-number`}><CopyableIdentifier label="order ID" value={order.orderNumber} /></strong>, sourceLabels[order.source] || order.source, order.location || "—", order.itemCount, billingMoney(order.totalAmount), <Badge key={`${order.orderNumber}-status`} variant={statusVariant[order.status] || "neutral"}>{order.status}</Badge>, formatDateTime(order.createdAt)])} /> : <EmptyState description="New room-service and restaurant orders will appear here." icon={ClipboardList} title="No recent orders" />}</SectionCard>
      <SectionCard className="manager-overview-table-card" description="Completed-order item quantities" title="Top Selling Items">{overview.topSellingItems.length ? <CompactTable columns={["Rank", "Item Name", "Quantity", "Item Total"]} rows={overview.topSellingItems.map((item) => [`#${item.rank}`, <strong key={`${item.rank}-name`}>{item.itemName}</strong>, item.quantity, billingMoney(item.itemTotal)])} /> : <EmptyState description="Completed order items will appear here." icon={UtensilsCrossed} title="No completed-item sales" />}</SectionCard>
    </section>
    <SectionCard className="manager-overview-table-card manager-pending-payments" description="Finalized room and restaurant bill balances" title="Pending Payments">{overview.pendingPayments.length ? <CompactTable columns={["Invoice", "Type", "Guest", "Reference", "Outstanding", "Status"]} rows={overview.pendingPayments.map((payment) => [<strong key={`${payment.invoiceNumber}-invoice`}>{payment.invoiceNumber}</strong>, payment.type === "CAPTAIN" ? "Restaurant" : "Room", payment.guestName || "Guest", payment.sourceReference, billingMoney(payment.balanceDue), <Badge key={`${payment.invoiceNumber}-status`} variant={statusVariant[payment.status] || "warning"}>{payment.status.replaceAll("_", " ")}</Badge>])} /> : <EmptyState description="There are no finalized bills with an outstanding balance." icon={ReceiptIndianRupee} title="No pending payments" />}</SectionCard>
  </div>;
}

function CompactTable({ columns, rows }) {
  return <div className="manager-table-wrap"><table className="manager-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><PaginatedTableBody colSpan={columns.length} items={rows}>{(row, index, absoluteIndex) => <tr key={absoluteIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>}</PaginatedTableBody></table></div>;
}

const blankBooking = { customer_name: "", customer_phone: "", room_id: "", booking_from: "", booking_to: "", adults: 1, status: "confirmed", total_amount: "0.00" };

function BookingView({ notify }) {
  const { user, signOut } = useAuth();
  const [bookings, setBookings] = useState([]); const [rooms, setRooms] = useState([]); const [availableRooms, setAvailableRooms] = useState([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [capabilityTarget, setCapabilityTarget] = useState(null);
  const [issuedCapability, setIssuedCapability] = useState(null);
  const load=useCallback(async()=>{if(!user?.hotelId){setLoading(false);return;}setLoading(true);try{const data=await getRoomBookingWorkspace(user.hotelId);setBookings(data.room_bookings);setRooms(data.rooms);}catch(error){if(error?.status===401)await signOut().catch(()=>{});else notify(error.message||"Unable to load room bookings.","Unable to load bookings","error");}finally{setLoading(false);}},[notify,signOut,user?.hotelId]); useEffect(()=>{load();},[load]);
  useEffect(()=>{if(!editing||!user?.hotelId||!editing.booking_from||!editing.booking_to||new Date(editing.booking_to)<=new Date(editing.booking_from)){setAvailableRooms(rooms.filter((room)=>room.status==="active"));return;}const controller=new AbortController();getRoomAvailability(user.hotelId,{from:editing.booking_from,to:editing.booking_to,bookingId:editing.id,capacity:Number(editing.adults)||1},{signal:controller.signal}).then(setAvailableRooms).catch(async(error)=>{if(error?.name==="AbortError")return;if(error?.status===401)await signOut().catch(()=>{});else notify(error.message||"Unable to load available rooms.","Unable to complete request","error");});return()=>controller.abort();},[editing?.id,editing?.booking_from,editing?.booking_to,editing?.adults,notify,rooms,signOut,user?.hotelId]);
  const filtered = bookings.filter((booking) => (status === "all" || booking.status === status) && `${booking.booking_number} ${booking.customer_name} ${booking.customer_phone} ${booking.room.room_number}`.toLowerCase().includes(query.toLowerCase()));
  const saveBooking = async () => { if(!editing||!user?.hotelId||busy||!editing.customer_name.trim()||!editing.customer_phone.trim()||(!editing.id&&(!editing.room_id||!editing.booking_from||!editing.booking_to||new Date(editing.booking_to)<=new Date(editing.booking_from))))return; const payload=editing.status==="checked-in"?{customer_name:editing.customer_name.trim(),customer_phone:editing.customer_phone.trim()}:{room_id:editing.room_id,customer_name:editing.customer_name.trim(),customer_phone:editing.customer_phone.trim(),adults:editing.adults,children:0,booking_from:editing.booking_from,booking_to:editing.booking_to,...(editing.id?{}:{status:editing.status})}; setBusy(true);try{if(editing.id)await updateRoomBooking(user.hotelId,editing.id,payload);else await createRoomBooking(user.hotelId,payload);setEditing(null);await load();notify(editing.id?"Booking details updated.":"New room booking added.");}catch(error){if(error?.status===401)await signOut().catch(()=>{});else notify(error.message||"Unable to save room booking.","Unable to complete request","error");}finally{setBusy(false);} };
  const setField = (key, value) => setEditing((current) => ({ ...current, [key]: value }));
  const issueCapability = async () => {
    if (!capabilityTarget || !user?.hotelId || busy) return;
    setBusy(true);
    try { setIssuedCapability(await issueRoomOrderingCapability(user.hotelId, capabilityTarget.id)); }
    catch (error) {
      if (error?.status === 401) await signOut().catch(() => {});
      else notify(error.message || "Unable to issue room ordering access.", "Unable to complete request", "error");
    } finally { setBusy(false); }
  };
  const closeCapability = () => { if (!busy) { setCapabilityTarget(null); setIssuedCapability(null); } };
  return <>
    <div className="manager-toolbar"><div className="search-with-filter"><label className="manager-search"><Search size={17} /><input aria-label="Search bookings" onChange={(event) => setQuery(event.target.value)} placeholder="Search guest, booking, phone, or room..." value={query} /></label><FilterButton><Select aria-label="Filter booking status" onChange={(event) => setStatus(event.target.value)} value={status}><option value="all">All statuses</option><option value="confirmed">Confirmed</option><option value="checked-in">Checked in</option><option value="checked-out">Checked out</option><option value="cancelled">Cancelled</option></Select></FilterButton></div><div className="manager-toolbar__actions"><Button disabled={!bookings.some((booking) => booking.status === "checked-in")} icon={ClipboardCopy} onClick={() => setCapabilityTarget(bookings.find((booking) => booking.status === "checked-in"))} variant="outline">Room ordering access</Button><Button icon={Plus} onClick={() => setEditing({ ...blankBooking })}>Add Booking</Button></div></div>
    <SectionCard description={`${filtered.length} bookings shown`} title="Room Bookings">{loading?<LoadingState label="Loading room bookings"/>:<div className="manager-table-wrap"><table className="manager-table manager-booking-table"><thead><tr><th>Booking</th><th>Guest</th><th>Room</th><th>Stay</th><th>Guests</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><PaginatedTableBody colSpan={8} items={filtered}>{(booking) => <tr key={booking.id}><td><strong><CopyableIdentifier label="booking ID" value={booking.booking_number} /></strong></td><td><strong>{booking.customer_name}</strong><small>{booking.customer_phone}</small></td><td><strong>{booking.room.room_number}</strong><small>{booking.room.room_type||"—"}</small></td><td>{booking.booking_from.slice(0,10)}<small>to {booking.booking_to.slice(0,10)}</small></td><td>{booking.adults+booking.children}</td><td>{money(booking.total_amount)}</td><td><Badge variant={statusVariant[booking.status]}>{booking.status}</Badge></td><td><div className="manager-row-actions">{booking.status==="reserved"?<button aria-label={`Confirm ${booking.customer_name}`} disabled={busy} onClick={async()=>{setBusy(true);try{await updateRoomBookingStatus(user.hotelId,booking.id,"confirmed");await load();notify("Booking confirmed.");}catch(error){notify(error.message||"Unable to confirm booking.","Unable to complete request","error");}finally{setBusy(false);}}} title="Confirm" type="button"><CheckCircle2 size={17} /></button>:null}{booking.status === "confirmed"?<button aria-label={`Check in ${booking.customer_name}`} disabled={busy} onClick={async()=>{setBusy(true);try{await updateRoomBookingStatus(user.hotelId,booking.id,"checked-in");await load();notify("Guest checked in successfully.");}catch(error){notify(error.message||"Unable to check in guest.","Unable to complete request","error");}finally{setBusy(false);}}} title="Check in" type="button"><CheckCircle2 size={17} /></button>:null}{booking.status==="checked-in"?<button aria-label={`Check out ${booking.customer_name}`} disabled={busy} onClick={async()=>{setBusy(true);try{await updateRoomBookingStatus(user.hotelId,booking.id,"checked-out");await load();notify("Guest checked out successfully.");}catch(error){notify(error.message||"Unable to check out guest.","Unable to complete request","error");}finally{setBusy(false);}}} title="Check out" type="button"><CheckCircle2 size={17} /></button>:null}{booking.status==="reserved"||booking.status==="confirmed"?<button aria-label={`Cancel ${booking.customer_name}`} disabled={busy} onClick={async()=>{setBusy(true);try{await updateRoomBookingStatus(user.hotelId,booking.id,"cancelled");await load();notify("Booking cancelled.");}catch(error){notify(error.message||"Unable to cancel booking.","Unable to complete request","error");}finally{setBusy(false);}}} title="Cancel" type="button"><XCircle size={17} /></button>:null}{!["checked-out","cancelled"].includes(booking.status)?<button aria-label={`Edit ${booking.customer_name}`} disabled={busy} onClick={() => setEditing({id:booking.id,customer_name:booking.customer_name,customer_phone:booking.customer_phone,room_id:booking.room_id,booking_from:booking.booking_from.slice(0,10),booking_to:booking.booking_to.slice(0,10),adults:booking.adults,status:booking.status})} title="Edit" type="button"><Pencil size={17} /></button>:null}{["reserved","confirmed"].includes(booking.status)?<button aria-label={`Delete ${booking.customer_name}`} disabled={busy} onClick={() => setDeleting(booking)} title="Delete" type="button"><Trash2 size={17} /></button>:null}</div></td></tr>}</PaginatedTableBody></table>{filtered.length === 0 ? <EmptyState description="Try another search term or status filter." title="No bookings found" /> : null}</div>}</SectionCard>
    <Modal actions={<><Button disabled={busy} onClick={() => setEditing(null)} variant="ghost">Cancel</Button><Button disabled={busy} onClick={saveBooking}>Save Booking</Button></>} description="Enter the guest, room, and stay details." isOpen={Boolean(editing)} onClose={() => !busy&&setEditing(null)} title={editing?.id ? "Edit Booking" : "Add Booking"}>{editing ? <div className="form-grid room-order-form"><Input label="Guest name" onChange={(event) => setField("customer_name", event.target.value)} value={editing.customer_name}/><Input label="Phone" onChange={(event) => setField("customer_phone", event.target.value)} value={editing.customer_phone}/><Select disabled={editing.status==="checked-in"} label="Room" onChange={(event) => setField("room_id",event.target.value)} value={editing.room_id}><option value="">Select room</option>{availableRooms.map(room=><option key={room.id} value={room.id}>{room.room_number}{room.room_type?` · ${room.room_type}`:""}</option>)}</Select><Input disabled={editing.status==="checked-in"} label="Check in" onChange={(event) => setField("booking_from", event.target.value)} type="date" value={editing.booking_from}/><Input disabled={editing.status==="checked-in"} label="Check out" onChange={(event) => setField("booking_to", event.target.value)} type="date" value={editing.booking_to}/><Input disabled={editing.status==="checked-in"} label="Guests" min="1" onChange={(event) => setField("adults", Number(event.target.value))} type="number" value={editing.adults}/>{!editing.id?<Select label="Status" onChange={(event) => setField("status", event.target.value)} value={editing.status}><option value="reserved">Reserved</option><option value="confirmed">Confirmed</option></Select>:null}</div> : null}</Modal>
    <Modal actions={<><Button disabled={busy} onClick={() => setDeleting(null)} variant="ghost">Cancel</Button><Button disabled={busy} onClick={async()=>{if(!deleting||!user?.hotelId)return;setBusy(true);try{await deleteRoomBooking(user.hotelId,deleting.id);setDeleting(null);await load();notify("Booking deleted.","Booking deleted");}catch(error){notify(error.message||"Unable to delete booking.","Unable to complete request","error");}finally{setBusy(false);}}} variant="danger">Delete</Button></>} description={deleting ? `Delete ${deleting.booking_number} for ${deleting.customer_name}? This action cannot be undone.` : ""} isOpen={Boolean(deleting)} onClose={() => !busy&&setDeleting(null)} title="Delete booking"><p className="modal-copy">Are you sure you want to delete this booking?</p></Modal>
    <Modal actions={issuedCapability ? <><Button disabled={busy} onClick={closeCapability} variant="ghost">Close</Button><Button disabled={busy} onClick={issueCapability} variant="outline">{busy ? "Reissuing…" : "Reissue access"}</Button></> : <><Button disabled={busy} onClick={closeCapability} variant="ghost">Cancel</Button><Button disabled={busy || !capabilityTarget} onClick={issueCapability}>{busy ? "Issuing…" : "Issue access"}</Button></>} description="Issue room ordering access for a checked-in booking." isOpen={Boolean(capabilityTarget)} onClose={closeCapability} title="Room ordering access">
      {capabilityTarget ? <div className="room-capability-handoff"><Select disabled={busy || Boolean(issuedCapability)} label="Checked-in booking" onChange={(event) => { setCapabilityTarget(bookings.find((booking) => booking.id === event.target.value)); setIssuedCapability(null); }} value={capabilityTarget.id}>{bookings.filter((booking) => booking.status === "checked-in").map((booking) => <option key={booking.id} value={booking.id}>{booking.room.room_number} · {booking.customer_name}</option>)}</Select>{issuedCapability ? <><div className="room-capability-handoff__warning"><AlertTriangle aria-hidden="true" size={18} /><p>This sensitive access code is shown only now. Reissuing it invalidates the previous code.</p></div><label>Room access code<input aria-label="Issued room access code" autoComplete="off" readOnly type="text" value={issuedCapability.capability} /></label><Button icon={ClipboardCopy} onClick={async () => { try { await navigator.clipboard.writeText(issuedCapability.capability); notify("Room access code copied.", "Copied"); } catch { notify("Copy was unavailable. Select the code and copy it manually.", "Unable to copy", "error"); } }} variant="outline">Copy access code</Button></> : <p className="modal-copy">The code will be displayed once for an in-person handoff. It is not saved in this browser.</p>}</div> : null}
    </Modal>
  </>;
}

function RoomOrdersView({ notify }) {
  const { user, signOut } = useAuth();
  const [orders, setOrders] = useState([]); const [bookings, setBookings] = useState([]); const [menuItems, setMenuItems] = useState([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [filter, setFilter] = useState("all"); const [editor, setEditor] = useState(null); const [deleting, setDeleting] = useState(null); const [draft, setDraft] = useState({ room_booking_id: "", items: [], status: "pending", notes: "" });
  const load = useCallback(async () => { if (!user?.hotelId) { setLoading(false); return; } setLoading(true); try { const [liveOrders, workspace, items] = await Promise.all([getRoomOrders(user.hotelId), getRoomBookingWorkspace(user.hotelId), getMenuItems(user.hotelId)]); setOrders(liveOrders); setBookings(workspace.room_bookings.filter((booking) => booking.status === "checked-in")); setMenuItems(items); } catch (error) { if (error?.status === 401) await signOut().catch(() => {}); else notify(error.message || "Unable to load room orders.", "Unable to load orders", "error"); } finally { setLoading(false); } }, [notify, signOut, user?.hotelId]);
  useEffect(() => { load(); }, [load]);
  const visible = orders.filter((order) => filter === "all" || order.status === filter);
  const openAdd = () => { setDraft({ room_booking_id: "", items: [], status: "pending", notes: "" }); setEditor({ mode: "add" }); };
  const openEdit = (order) => { setDraft({ room_booking_id: order.room_booking_id, items: order.items.map((item) => ({ menu_item_id: item.menu_item_id, quantity: item.quantity })), status: order.status, notes: order.notes || "" }); setEditor({ mode: "edit", id: order.id }); };
  const save = async () => { const validItems = draft.items.length > 0 && draft.items.every((item) => item.menu_item_id && Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0); if (!editor || !user?.hotelId || busy || !draft.room_booking_id || !validItems || new Set(draft.items.map((item) => item.menu_item_id)).size !== draft.items.length) return; const input = { room_booking_id: draft.room_booking_id, items: draft.items.map((item) => ({ menu_item_id: item.menu_item_id, quantity: Number(item.quantity), special_instructions: null })), status: draft.status, payment_status: "pending", notes: draft.notes.trim() || null }; setBusy(true); try { if (editor.mode === "add") await createRoomOrder(user.hotelId, input); else await updateRoomOrder(user.hotelId, editor.id, input); setEditor(null); await load(); notify(editor.mode === "add" ? "Room order created." : "Room order updated."); } catch (error) { if (error?.status === 401) await signOut().catch(() => {}); else notify(error.message || "Unable to save room order.", "Unable to complete request", "error"); } finally { setBusy(false); } };
  const changeStatus = async (order, status) => { if (!user?.hotelId || busy || status === order.status) return; setBusy(true); try { await updateRoomOrderStatus(user.hotelId, order.id, status); await load(); notify("Room order status updated."); } catch (error) { if (error?.status === 401) await signOut().catch(() => {}); else notify(error.message || "Unable to update room order.", "Unable to complete request", "error"); } finally { setBusy(false); } };
  const remove = async () => { if (!deleting || !user?.hotelId || busy) return; setBusy(true); try { await deleteRoomOrder(user.hotelId, deleting.id); setDeleting(null); await load(); notify("Room order deleted.", "Room order deleted"); } catch (error) { if (error?.status === 401) await signOut().catch(() => {}); else notify(error.message || "Unable to delete room order.", "Unable to complete request", "error"); } finally { setBusy(false); } };
  const updateItem = (index, field, value) => setDraft((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }));
  const addItem = () => setDraft((current) => ({ ...current, items: [...current.items, { menu_item_id: "", quantity: 1 }] }));
  const removeItem = (index) => setDraft((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }));
  const addMenuItem = (menuItem) => setDraft((current) => { const index = current.items.findIndex((item) => item.menu_item_id === menuItem.id); return index === -1 ? { ...current, items: [...current.items, { menu_item_id: menuItem.id, quantity: 1 }] } : { ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: item.quantity + 1 } : item) }; });
  const orderTotal = draft.items.reduce((total, line) => total + (Number(menuItems.find((item) => item.id === line.menu_item_id)?.price || 0) * Number(line.quantity || 0)), 0);
  return <><div className="manager-toolbar manager-toolbar--filters"><Select aria-label="Filter orders" onChange={(event) => setFilter(event.target.value)} value={filter}><option value="all">All orders</option><option value="pending">Pending</option><option value="preparing">Preparing</option><option value="ready">Ready</option><option value="completed">Completed</option></Select><Button icon={Plus} onClick={openAdd}>Add Room Order</Button></div><SectionCard description="Room-service orders are stored in PostgreSQL." title="Room Orders">{loading ? <LoadingState label="Loading room orders" /> : visible.length ? <div className="manager-table-wrap"><table className="manager-table"><thead><tr><th>Order</th><th>Room</th><th>Guest</th><th>Items</th><th>Total</th><th>Status</th><th>Time</th><th>Actions</th></tr></thead><PaginatedTableBody colSpan={8} items={visible}>{(order) => <tr key={order.id}><td><CopyableIdentifier label="order ID" value={order.order_number} /></td><td>{order.room_booking?.room?.room_number || "—"}</td><td>{order.customer_name}</td><td>{order.items.length}</td><td>{money(order.total_amount)}</td><td><Badge variant={statusVariant[order.status] || "info"}>{order.status}</Badge></td><td>{new Date(order.created_at).toLocaleString()}</td><td><div className="manager-row-actions"><button aria-label={`Edit ${order.order_number}`} disabled={busy} onClick={() => openEdit(order)} title="Edit" type="button"><Pencil size={17} /></button><button aria-label={`Delete ${order.order_number}`} disabled={busy} onClick={() => setDeleting(order)} title="Delete" type="button"><Trash2 size={17} /></button></div></td></tr>}</PaginatedTableBody></table></div> : <EmptyState description="Create a room-service order once a booking and menu item are available." icon={ClipboardList} title="No room orders yet" />}</SectionCard><Modal actions={<><Button disabled={busy} onClick={() => setEditor(null)} variant="ghost">Cancel</Button><Button disabled={busy || !draft.room_booking_id || !draft.items.length || draft.items.some((item) => !item.menu_item_id || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1)} onClick={save}>{editor?.mode === "add" ? "Create Order" : "Save Changes"}</Button></>} description={editor?.hasMultipleItems ? "This existing order has multiple items and cannot be edited through the current single-item form." : "Select a checked-in guest and menu items."} className="room-order-editor-modal" isOpen={Boolean(editor)} onClose={() => !busy && setEditor(null)} title={editor?.mode === "add" ? "Add Room Order" : "Edit Room Order"}>{editor ? <div className="form-grid room-order-form"><Select label="Room Booking *" onChange={(event) => setDraft((current) => ({ ...current, room_booking_id: event.target.value }))} value={draft.room_booking_id}><option value="">Select booking</option>{bookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.room.room_number} · {booking.customer_name} · Checked in</option>)}</Select><div className="room-order-cart form-grid__full"><section className="room-order-cart__catalog"><strong>Select items</strong><div className="room-order-cart__list">{menuItems.map((item) => <article className="room-order-cart__product" key={item.id}><div><b>{item.name}</b><small>₹{item.price}</small></div><Button onClick={() => addMenuItem(item)} type="button" variant="ghost">Add</Button></article>)}</div></section><section className="room-order-cart__selected"><strong>Selected items</strong><div className="room-order-cart__list">{draft.items.length ? draft.items.map((line, index) => { const item = menuItems.find((menuItem) => menuItem.id === line.menu_item_id); return item ? <article className="room-order-cart__product" key={item.id}><div><b>{item.name}</b><small>₹{item.price}</small></div><div className="room-order-cart__quantity"><button aria-label={`Decrease ${item.name}`} onClick={() => line.quantity <= 1 ? removeItem(index) : updateItem(index, "quantity", line.quantity - 1)} type="button">−</button><span>{line.quantity}</span><button aria-label={`Increase ${item.name}`} onClick={() => updateItem(index, "quantity", line.quantity + 1)} type="button">+</button></div></article> : null; }) : <p className="room-order-cart__empty">Add menu items to this order.</p>}</div><p className="room-order-cart__total">Total <strong>₹{orderTotal.toFixed(2)}</strong></p></section></div>{editor?.mode === "edit" ? <Select label="Status" onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))} value={draft.status}><option value="pending">Pending</option><option value="preparing">Preparing</option><option value="ready">Ready</option><option value="completed">Completed</option></Select> : null}<Textarea className="form-grid__full" label="Notes" onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} value={draft.notes}/></div> : null}</Modal><Modal actions={<><Button disabled={busy} onClick={() => setDeleting(null)} variant="ghost">Cancel</Button><Button disabled={busy} onClick={remove} variant="danger">Delete</Button></>} description={deleting ? `Delete ${deleting.order_number}? This action cannot be undone.` : ""} isOpen={Boolean(deleting)} onClose={() => !busy && setDeleting(null)} title="Delete Room Order"><p className="modal-copy">Are you sure you want to delete this room order?</p></Modal></>;
}

function BillingView() {
  const { user, signOut } = useAuth();
  const [records, setRecords] = useState(null);
  const [error, setError] = useState("");
  const [selector, setSelector] = useState(false);
  const [bookings, setBookings] = useState(null);
  const [bookingId, setBookingId] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [payment, setPayment] = useState(null);
  const [paymentUncertain, setPaymentUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [toast, setToast] = useState(null);
  const [adjustments, setAdjustments] = useState(null);
  const [billSelection, setBillSelection] = useState(emptyBillingSelection);
  const submitting = useRef(false);
  const report = (failure) => {
    if (failure.status === 401) void signOut().catch(() => {});
    setToast({ title: "Unable to complete request", message: failure.message });
  };
  const openBill = async (id) => {
    try { const bill = await getBill(user.hotelId, id); setDetail(bill); setBillSelection(selectionFromBill(bill)); } catch (failure) { report(failure); }
  };
  const refreshBill = async (updated) => {
    setDetail(updated);
    setRecords(current => current?.map(bill => bill.id === updated.id ? updated : bill));
    try {
      const [fresh, list] = await Promise.all([getBill(user.hotelId, updated.id), getBills(user.hotelId)]);
      setDetail(fresh); setRecords(list); setError("");
    } catch (failure) { report(new Error("Saved, but refresh failed. Reopen the bill to verify its current state. " + failure.message)); if (failure.status === 401) void signOut().catch(() => {}); }
  };
  const finalize = async () => {
    if (submitting.current || detail?.status !== "DRAFT") return;
    submitting.current = true; setBusy(true);
    try {
      const updated = await finalizeBill(user.hotelId, detail.id, billSelection);
      setToast({ title: "Bill finalized", message: updated.invoice_number + " was finalized." });
      await refreshBill(updated);
    } catch (failure) { report(failure); }
    finally { submitting.current = false; setBusy(false); }
  };
  const recalculate = async () => {
    if (submitting.current || detail?.status !== "DRAFT") return;
    submitting.current = true; setBusy(true);
    try { const updated = await recalculateBill(user.hotelId, detail.id, billSelection); setBillSelection(selectionFromBill(updated)); await refreshBill(updated); setToast({ title: "Bill recalculated", message: updated.invoice_number + " was updated." }); }
    catch (failure) { report(failure); } finally { submitting.current = false; setBusy(false); }
  };
  const pay = async () => {
    if (submitting.current || !payment) return;
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(payment.amount) || Number(payment.amount) <= 0) {
      report(new Error("Enter a positive payment amount with at most two decimal places.")); return;
    }
    submitting.current = true; setBusy(true);
    try {
      const updated = await recordBillPayment(user.hotelId, detail.id, payment);
      setPayment(null); setPaymentUncertain(false);
      setToast({ title: "Payment recorded", message: updated.invoice_number + " was updated." });
      await refreshBill(updated);
    } catch (failure) {
      const uncertain = !failure.status || failure.status >= 500;
      setPaymentUncertain(uncertain || paymentUncertain);
      report(uncertain ? new Error("Payment confirmation was not received. Retry this unchanged payment to safely verify the result.") : failure);
    } finally { submitting.current = false; setBusy(false); }
  };
  const openGenerator = async () => {
    setSelector(true); setBookings(null); setBookingId(""); setSelectionError("");
    try {
      const [workspace, currentBills, availableAdjustments] = await Promise.all([getRoomBookingWorkspace(user.hotelId), getBills(user.hotelId), getBillingAdjustments(user.hotelId)]);
      setBookings(workspace.room_bookings); setRecords(currentBills); setAdjustments(availableAdjustments); setBillSelection(emptyBillingSelection);
    } catch (failure) { setSelectionError(failure.message); report(failure); }
  };
  const selected = bookings?.find(booking => booking.id === bookingId);
  const existingBill = (records || []).find(bill => bill.room_booking_id === bookingId);
  // Presentation hints only; the server revalidates every source and financial rule.
  const unavailable = selected?.status === "cancelled" ? "Cancelled bookings cannot be billed."
    : selected && Number(selected.paid_amount) !== 0 ? "Legacy paid amount requires reconciliation before billing." : "";
  const generate = async () => {
    if (submitting.current || !selected || existingBill || unavailable) return;
    submitting.current = true; setBusy(true);
    try {
      const created = await createRoomBill(user.hotelId, selected.id, billSelection);
      setSelector(false); setDetail(created);
      setToast({ title: "Bill generated", message: created.invoice_number + " was saved. Current list filters remain unchanged." });
      try { setRecords(await getBills(user.hotelId)); setError(""); }
      catch (failure) { setError("Bill generated, but the list could not be refreshed. Reload before trying again."); report(failure); }
    } catch (failure) {
      report(failure);
      // A concurrent request may already have generated the booking's bill.
      try { setRecords(await getBills(user.hotelId)); } catch { /* Preserve the original error. */ }
    } finally { submitting.current = false; setBusy(false); }
  };
  const [filters, setFilters] = useState({ from: "", to: "", room: "", sort: "newest", status: "all" });
  useEffect(() => {
    if (!user?.hotelId) return;
    const controller = new AbortController();
    setRecords(null); setError("");
    Promise.all([getBills(user.hotelId, { signal: controller.signal }), getBillingAdjustments(user.hotelId, { signal: controller.signal })]).then(([billRows, availableAdjustments]) => { setRecords(billRows); setAdjustments(availableAdjustments); }).catch(failure => {
      if (failure.name === "AbortError") return;
      if (failure.status === 401) void signOut().catch(() => {});
      setError(failure.message);
    });
    return () => controller.abort();
  }, [user?.hotelId, signOut]);
  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const bills = (records || []).filter(bill => bill.type === "ROOM").map(bill => ({ ...bill, room: bill.guest_snapshot.room_number || "—", guest: bill.guest_snapshot.name || "—", date: bill.created_at.slice(0, 10) })).filter(bill =>
    (!filters.room || bill.room.includes(filters.room)) && (!filters.from || bill.date >= filters.from) && (!filters.to || bill.date <= filters.to) &&
    (filters.status === "all" || (filters.status === "paid" ? bill.status === "PAID" : ["DRAFT", "FINALIZED", "PARTIALLY_PAID"].includes(bill.status)))
  ).sort((a,b) => filters.sort === "amount" ? Number(b.total_amount) - Number(a.total_amount) : filters.sort === "oldest" ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at));
  return <><div className="manager-billing-layout"><SectionCard action={<Button disabled={busy || !user?.hotelId} icon={Plus} onClick={openGenerator}>Generate Bill</Button>} description="Generated room bills and payment status." title="Room Billing">{error ? <EmptyState description={error} icon={ReceiptIndianRupee} title="Unable to load billing" /> : !records ? <LoadingState label="Loading billing records" /> : bills.length ? <CompactTable columns={["Bill", "Room", "Guest", "Amount", "Payment", "Date"]} rows={bills.map((bill) => [<span className="identifier-with-action" key={bill.id}><CopyableIdentifier label="invoice ID" value={bill.invoice_number} /><Button aria-label={`Open ${bill.invoice_number}`} onClick={() => openBill(bill.id)} size="sm" variant="ghost">View</Button></span>, bill.room, bill.guest, billingMoney(bill.total_amount), <Badge key={bill.id} variant={bill.status === "PAID" ? "success" : "warning"}>{bill.status}</Badge>, bill.date])} /> : <EmptyState description="Generated room bills will appear here." icon={ReceiptIndianRupee} title="No room bills yet" />}</SectionCard><aside className="manager-billing-filters"><h3>Filter bills</h3><p>Refine billing records by stay and payment details.</p><Input label="From" onChange={(event) => setFilter("from", event.target.value)} type="date" value={filters.from} /><Input label="To" onChange={(event) => setFilter("to", event.target.value)} type="date" value={filters.to} /><Input label="Room number" onChange={(event) => setFilter("room", event.target.value)} placeholder="e.g. 204" value={filters.room} /><Select label="Sort by" onChange={(event) => setFilter("sort", event.target.value)} value={filters.sort}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount">Highest amount</option></Select><Select label="Payment status" onChange={(event) => setFilter("status", event.target.value)} value={filters.status}><option value="all">All statuses</option><option value="paid">Paid</option><option value="pending">Pending</option></Select><Button onClick={() => setFilters({ from: "", to: "", room: "", sort: "newest", status: "all" })} variant="outline">Clear filters</Button></aside></div>
    <Modal className="room-bill-selector-modal" title="Generate Room Bill" description="Choose a room booking. The backend calculates all charges." isOpen={selector} onClose={() => !busy && setSelector(false)} actions={<><Button disabled={busy} onClick={() => setSelector(false)} variant="ghost">Cancel</Button>{existingBill ? <Button onClick={() => { setSelector(false); void openBill(existingBill.id); }}>Open Bill</Button> : <Button disabled={busy || !selected || Boolean(unavailable) || Boolean(selectionError)} onClick={generate}>{busy ? "Generating…" : "Generate Bill"}</Button>}</>}>
      {selectionError ? <p role="alert">{selectionError}</p> : !bookings ? <LoadingState label="Loading bookings" /> : bookings.length ? <div className="form-grid"><Select className="form-grid__full" disabled={busy} label="Room booking" value={bookingId} onChange={event => setBookingId(event.target.value)}><option value="">Select a booking</option>{bookings.map(booking => <option key={booking.id} value={booking.id}>Room {booking.room?.room_number || "—"} · {booking.customer_name} · {booking.status}</option>)}</Select><div className="form-grid__full"><BillingAdjustmentFields disabled={busy} options={adjustments} selection={billSelection} onChange={setBillSelection} /></div>{selected ? <div className="form-grid__full"><p>Booking: <CopyableIdentifier label="booking ID" value={selected.booking_number} /></p><p>Check-in: {selected.booking_from.slice(0,10)} · Check-out: {selected.booking_to.slice(0,10)}</p><p>Status: {selected.status}</p>{existingBill ? <p>Already billed: {existingBill.invoice_number} · {existingBill.status}</p> : unavailable ? <p role="status">{unavailable}</p> : <p>Available for draft generation, subject to backend validation. Unfinished room-service orders prevent finalization, not draft creation.</p>}</div> : null}</div> : <EmptyState icon={ReceiptIndianRupee} title="No room bookings" description="Create a room booking before generating a bill." />}
    </Modal>
    <Modal className="room-bill-preview-modal" title={detail?.invoice_number || "Room Bill"} description={detail ? "Room " + detail.guest_snapshot.room_number + " · " + detail.guest_snapshot.name + " · " + detail.status + (detail.source_reference ? " · Booking: " + detail.source_reference : "") : ""} isOpen={Boolean(detail) && !payment} onClose={() => !busy && setDetail(null)} actions={<><Button disabled={busy} onClick={() => setDetail(null)} variant="ghost">Close</Button>{detail?.status === "DRAFT" ? <><Button disabled={busy} onClick={recalculate} variant="outline">Recalculate</Button><Button disabled={busy} onClick={finalize}>{busy ? "Finalizing…" : "Finalize Bill"}</Button></> : ["FINALIZED", "PARTIALLY_PAID"].includes(detail?.status) ? <Button disabled={busy} onClick={() => { setPaymentUncertain(false); setPayment({ amount: "", method: "Cash", reference: "", notes: "", idempotency_key: crypto.randomUUID() }); }}>Record Payment</Button> : null}</>}>
      {detail ? <>{detail.status === "DRAFT" ? <BillingAdjustmentFields disabled={busy} options={adjustments} selection={billSelection} onChange={setBillSelection} /> : null}<div className="room-bill-preview__items"><table><colgroup><col /><col /><col /><col /></colgroup><thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody>{detail.items.map(item => <tr key={item.id}><td>{item.description}</td><td>{item.quantity}</td><td>{billingMoney(item.unit_price)}</td><td>{billingMoney(billingLineAmount(item))}</td></tr>)}</tbody></table>{detail.payments?.length ? <section className="room-bill-preview__history" aria-label="Payment history"><strong>Payment history</strong><table><thead><tr><th>Date</th><th>Method</th><th>Amount</th><th>Reference</th></tr></thead><tbody>{detail.payments.map(entry => <tr key={entry.id}><td>{new Date(entry.created_at).toLocaleString()}</td><td>{entry.method}</td><td>{billingMoney(entry.amount)}</td><td>{entry.reference || "—"}</td></tr>)}</tbody></table></section> : null}</div><dl className="room-bill-preview__totals"><dt>Subtotal</dt><dd>{billingMoney(detail.subtotal)}</dd><BillingAdjustmentSummary bill={detail} money={billingMoney} /><dt className="room-bill-preview__total">Total</dt><dd className="room-bill-preview__total">{billingMoney(detail.total_amount)}</dd><dt>Paid</dt><dd>{billingMoney(detail.amount_paid)}</dd><dt>Balance</dt><dd>{billingMoney(detail.balance_due)}</dd></dl></> : null}
    </Modal>
    <Modal className="room-bill-selector-modal" title="Record Payment" description={detail?.invoice_number || ""} isOpen={Boolean(payment)} onClose={() => !busy && !paymentUncertain && setPayment(null)} actions={<><Button disabled={busy || paymentUncertain} onClick={() => setPayment(null)} variant="ghost">Cancel</Button><Button disabled={busy} onClick={pay}>{busy ? "Recording…" : paymentUncertain ? "Retry Payment" : "Record Payment"}</Button></>}>
      {payment ? <div className="form-grid">
        {paymentUncertain ? <p className="form-grid__full" role="alert">Confirmation is uncertain. Retry the unchanged payment before starting another payment.</p> : null}
        <Input label="Amount" inputMode="decimal" disabled={busy || paymentUncertain} value={payment.amount} onChange={event => setPayment(current => ({ ...current, amount: event.target.value }))} />
        <Select label="Payment Method" disabled={busy || paymentUncertain} value={payment.method} onChange={event => setPayment(current => ({ ...current, method: event.target.value }))}><option value="Cash">Cash</option><option value="UPI">UPI</option><option value="Card">Card</option></Select>
        <Input className="form-grid__full" label="Reference / Transaction ID" maxLength={255} disabled={busy || paymentUncertain} value={payment.reference} onChange={event => setPayment(current => ({ ...current, reference: event.target.value }))} />
        <Textarea className="form-grid__full" label="Notes" maxLength={2000} disabled={busy || paymentUncertain} value={payment.notes} onChange={event => setPayment(current => ({ ...current, notes: event.target.value }))} />
      </div> : null}
    </Modal>
    {toast ? <div className="toast-region"><Toast title={toast.title} message={toast.message} onDismiss={() => setToast(null)} /></div> : null}
  </>;
}

const emptyMenuDraft = () => ({ name: "", category: "", price: "", status: "available" });

function ManagerMenuForm({ categories, draft, errors, onChange }) {
  return <div className="form-grid manager-menu-form">
    <div><Input label="Item Name *" name="manager-menu-name" onChange={(event) => onChange("name", event.target.value)} placeholder="e.g. Chicken Biryani" value={draft.name} />{errors.name ? <span className="manager-form-error">{errors.name}</span> : null}</div>
    <div><Select label="Category *" name="manager-menu-category" onChange={(event) => onChange("category", event.target.value)} value={draft.category}><option value="">Select a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select>{errors.category ? <span className="manager-form-error">{errors.category}</span> : null}</div>
    <div><Input label="Price *" min="0" name="manager-menu-price" onChange={(event) => onChange("price", event.target.value)} placeholder="e.g. 240" type="number" value={draft.price} />{errors.price ? <span className="manager-form-error">{errors.price}</span> : null}</div>
    <Select className="form-grid__full" label="Status" name="manager-menu-status" onChange={(event) => onChange("status", event.target.value)} value={draft.status}><option value="available">Available</option><option value="out-of-stock">Out of Stock</option></Select>
  </div>;
}

function ManagerMenuView({ notify }) {
  const { signOut, user } = useAuth();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editor, setEditor] = useState(null);
  const [draft, setDraft] = useState(emptyMenuDraft);
  const [errors, setErrors] = useState({});
  const [deleteItem, setDeleteItem] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const categoryNames = useMemo(() => categories.map(({ name }) => name), [categories]);
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => (category === "All" || item.category?.name === category) && (!needle || item.name.toLowerCase().includes(needle)));
  }, [category, items, query]);

  const loadMenu = useCallback(async ({ signal } = {}) => {
    if (!user?.hotelId) {
      setCategories([]);
      setItems([]);
      setLoadError("Your account does not have an available hotel context.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError("");
    try {
      const [nextCategories, nextItems] = await Promise.all([
        getMenuCategories(user.hotelId, { signal }),
        getMenuItems(user.hotelId, { signal }),
      ]);
      setCategories(nextCategories);
      setItems(nextItems);
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (error?.status === 401) {
        await signOut().catch(() => {});
        return;
      }
      setCategories([]);
      setItems([]);
      setLoadError(error?.message || "Please try again.");
      notify(error?.message || "Please try again.", "Unable to load menu", "error");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [notify, signOut, user?.hotelId]);

  useEffect(() => {
    const controller = new AbortController();
    loadMenu({ signal: controller.signal });
    return () => controller.abort();
  }, [loadMenu]);

  const openAdd = () => { setEditor({ mode: "add", id: null }); setDraft(emptyMenuDraft()); setErrors({}); };
  const openEdit = (item) => { setEditor({ mode: "edit", id: item.id }); setDraft({ name: item.name, category: item.category?.id || "", price: String(item.price), status: item.is_available ? "available" : "out-of-stock" }); setErrors({}); };
  const closeEditor = () => { if (!isSubmitting) { setEditor(null); setErrors({}); } };
  const changeDraft = (field, value) => { setDraft((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: "" })); };
  const handleMenuMutationError = async (error) => {
    if (error?.status === 401) {
      await signOut().catch(() => {});
      return;
    }
    notify(error?.message || "Please try again.", "Unable to complete request", "error");
  };
  const saveItem = async () => {
    if (!user?.hotelId || !editor || isSubmitting) return;
    const nextErrors = {};
    const name = draft.name.trim();
    if (!name) nextErrors.name = "Item name is required.";
    if (!draft.category) nextErrors.category = "Category is required.";
    if (!draft.price) nextErrors.price = "Price is required.";
    else if (!/^[+-]?\d{1,8}(?:\.\d{1,2})?$/.test(draft.price)) nextErrors.price = "Price must have up to 8 whole digits and 2 decimal places.";
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    if (!categories.some((entry) => entry.id === draft.category)) {
      await loadMenu();
      setErrors({ category: "The selected category is no longer available." });
      notify("The selected category no longer exists. Choose another category.", "Unable to save menu item", "error");
      return;
    }
    const input = { name, category_id: draft.category, price: draft.price, is_available: draft.status === "available" };
    setIsSubmitting(true);
    try {
      if (editor.mode === "edit") await updateMenuItem(user.hotelId, editor.id, input);
      else await createMenuItem(user.hotelId, input);
      setEditor(null);
      setErrors({});
      await loadMenu();
      notify(`${name} was saved successfully.`, editor.mode === "edit" ? "Menu item updated" : "Menu item created");
    } catch (error) {
      await handleMenuMutationError(error);
    } finally {
      setIsSubmitting(false);
    }
  };
  const confirmDelete = async () => {
    if (!user?.hotelId || !deleteItem || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await deleteMenuItem(user.hotelId, deleteItem.id);
      setDeleteItem(null);
      await loadMenu();
      notify("The menu item was deleted successfully.", "Menu item deleted");
    } catch (error) {
      await handleMenuMutationError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return <div className="manager-menu-page">
    <header className="manager-menu-page__header"><p>Manage your restaurant menu items</p><Button icon={Plus} onClick={openAdd}>Add New Item</Button></header>
    <div className="search-with-filter search-with-filter--spaced"><SearchInput className="manager-menu-search" onChange={(event) => setQuery(event.target.value)} placeholder="Search menu items..." value={query} /><FilterButton><div aria-label="Filter menu items by category" className="manager-menu-categories" role="group">{["All", ...categoryNames].map((name) => <button aria-pressed={category === name} className={category === name ? "is-active" : ""} key={name} onClick={() => setCategory(name)} type="button">{name}</button>)}</div></FilterButton></div>
    <SectionCard className="manager-menu-table-card" description={`${visibleItems.length} of ${items.length} menu items`} title="Menu Items">
      {isLoading ? <LoadingState label="Loading menu" /> : <div className="manager-table-wrap"><table className="manager-table manager-menu-table"><thead><tr><th>Item Name</th><th>Category</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead><PaginatedTableBody colSpan={5} items={visibleItems}>{(item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{item.category?.name || ""}</td><td><strong>₹{item.price}</strong></td><td><Badge variant={item.is_available ? "success" : "danger"}>{item.is_available ? "available" : "unavailable"}</Badge></td><td><div className="manager-menu-actions"><button aria-label={`Edit ${item.name}`} onClick={() => openEdit(item)} title="Edit" type="button"><Pencil size={16} /></button><button aria-label={`Delete ${item.name}`} onClick={() => setDeleteItem(item)} title="Delete" type="button"><Trash2 size={16} /></button></div></td></tr>}</PaginatedTableBody></table>{visibleItems.length === 0 ? <EmptyState description={loadError || "Try another item name or category."} icon={UtensilsCrossed} title={loadError ? "Unable to load menu" : "No menu items found"} /> : null}</div>}
    </SectionCard>
    <Modal actions={<><Button disabled={isSubmitting} onClick={closeEditor} variant="ghost">Cancel</Button><Button disabled={isSubmitting} onClick={saveItem}>{editor?.mode === "add" ? "Add Item" : "Save Changes"}</Button></>} description={editor?.mode === "add" ? "Add a new restaurant menu item." : "Update this menu item's details."} isOpen={Boolean(editor)} onClose={closeEditor} title={editor?.mode === "add" ? "Add New Menu Item" : "Edit Menu Item"}><ManagerMenuForm categories={categories} draft={draft} errors={errors} onChange={changeDraft} /></Modal>
    <Modal actions={<><Button disabled={isSubmitting} onClick={() => { if (!isSubmitting) setDeleteItem(null); }} variant="ghost">Cancel</Button><Button disabled={isSubmitting} onClick={confirmDelete} variant="danger">Delete</Button></>} description={deleteItem ? `Are you sure you want to delete ${deleteItem.name}?` : ""} isOpen={Boolean(deleteItem)} onClose={() => { if (!isSubmitting) setDeleteItem(null); }} title="Delete Menu Item?"><p className="modal-copy">Are you sure you want to delete this menu item?</p></Modal>
  </div>;
}

const emptyManagerVendor = () => ({ name: "", contact_person: "", phone: "", email: "", address: "", items_supplied: "", payment_terms: "" });
const formatVendorDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
};

function ManagerVendorForm({ draft, errors, onChange }) {
  return <div className="form-grid manager-vendor-form">
    <div className="form-grid__full"><Input label="Vendor/Company Name *" name="manager-vendor-name" onChange={(event) => onChange("name", event.target.value)} placeholder="e.g. Fresh Foods Ltd" value={draft.name} />{errors.name ? <span className="manager-form-error">{errors.name}</span> : null}</div>
    <div><Input label="Contact Person" name="manager-vendor-contact" onChange={(event) => onChange("contact_person", event.target.value)} value={draft.contact_person} /></div><div><Input label="Phone" name="manager-vendor-phone" onChange={(event) => onChange("phone", event.target.value)} value={draft.phone} /></div>
    <div className="form-grid__full"><Input label="Email" name="manager-vendor-email" onChange={(event) => onChange("email", event.target.value)} type="email" value={draft.email} /></div><div className="form-grid__full"><Input label="Address" name="manager-vendor-address" onChange={(event) => onChange("address", event.target.value)} value={draft.address} /></div><Input label="Items Supplied" name="manager-vendor-items-supplied" onChange={(event) => onChange("items_supplied", event.target.value)} value={draft.items_supplied} /><Input label="Payment Terms" name="manager-vendor-payment-terms" onChange={(event) => onChange("payment_terms", event.target.value)} value={draft.payment_terms} />
  </div>;
}

function ManagerVendorsView({ notify }) {
  const { user, signOut } = useAuth();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState(null);
  const [draft, setDraft] = useState(emptyManagerVendor);
  const [errors, setErrors] = useState({});
  const [vendorPendingDeletion, setVendorPendingDeletion] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const loadVendors = useCallback(async () => { if (!user?.hotelId) return; setIsLoading(true); try { setVendors(await getVendors(user.hotelId)); } catch (error) { if (error?.status === 401) await signOut().catch(() => {}); else notify(error.message || "Unable to load vendors.", "Unable to load vendors", "error"); } finally { setIsLoading(false); } }, [user?.hotelId, signOut, notify]);
  useEffect(() => { loadVendors(); }, [loadVendors]);
  const counts = useMemo(() => ({ all: vendors.length, active: vendors.filter((vendor) => vendor.is_active).length, inactive: vendors.filter((vendor) => !vendor.is_active).length }), [vendors]);
  const visibleVendors = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return vendors.filter((vendor) => (filter === "all" || vendor.is_active === (filter === "active")) && (!needle || [vendor.name, vendor.contact_person, vendor.phone, vendor.email].some((value) => String(value || "").toLowerCase().includes(needle))));
  }, [filter, query, vendors]);
  const openAdd = () => { setEditor({ mode: "add", id: null }); setDraft(emptyManagerVendor()); setErrors({}); };
  const openEdit = (vendor) => { setEditor({ mode: "edit", id: vendor.id }); setDraft({ name: vendor.name, contact_person: vendor.contact_person || "", phone: vendor.phone || "", email: vendor.email || "", address: vendor.address || "", items_supplied: vendor.items_supplied || "", payment_terms: vendor.payment_terms || "" }); setErrors({}); };
  const closeEditor = () => { setEditor(null); setErrors({}); };
  const changeDraft = (field, value) => { setDraft((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: "" })); };
  const saveVendor = async () => {
    const nextErrors = {};
    if (!draft.name.trim()) nextErrors.name = "Company name is required.";
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    const payload = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim() || null])); payload.name = draft.name.trim(); setIsSubmitting(true); try { if (editor?.mode === "edit") await updateVendor(user.hotelId, editor.id, payload); else await createVendor(user.hotelId, payload); closeEditor(); await loadVendors(); notify(`${payload.name} was saved.`, editor?.mode === "edit" ? "Vendor updated" : "Vendor added"); } catch (error) { if (error?.status === 401) await signOut().catch(() => {}); else notify(error.message || "Unable to save vendor.", "Unable to complete request", "error"); } finally { setIsSubmitting(false); }
  };
  const toggleVendor = async (vendor) => {
    setIsSubmitting(true); try { await updateVendorStatus(user.hotelId, vendor.id, !vendor.is_active); await loadVendors(); notify(`${vendor.name} status was updated.`, vendor.is_active ? "Vendor deactivated" : "Vendor activated"); } catch (error) { if (error?.status === 401) await signOut().catch(() => {}); else notify(error.message || "Unable to update vendor.", "Unable to complete request", "error"); } finally { setIsSubmitting(false); }
  };
  const confirmDelete = async () => {
    if (isSubmitting || !vendorPendingDeletion?.id) return;
    setIsSubmitting(true); try { await deleteVendor(user.hotelId, vendorPendingDeletion.id); setVendorPendingDeletion(null); await loadVendors(); notify("Vendor was removed.", "Vendor deleted"); } catch (error) { if (error?.status === 401) await signOut().catch(() => {}); else notify(error.message || "Unable to delete vendor.", "Unable to complete request", "error"); } finally { setIsSubmitting(false); }
  };

  return <div className="manager-vendors-page">
    <header className="manager-vendors-page__header"><p>{vendors.length} vendors registered</p><Button icon={Plus} onClick={openAdd}>Add Vendor</Button></header>
    <div className="search-with-filter search-with-filter--spaced"><SearchInput className="manager-vendor-search" onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, contact, or phone..." value={query} /><FilterButton><div aria-label="Filter vendors by status" className="manager-vendor-filters" role="group">{["all", "active", "inactive"].map((status) => <button aria-pressed={filter === status} className={filter === status ? "is-active" : ""} key={status} onClick={() => setFilter(status)} type="button">{status} <span>({counts[status]})</span></button>)}</div></FilterButton></div>
    <SectionCard className="manager-vendor-table-card" description={`${visibleVendors.length} ${visibleVendors.length === 1 ? "vendor" : "vendors"} shown`} title="Registered Vendors">
      {isLoading ? <LoadingState label="Loading vendors" /> : <div className="vendor-table-wrap"><table className="vendor-table"><thead><tr><th>Vendor</th><th>Contact Person</th><th>Phone</th><th>Email</th><th>Items Supplied</th><th>Payment Terms</th><th>Status</th><th>Registered</th><th>Actions</th></tr></thead><PaginatedTableBody colSpan={9} items={visibleVendors}>{(vendor) => <tr className={!vendor.is_active ? "manager-vendor-row--inactive" : ""} key={vendor.id}><td><strong>{vendor.name}</strong></td><td>{vendor.contact_person || "—"}</td><td>{vendor.phone || "—"}</td><td>{vendor.email || "—"}</td><td>{vendor.items_supplied || "—"}</td><td>{vendor.payment_terms || "—"}</td><td><Badge variant={vendor.is_active ? "success" : "neutral"}>{vendor.is_active ? "ACTIVE" : "INACTIVE"}</Badge></td><td>{formatVendorDate(vendor.created_at)}</td><td><div className="manager-vendor-actions"><button disabled={isSubmitting} className={`icon-button status-action status-action--${vendor.is_active ? "active" : "inactive"}`} onClick={() => toggleVendor(vendor)} type="button"><Ban size={16} /></button><button className="icon-button" disabled={isSubmitting} onClick={() => openEdit(vendor)} type="button"><Pencil size={16} /></button><button className="icon-button" disabled={isSubmitting} onClick={() => setVendorPendingDeletion(vendor)} type="button"><Trash2 size={16} /></button></div></td></tr>}</PaginatedTableBody></table>{visibleVendors.length === 0 ? <EmptyState description="Try another status filter or search term." icon={Store} title="No vendors found" /> : null}</div>}
    </SectionCard>
    <Modal actions={<><Button disabled={isSubmitting} onClick={closeEditor} variant="ghost">Cancel</Button><Button disabled={isSubmitting} onClick={saveVendor}>{editor?.mode === "edit" ? "Save Changes" : "Add Vendor"}</Button></>} description={editor?.mode === "edit" ? "Update this supplier's information." : "Register a supplier for hotel operations."} isOpen={Boolean(editor)} onClose={closeEditor} title={editor?.mode === "edit" ? "Edit Vendor" : "Add Vendor"}><ManagerVendorForm draft={draft} errors={errors} onChange={changeDraft} /></Modal>
    <Modal actions={<><Button disabled={isSubmitting} onClick={() => setVendorPendingDeletion(null)} variant="ghost">Cancel</Button><Button disabled={isSubmitting} onClick={confirmDelete} variant="danger">Delete</Button></>} description={vendorPendingDeletion ? `${vendorPendingDeletion.name} will be removed from the supplier directory.` : ""} isOpen={Boolean(vendorPendingDeletion)} onClose={() => setVendorPendingDeletion(null)} title="Delete Vendor?"><p className="modal-copy">Are you sure you want to delete this vendor?</p></Modal>
  </div>;
}

const emptyInventoryDraft = () => ({ name: "", category: "", quantity: "", minimum_quantity: "", unit: "kg", supplier_id: "" });
const inventoryIsLow = (item) => Number(item.quantity) <= Number(item.minimum_quantity);

function ManagerInventoryForm({ draft, errors, onChange, vendors }) {
  return <div className="manager-inventory-form">
    <Input label="Item Name *" name="manager-inventory-name" onChange={(event) => onChange("name", event.target.value)} placeholder="e.g. Fresh Cream" value={draft.name} />
    {errors.name ? <span className="manager-inventory-form__error">{errors.name}</span> : null}
    <div className="manager-inventory-form__row">
      <Select label="Category" name="manager-inventory-category" onChange={(event) => onChange("category", event.target.value)} value={draft.category}><option value="">Select category</option>{managerInventoryCategories.map((category) => <option key={category}>{category}</option>)}</Select>
      <Select label="Unit *" name="manager-inventory-unit" onChange={(event) => onChange("unit", event.target.value)} value={draft.unit}><option value="kg">kg</option><option value="ltr">ltr</option><option value="pcs">pcs</option><option value="pack">pack</option></Select>
    </div>
    {errors.category || errors.unit ? <span className="manager-inventory-form__error">{errors.category || errors.unit}</span> : null}
    <div className="manager-inventory-form__row">
      <Input label="Current Stock" min="0" name="manager-inventory-stock" onChange={(event) => onChange("quantity", event.target.value)} step="0.01" type="number" value={draft.quantity} />
      <Input label="Minimum Stock" min="0" name="manager-inventory-minimum" onChange={(event) => onChange("minimum_quantity", event.target.value)} step="0.01" type="number" value={draft.minimum_quantity} />
    </div>
    <div className="manager-inventory-form__row">
      <Input disabled label="Unit Price (not stored)" name="manager-inventory-price" value="—" />
      <Select label="Supplier / Vendor" name="manager-inventory-supplier" onChange={(event) => onChange("supplier_id", event.target.value)} value={draft.supplier_id}><option value="">Not assigned</option>{vendors.filter((vendor) => vendor.is_active).map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</Select>
    </div>
    {errors.quantity || errors.minimum_quantity ? <span className="manager-inventory-form__error">{errors.quantity || errors.minimum_quantity}</span> : null}
  </div>;
}

function ManagerInventoryView({ notify }) {
  const { user, signOut } = useAuth();
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [stockFilter, setStockFilter] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [alertVisible, setAlertVisible] = useState(true);
  const [editor, setEditor] = useState(null);
  const [draft, setDraft] = useState(emptyInventoryDraft);
  const [errors, setErrors] = useState({});
  const [deleteItem, setDeleteItem] = useState(null);
  const lowStockCount = useMemo(() => items.filter(inventoryIsLow).length, [items]);
  const inventoryCategories = useMemo(() => [...new Set([...managerInventoryCategories, ...items.map((item) => item.category).filter(Boolean)])], [items]);
  const stockTotals = useMemo(() => items.reduce((totals, item) => ({ ...totals, [item.unit || "items"]: (totals[item.unit || "items"] || 0) + Number(item.quantity) }), {}), [items]);
  const stockSummary = Object.entries(stockTotals).map(([unit, value]) => `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value)} ${unit}`).join(" · ") || "0";
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const low = inventoryIsLow(item);
      return (category === "All" || item.category === category)
        && (stockFilter === "all" || (stockFilter === "low" ? low : !low))
        && (!needle || item.name.toLowerCase().includes(needle) || String(item.category || "").toLowerCase().includes(needle));
    });
  }, [category, items, query, stockFilter]);
  const reportError = useCallback(async (error) => { if (error?.status === 401) { await signOut().catch(() => {}); return; } notify(error?.message || "Please try again.", "Unable to complete request", "error"); }, [notify, signOut]);
  const loadInventory = useCallback(async () => { if (!user?.hotelId) { setItems([]); setVendors([]); setIsLoading(false); return; } setIsLoading(true); try { const [nextItems, nextVendors] = await Promise.all([getInventoryItems(user.hotelId), getVendors(user.hotelId)]); setItems(nextItems); setVendors(nextVendors); } catch (error) { setItems([]); await reportError(error); } finally { setIsLoading(false); } }, [reportError, user?.hotelId]);
  useEffect(() => { loadInventory(); }, [loadInventory]);
  const openAdd = () => { setEditor({ mode: "add", id: null }); setDraft(emptyInventoryDraft()); setErrors({}); };
  const openEdit = (item) => { setEditor({ mode: "edit", id: item.id }); setDraft({ name: item.name, category: item.category || "", quantity: item.quantity, minimum_quantity: item.minimum_quantity, unit: item.unit || "", supplier_id: item.supplier_id || "" }); setErrors({}); };
  const closeEditor = () => { if (!isSubmitting) { setEditor(null); setErrors({}); } };
  const changeDraft = (field, value) => { setDraft((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: "" })); };
  const saveItem = async () => {
    const nextErrors = {};
    if (!draft.name.trim()) nextErrors.name = "Item name is required.";
    [["quantity", "Current stock"], ["minimum_quantity", "Minimum stock"]].forEach(([field, label]) => {
      if (draft[field] !== "" && !/^\d+(?:\.\d{1,2})?$/.test(draft[field])) nextErrors[field] = `${label} must be a non-negative number with at most two decimal places.`;
    });
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    if (!user?.hotelId || !editor) return;
    const input = { name: draft.name.trim(), category: draft.category || null, unit: draft.unit || null, supplier_id: draft.supplier_id || null };
    if (draft.quantity !== "") input.quantity = draft.quantity;
    if (draft.minimum_quantity !== "") input.minimum_quantity = draft.minimum_quantity;
    setIsSubmitting(true); try { if (editor.mode === "edit") await updateInventoryItem(user.hotelId, editor.id, input); else await createInventoryItem(user.hotelId, input); setEditor(null); await loadInventory(); setAlertVisible(true); notify(`${input.name} inventory was saved.`, editor.mode === "edit" ? "Item updated" : "Item added"); } catch (error) { await reportError(error); } finally { setIsSubmitting(false); }
  };
  const confirmDelete = async () => {
    if (!user?.hotelId || !deleteItem || isSubmitting) return;
    setIsSubmitting(true); try { await deleteInventoryItem(user.hotelId, deleteItem.id); setDeleteItem(null); await loadInventory(); notify(`${deleteItem.name} was removed from inventory.`, "Item deleted"); } catch (error) { await reportError(error); } finally { setIsSubmitting(false); }
  };
  const statusFilterLabels = { all: "All items", in: "In Stock", low: "Low Stock" };
  return <div className="manager-inventory-page">
    <header className="manager-inventory-header"><div><h2>Inventory Management</h2><Breadcrumb /><p>{items.length} items <span>•</span> {lowStockCount} stock {lowStockCount === 1 ? "alert" : "alerts"}</p></div><Button icon={Plus} onClick={openAdd}>Add Item</Button></header>
    {alertVisible && lowStockCount > 0 ? <div className="manager-inventory-alert" role="status"><span><AlertTriangle aria-hidden="true" size={20} /></span><div><strong>{lowStockCount} {lowStockCount === 1 ? "item needs" : "items need"} attention</strong><small>{lowStockCount} low stock</small></div><button onClick={() => setAlertVisible(false)} type="button">Dismiss</button></div> : null}
    <section className="manager-inventory-controls">
      <div className="search-with-filter"><SearchInput className="manager-inventory-search" onChange={(event) => setQuery(event.target.value)} placeholder="Search inventory..." value={query} /><FilterButton><div aria-label="Filter inventory by category" className="manager-inventory-categories" role="group">{["All", ...inventoryCategories].map((name) => <button aria-pressed={category === name} className={category === name ? "is-active" : ""} key={name} onClick={() => setCategory(name)} type="button">{name}</button>)}</div></FilterButton></div>
      <div className="manager-inventory-status-filter"><Button aria-expanded={filterOpen} icon={SlidersHorizontal} onClick={() => setFilterOpen((open) => !open)} variant="outline">{statusFilterLabels[stockFilter]}</Button>{filterOpen ? <div className="manager-inventory-status-menu">{Object.entries(statusFilterLabels).map(([value, label]) => <button className={stockFilter === value ? "is-active" : ""} key={value} onClick={() => { setStockFilter(value); setFilterOpen(false); }} type="button">{label}</button>)}</div> : null}</div>
    </section>
    <section aria-label="Inventory summary" className="manager-inventory-summary">
      <Card><CardContent><SemanticIcon icon={ClipboardList} semantic="Inventory items" size="lg" /><div><strong>{items.length}</strong><small>Total Items</small></div></CardContent></Card>
      <Card><CardContent><SemanticIcon icon={Package} semantic="Total stock" size="lg" /><div><strong className="is-stock-total">{stockSummary}</strong><small>Total Stock</small></div></CardContent></Card>
      <Card><CardContent><SemanticIcon icon={AlertTriangle} semantic="Low stock warning" size="lg" /><div><strong>{lowStockCount}</strong><small>Low Stock Alerts</small></div></CardContent></Card>
    </section>
    <SectionCard className="manager-inventory-table-card" description={`${visibleItems.length} ${visibleItems.length === 1 ? "item" : "items"} shown`} title="Inventory Items">
      {isLoading ? <LoadingState label="Loading inventory" /> :
      <div className="manager-table-wrap"><table className="manager-table manager-inventory-table"><thead><tr><th>Sr. No.</th><th>Item</th><th>Category</th><th>Stock</th><th>Min Stock</th><th>Unit Price</th><th>Status</th><th>Last Updated</th><th>Actions</th></tr></thead><PaginatedTableBody colSpan={9} items={visibleItems}>{(item, index, absoluteIndex) => { const low = inventoryIsLow(item); return <tr className={low ? "manager-inventory-row--low" : ""} key={item.id}><td>{absoluteIndex + 1}</td><td><div className="manager-inventory-identity"><InventoryItemIcon category={item.category || ""} name={item.name} /><div><strong>{item.name}</strong><small>{item.unit || "—"}</small></div></div></td><td>{item.category || "—"}</td><td><strong>{item.quantity} {item.unit || ""}</strong></td><td>{item.minimum_quantity} {item.unit || ""}</td><td>—</td><td><Badge variant={low ? "warning" : "success"}>{low ? "Low Stock" : "In Stock"}</Badge></td><td>{item.updated_at ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(item.updated_at)) : "—"}</td><td><div className="manager-inventory-actions"><button aria-label={`Edit ${item.name}`} disabled={isSubmitting} onClick={() => openEdit(item)} title="Edit" type="button"><Pencil size={16} /></button><button aria-label={`Delete ${item.name}`} disabled={isSubmitting} onClick={() => setDeleteItem(item)} title="Delete" type="button"><Trash2 size={16} /></button></div></td></tr>; }}</PaginatedTableBody></table>{visibleItems.length === 0 ? <EmptyState description="Try another category, status, or search term." icon={Package} title="No inventory items found" /> : null}</div>}
    </SectionCard>
    <Modal actions={<><Button disabled={isSubmitting} onClick={closeEditor} variant="ghost">Cancel</Button><Button disabled={isSubmitting} onClick={saveItem}>{editor?.mode === "edit" ? "Save Changes" : "Add Item"}</Button></>} description={editor?.mode === "edit" ? "Update this stock item's inventory details." : "Add a stock item to hotel inventory."} isOpen={Boolean(editor)} onClose={closeEditor} title={editor?.mode === "edit" ? "Edit Inventory Item" : "Add Inventory Item"}><ManagerInventoryForm draft={draft} errors={errors} onChange={changeDraft} vendors={vendors} /></Modal>
    <Modal actions={<><Button disabled={isSubmitting} onClick={() => setDeleteItem(null)} variant="ghost">Cancel</Button><Button disabled={isSubmitting} onClick={confirmDelete} variant="danger">Delete</Button></>} description={deleteItem ? `${deleteItem.name} will be removed from inventory.` : ""} isOpen={Boolean(deleteItem)} onClose={() => !isSubmitting && setDeleteItem(null)} title="Delete Inventory Item?"><p className="modal-copy">Are you sure you want to delete this inventory item?</p></Modal>
  </div>;
}

const reportRangeLabels = { today: "Today", yesterday: "Yesterday", week: "This Week", month: "This Month", year: "This Year" };
const reportCategoryColors = ["#0f172a", "#1e3a8a", "#2563eb", "#3d8af2", "#8abdf4", "#d6e6f7"];
const csvValue = (value) => `"${String(value).replaceAll('"', '""')}"`;
const reportChartColors = { blue: "#2563eb", caramel: "#b9854c", grid: "#e5eaf0", muted: "#64748b", navy: "#0f172a" };

function downloadChartCsv(filename, headers, rows) {
  const csv = [headers, ...rows].map((row) => row.map(csvValue).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function createReportCanvas(title, subtitle) {
  const width = 1200;
  const height = 720;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  context.scale(scale, scale);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = reportChartColors.navy;
  context.font = "700 30px Inter, Arial, sans-serif";
  context.fillText(title, 64, 58);
  if (subtitle) {
    context.fillStyle = reportChartColors.muted;
    context.font = "500 15px Inter, Arial, sans-serif";
    context.fillText(subtitle, 64, 86);
  }
  return { canvas, context, width, height };
}

function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
}

function drawCanvasLegend(context, entries, x, y) {
  let nextX = x;
  context.font = "600 14px Inter, Arial, sans-serif";
  entries.forEach(({ color, label }) => {
    context.fillStyle = color;
    context.fillRect(nextX, y - 9, 24, 4);
    context.fillStyle = reportChartColors.muted;
    context.fillText(label, nextX + 34, y);
    nextX += context.measureText(label).width + 82;
  });
}

function exportTrendPng(values, label, filename) {
  const { canvas, context } = createReportCanvas("Collections & Orders Trend", `${label} performance`);
  const chart = { left: 82, right: 1132, top: 142, bottom: 628 };
  const collectionsMaximum = Math.max(...values.map((entry) => Number(entry.collections)), 1);
  const ordersMaximum = Math.max(...values.map((entry) => entry.orders), 1);
  drawCanvasLegend(context, [{ color: reportChartColors.blue, label: "Collections" }, { color: reportChartColors.caramel, label: "Orders" }], 780, 82);
  context.font = "600 13px Inter, Arial, sans-serif";
  for (let index = 0; index < 5; index += 1) {
    const y = chart.top + index * ((chart.bottom - chart.top) / 4);
    context.strokeStyle = reportChartColors.grid;
    context.lineWidth = 1;
    context.beginPath(); context.moveTo(chart.left, y); context.lineTo(chart.right, y); context.stroke();
  }
  const drawLine = (key, maximum, color) => {
    context.strokeStyle = color;
    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    values.forEach((entry, index) => {
      const x = values.length === 1 ? (chart.left + chart.right) / 2 : chart.left + index * ((chart.right - chart.left) / (values.length - 1));
      const y = chart.bottom - (entry[key] / maximum) * (chart.bottom - chart.top - 24);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
    values.forEach((entry, index) => {
      const x = values.length === 1 ? (chart.left + chart.right) / 2 : chart.left + index * ((chart.right - chart.left) / (values.length - 1));
      const y = chart.bottom - (entry[key] / maximum) * (chart.bottom - chart.top - 24);
      context.fillStyle = "#ffffff"; context.strokeStyle = color; context.lineWidth = 4;
      context.beginPath(); context.arc(x, y, 6, 0, Math.PI * 2); context.fill(); context.stroke();
    });
  };
  drawLine("collections", collectionsMaximum, reportChartColors.blue);
  drawLine("orders", ordersMaximum, reportChartColors.caramel);
  context.fillStyle = reportChartColors.muted;
  context.textAlign = "center";
  values.forEach((entry, index) => {
    const x = values.length === 1 ? (chart.left + chart.right) / 2 : chart.left + index * ((chart.right - chart.left) / (values.length - 1));
    context.fillText(entry.label, x, 666);
  });
  downloadCanvas(canvas, filename);
}

function exportCategoryPng(categories, label, filename) {
  const { canvas, context } = createReportCanvas("Category Distribution", `${label} sales mix`);
  const center = { x: 350, y: 385 };
  let start = -Math.PI / 2;
  categories.forEach((category, index) => {
    const end = start + (category.percentage / 100) * Math.PI * 2;
    context.strokeStyle = reportCategoryColors[index % reportCategoryColors.length];
    context.lineWidth = 76;
    context.beginPath(); context.arc(center.x, center.y, 156, start, end); context.stroke();
    start = end;
  });
  context.fillStyle = reportChartColors.navy;
  context.textAlign = "center";
  context.font = "700 30px Inter, Arial, sans-serif";
  context.fillText("100%", center.x, center.y);
  context.fillStyle = reportChartColors.muted;
  context.font = "500 14px Inter, Arial, sans-serif";
  context.fillText("sales mix", center.x, center.y + 28);
  context.textAlign = "left";
  categories.forEach((category, index) => {
    const y = 210 + index * 64;
    context.fillStyle = reportCategoryColors[index % reportCategoryColors.length];
    context.beginPath(); context.arc(695, y - 5, 6, 0, Math.PI * 2); context.fill();
    context.fillStyle = reportChartColors.muted;
    context.font = "500 17px Inter, Arial, sans-serif";
    context.fillText(category.name, 718, y);
    context.fillStyle = reportChartColors.navy;
    context.font = "700 17px Inter, Arial, sans-serif";
    context.fillText(`${category.percentage}%`, 1030, y);
  });
  downloadCanvas(canvas, filename);
}

function exportDailyPng(values, label, filename) {
  const { canvas, context } = createReportCanvas("Period Performance", `${label} orders and collections`);
  const chart = { left: 86, right: 1122, top: 154, bottom: 620 };
  const collectionsMaximum = Math.max(...values.map((entry) => Number(entry.collections)), 1);
  const ordersMaximum = Math.max(...values.map((entry) => entry.orders), 1);
  drawCanvasLegend(context, [{ color: reportChartColors.caramel, label: "Orders" }, { color: reportChartColors.blue, label: "Collections" }], 780, 82);
  for (let index = 0; index < 5; index += 1) {
    const y = chart.top + index * ((chart.bottom - chart.top) / 4);
    context.strokeStyle = reportChartColors.grid;
    context.lineWidth = 1;
    context.beginPath(); context.moveTo(chart.left, y); context.lineTo(chart.right, y); context.stroke();
  }
  const groupWidth = (chart.right - chart.left) / values.length;
  values.forEach((entry, index) => {
    const centerX = chart.left + groupWidth * index + groupWidth / 2;
    const orderHeight = (entry.orders / ordersMaximum) * (chart.bottom - chart.top - 22);
    const collectionsHeight = (Number(entry.collections) / collectionsMaximum) * (chart.bottom - chart.top - 22);
    context.fillStyle = reportChartColors.caramel;
    context.fillRect(centerX - 25, chart.bottom - orderHeight, 18, orderHeight);
    context.fillStyle = reportChartColors.blue;
    context.fillRect(centerX + 7, chart.bottom - collectionsHeight, 18, collectionsHeight);
    context.fillStyle = reportChartColors.muted;
    context.font = "600 13px Inter, Arial, sans-serif";
    context.textAlign = "center";
    context.fillText(entry.label, centerX, 660);
  });
  downloadCanvas(canvas, filename);
}

function printManagerReports() {
  const cleanup = () => document.body.classList.remove("manager-report-print");
  document.body.classList.add("manager-report-print");
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
  window.setTimeout(cleanup, 500);
}

function ChartExportMenu({ chartName, onExportCsv, onExportPng }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const menuId = `chart-export-${chartName.toLowerCase().replaceAll(" ", "-")}`;
  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => { if (!menuRef.current?.contains(event.target)) setOpen(false); };
    const closeOnEscape = (event) => { if (event.key === "Escape") { setOpen(false); menuRef.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    requestAnimationFrame(() => menuRef.current?.querySelector('[role="menuitem"]')?.focus());
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [open]);
  const run = (action) => { setOpen(false); action(); };
  return <div className="manager-chart-export" ref={menuRef}>
    <button aria-controls={menuId} aria-expanded={open} aria-haspopup="menu" className="manager-chart-export__trigger" onClick={() => setOpen((current) => !current)} type="button"><Download aria-hidden="true" size={15} /><span>Export</span><ChevronDown aria-hidden="true" className={open ? "is-open" : ""} size={14} /></button>
    {open ? <div aria-label={`${chartName} export options`} className="manager-chart-export__menu" id={menuId} role="menu">
      <button onClick={() => run(onExportPng)} role="menuitem" type="button"><Image aria-hidden="true" size={16} /><span><strong>Export PNG</strong><small>Download chart image</small></span></button>
      <button onClick={() => run(onExportCsv)} role="menuitem" type="button"><FileSpreadsheet aria-hidden="true" size={16} /><span><strong>Export CSV</strong><small>Download chart data</small></span></button>
      <button onClick={() => run(printManagerReports)} role="menuitem" type="button"><Printer aria-hidden="true" size={16} /><span><strong>Print / PDF</strong><small>Open print dialog</small></span></button>
    </div> : null}
  </div>;
}

function ReportLineChart({ values }) {
  const collectionsMaximum = Math.max(...values.map((entry) => Number(entry.collections)), 1);
  const ordersMaximum = Math.max(...values.map((entry) => entry.orders), 1);
  const xFor = index => values.length === 1 ? 350 : 50 + index * (600 / (values.length - 1));
  const points = (key, maximum) => values.map((entry, index) => `${xFor(index)},${225 - (Number(entry[key]) / maximum) * 170}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(values.length / 8));
  return <div className="manager-report-line-chart">
    <div className="manager-report-legend"><span><i className="is-revenue" />Collections</span><span><i className="is-orders" />Orders</span></div>
    <svg aria-label="Collections and orders trend chart" role="img" viewBox="0 0 700 270">
      {[55, 97, 140, 182, 225].map((y) => <line className="manager-report-gridline" key={y} x1="50" x2="650" y1={y} y2={y} />)}
      <polyline className="manager-report-line manager-report-line--revenue" points={points("collections", collectionsMaximum)} />
      <polyline className="manager-report-line manager-report-line--orders" points={points("orders", ordersMaximum)} />
      {values.map((entry, index) => {
        const x = xFor(index);
        const collectionsY = 225 - (Number(entry.collections) / collectionsMaximum) * 170;
        const ordersY = 225 - (entry.orders / ordersMaximum) * 170;
        return <g key={entry.label}>
          <circle className="manager-report-dot manager-report-dot--revenue" cx={x} cy={collectionsY} r="4"><title>{`${entry.label}: ${billingMoney(entry.collections)} collections`}</title></circle>
          <circle className="manager-report-dot manager-report-dot--orders" cx={x} cy={ordersY} r="4"><title>{`${entry.label}: ${entry.orders} orders`}</title></circle>
          {index % labelEvery === 0 || index === values.length - 1 ? <text className="manager-report-axis-label" textAnchor="middle" x={x} y="254">{entry.label}</text> : null}
        </g>;
      })}
    </svg>
  </div>;
}

function CategoryDistribution({ categories }) {
  let offset = 0;
  const stops = categories.map((category, index) => {
    const start = offset;
    offset += category.percentage;
    return `${reportCategoryColors[index % reportCategoryColors.length]} ${start}% ${offset}%`;
  }).join(", ");
  return <div className="manager-report-category">
    <div aria-label={categories.map((category) => `${category.name} ${category.percentage}%`).join(", ")} className="manager-report-donut" role="img" style={{ background: `conic-gradient(${stops})` }}><span><strong>100%</strong><small>sales mix</small></span></div>
    <ul>{categories.map((category, index) => <li key={category.name}><i style={{ background: reportCategoryColors[index % reportCategoryColors.length] }} /><span>{category.name}</span><strong>{category.percentage}%</strong></li>)}</ul>
  </div>;
}

function DailyPerformanceChart({ values }) {
  const collectionsMaximum = Math.max(...values.map((entry) => Number(entry.collections)), 1);
  const ordersMaximum = Math.max(...values.map((entry) => entry.orders), 1);
  return <div className="manager-daily-chart" role="img" aria-label="Period orders and collections bar chart">
    <div className="manager-daily-chart__plot" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(32px, 1fr))`, minWidth: `${Math.max(520, values.length * 46)}px` }}>{values.map((entry) => <div className="manager-daily-chart__day" key={entry.key}>
      <div className="manager-daily-chart__bars"><i className="is-orders" style={{ height: `${Math.max(8, entry.orders / ordersMaximum * 100)}%` }} title={`${entry.orders} orders`} /><i className="is-revenue" style={{ height: `${Math.max(8, Number(entry.collections) / collectionsMaximum * 100)}%` }} title={`${billingMoney(entry.collections)} collections`} /></div>
      <strong>{entry.label}</strong>
    </div>)}</div>
    <div className="manager-report-legend manager-daily-chart__legend"><span><i className="is-orders" />Orders</span><span><i className="is-revenue" />Collections</span></div>
  </div>;
}

function ManagerReportsView() {
  const { signOut, user } = useAuth();
  const [range, setRange] = useState("today");
  const [result, setResult] = useState({ report: null, loading: true, error: "" });
  useEffect(() => {
    if (!user?.hotelId) { setResult({ report: null, loading: false, error: "An authenticated hotel is required." }); return undefined; }
    const controller = new AbortController();
    setResult({ report: null, loading: true, error: "" });
    getManagerReports(user.hotelId, range, { signal: controller.signal })
      .then(report => setResult({ report, loading: false, error: "" }))
      .catch(async error => {
        if (error.name === "AbortError") return;
        if (error.status === 401) { await signOut().catch(() => {}); return; }
        setResult({ report: null, loading: false, error: error.message || "Unable to load report data." });
      });
    return () => controller.abort();
  }, [range, signOut, user?.hotelId]);
  const report = result.report;
  const comparison = value => value == null ? "No prior-period baseline" : `${value > 0 ? "+" : ""}${value}% vs prior period`;
  const topItem = report?.topItems?.[0];
  const summaryCards = [
    { label: "Total Collections", value: billingMoney(report?.summary.collections || 0), comparison: report?.summary.comparisons.collections },
    { label: "Total Orders", value: new Intl.NumberFormat("en-IN").format(report?.summary.orders || 0), comparison: report?.summary.comparisons.orders },
    { label: "Average Bill", value: billingMoney(report?.summary.averageBill || 0), comparison: report?.summary.comparisons.averageBill },
    { label: "Outstanding", value: billingMoney(report?.summary.outstanding || 0), detail: "Non-void bill balances" },
    { label: "Top Item", value: topItem?.name || "No completed sales", detail: `${new Intl.NumberFormat("en-IN").format(topItem?.quantity || 0)} items` },
  ];
  const trendRows = report?.trend.map((entry) => [entry.label, entry.collections, entry.orders]) || [];
  const categoryRows = report?.categories.map((category) => [category.name, category.quantity, category.percentage]) || [];
  const rangeLabel = reportRangeLabels[range];
  const noTrendActivity = !report?.trend.some(entry => Number(entry.collections) > 0 || entry.orders > 0);
  return <div className="manager-reports-page">
    <header className="manager-reports-header">
      <div><h2>Reports &amp; Analytics</h2><Breadcrumb /><p>Sales performance and insights</p></div>
      <div className="manager-reports-controls">
        <label><span className="sr-only">Date range</span><select aria-label="Date range" disabled={result.loading} onChange={(event) => setRange(event.target.value)} value={range}>{Object.entries(reportRangeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
    </header>
    {result.loading ? <LoadingState label="Loading Manager reports" /> : result.error || !report ? <EmptyState description={result.error || "Please try again."} icon={AlertTriangle} title="Unable to load report data" /> : <>
    <section aria-label={`${reportRangeLabels[range]} report summary`} className="manager-report-summary">{summaryCards.map((item) => <Card className="manager-report-summary-card" key={item.label}><CardContent><span>{item.label}</span><strong className={item.label === "Top Item" ? "is-item" : ""}>{item.value}</strong>{item.comparison !== undefined ? <small className={`is-trend ${item.comparison < 0 ? "is-negative" : ""}`}>{comparison(item.comparison)}</small> : <small>{item.detail}</small>}</CardContent></Card>)}</section>
    <section className="manager-report-chart-grid">
      <SectionCard action={<ChartExportMenu chartName="Collections and Orders Trend" onExportCsv={() => downloadChartCsv(`collections-orders-${range}.csv`, ["Bucket", "Collections", "Orders"], trendRows)} onExportPng={() => exportTrendPng(report.trend, rangeLabel, `collections-orders-${range}.png`)} />} className="manager-report-chart-card" title="Collections & Orders Trend">{noTrendActivity ? <EmptyState description="No payments or orders were recorded in this period." icon={BarChart3} title="No report activity" /> : <ReportLineChart values={report.trend} />}</SectionCard>
      <SectionCard action={<ChartExportMenu chartName="Category Distribution" onExportCsv={() => downloadChartCsv(`category-distribution-${range}.csv`, ["Category", "Quantity", "Percentage"], categoryRows)} onExportPng={() => exportCategoryPng(report.categories, rangeLabel, `category-distribution-${range}.png`)} />} className="manager-report-category-card" title="Category Distribution">{report.categories.length ? <CategoryDistribution categories={report.categories} /> : <EmptyState description="Completed categorized order items will appear here." icon={UtensilsCrossed} title="No category sales" />}</SectionCard>
    </section>
    <SectionCard action={<ChartExportMenu chartName="Period Performance" onExportCsv={() => downloadChartCsv(`period-performance-${range}.csv`, ["Bucket", "Collections", "Orders"], trendRows)} onExportPng={() => exportDailyPng(report.trend, rangeLabel, `period-performance-${range}.png`)} />} className="manager-report-daily-card" description={`${rangeLabel} performance by ${report.meta.range === "year" ? "month" : report.meta.range === "today" || report.meta.range === "yesterday" ? "hour" : "day"}`} title="Period Performance">{noTrendActivity ? <EmptyState description="No payments or orders were recorded in this period." icon={BarChart3} title="No report activity" /> : <DailyPerformanceChart values={report.trend} />}</SectionCard>
    </>}
  </div>;
}

export function ManagerDashboard() {
  const { view = "dashboard" } = useParams();
  const { signOut, user } = useAuth();
  const [dashboard, setDashboard] = useState({ data: null, error: "", loading: true });
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (view !== "dashboard") return undefined;
    if (!user?.hotelId) { setDashboard({ data: null, error: "An authenticated hotel is required.", loading: false }); return undefined; }
    const controller = new AbortController();
    setDashboard({ data: null, error: "", loading: true });
    getManagerDashboard(user.hotelId, { signal: controller.signal })
      .then(data => setDashboard({ data, error: "", loading: false }))
      .catch(async error => {
        if (error.name === "AbortError") return;
        if (error.status === 401) { await signOut().catch(() => {}); return; }
        setDashboard({ data: null, error: error.message || "Unable to load dashboard data.", loading: false });
      });
    return () => controller.abort();
  }, [signOut, user?.hotelId, view]);
  const notify = useCallback((message, title = "Saved", variant = "success") => setToast({ message, title, variant }), []);
  const content = useMemo(() => {
    if (view === "dashboard") {
      if (dashboard.loading) return <LoadingState label="Loading Manager dashboard" />;
      if (dashboard.error || !dashboard.data) return <EmptyState description={dashboard.error || "Please try again."} icon={AlertTriangle} title="Unable to load dashboard data" />;
      return <Overview overview={dashboard.data} />;
    }
    if (view === "room-booking") return <BookingView notify={notify} />;
    if (view === "room-orders") return <RoomOrdersView notify={notify} />;
    if (view === "room-billing") return <BillingView />;
    if (view === "menu") return <ManagerMenuView notify={notify} />;
    if (view === "vendors") return <ManagerVendorsView notify={notify} />;
    if (view === "reports") return <ManagerReportsView />;
    if (view === "inventory") return <ManagerInventoryView notify={notify} />;
    return <EmptyState description="This Manager workspace is not available." title="Page not found" />;
  }, [dashboard, notify, view]);
  return <AppShell navigationGroups={navigationGroups} profile={profile} title="Hotel Management System">
    <main className={`manager-workspace ${view === "dashboard" ? "manager-workspace--overview" : ""}`.trim()}>{view === "reports" || view === "inventory" ? null : <WorkspaceHeader timezone={view === "dashboard" ? dashboard.data?.meta?.timezone : null} view={view} />}{content}</main>
    {toast ? <div className="toast-region"><Toast message={toast.message} onDismiss={() => setToast(null)} title={toast.title} variant={toast.variant} /></div> : null}
  </AppShell>;
}
