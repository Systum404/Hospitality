import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleDollarSign, HandCoins, IndianRupee, Printer, ReceiptIndianRupee, Search } from "lucide-react";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Badge } from "../../../components/ui/Badge.jsx";
import { FilterButton } from "../../../components/ui/FilterButton.jsx";
import { PaginatedTableBody } from "../../../components/ui/TablePagination.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent } from "../../../components/ui/Card.jsx";
import { CopyableIdentifier } from "../../../components/ui/CopyableIdentifier.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { Modal } from "../../../components/ui/Modal.jsx";
import { Select } from "../../../components/ui/Select.jsx";
import { SemanticIcon } from "../../../components/ui/SemanticIcon.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { Input } from "../../../components/ui/Input.jsx";
import { getBillingWorkspace, getBill, createRoomBill, finalizeBill, getBillingAdjustments, recalculateBill, recordBillPayment, billingMoney as money } from "../../billing/services/billingService.js";
import { BillingAdjustmentFields, emptyBillingSelection, selectionFromBill } from "../../billing/components/BillingAdjustments.jsx";
import { billingDateTime } from "../../billing/utils/billingLinePresentation.js";
import { BillReceipt } from "../components/BillReceipt.jsx";
import { getRoomBookingWorkspace } from "../services/roomBookingsService.js";
import { receptionNavigationGroups, receptionProfile } from "../receptionConfig.js";

const payable = bill => ["FINALIZED", "PARTIALLY_PAID"].includes(bill.status);
const pending = bill => ["DRAFT", "FINALIZED", "PARTIALLY_PAID"].includes(bill.status);

function BillingMetric({ icon: Icon, label, value }) {
  return <Card className="reception-billing-stat"><CardContent><SemanticIcon icon={Icon} semantic={label} size="lg" /><div><strong>{value}</strong><small>{label}</small></div></CardContent></Card>;
}

export function Billing() {
  const { user, signOut } = useAuth();
  const [bills, setBills] = useState(null);
  const [summary, setSummary] = useState(null);
  const [timezone, setTimezone] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [collection, setCollection] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [generator, setGenerator] = useState(false);
  const [bookings, setBookings] = useState(null);
  const [bookingId, setBookingId] = useState("");
  const [bookingError, setBookingError] = useState("");
  const [adjustments, setAdjustments] = useState(null);
  const [billSelection, setBillSelection] = useState(emptyBillingSelection);
  const submitting = useRef(false);
  const failed = useCallback(error => {
    if (error.status === 401) void signOut().catch(() => {});
    setToast({ title: "Unable to complete request", message: error.message });
  }, [signOut]);
  const reload = useCallback(async signal => {
    const [data, availableAdjustments] = await Promise.all([getBillingWorkspace(user.hotelId, { signal }), getBillingAdjustments(user.hotelId, { signal })]);
    setBills(data.bills); setSummary(data.summary); setTimezone(data.timezone); setAdjustments(availableAdjustments); setLoadError("");
  }, [user?.hotelId]);
  useEffect(() => {
    if (!user?.hotelId) return;
    const controller = new AbortController();
    setBills(null);
    reload(controller.signal).catch(error => {
      if (error.name === "AbortError") return;
      setLoadError(error.message); failed(error);
    });
    return () => controller.abort();
  }, [user?.hotelId, reload, failed]);
  const filteredBills = useMemo(() => (bills || []).filter(bill => {
    const searchable = (bill.invoice_number + " " + bill.guest_snapshot.name + " " + bill.guest_snapshot.room_number).toLowerCase();
    return (status === "all" || (status === "paid" ? bill.status === "PAID" : pending(bill))) && searchable.includes(query.trim().toLowerCase());
  }), [bills, query, status]);
  const openReceipt = async bill => { try { const fresh = await getBill(user.hotelId, bill.id); setReceipt(fresh); setBillSelection(selectionFromBill(fresh)); } catch (error) { failed(error); } };
  const changeCollection = (field, value) => setCollection(current => ({ ...current, [field]: value }));
  const startCollection = bill => {
    setUncertain(false);
    setCollection({ bill, amount: bill.balance_due, method: "", reference: "", idempotency_key: crypto.randomUUID() });
  };
  const refreshSaved = async saved => {
    setBills(current => current?.map(bill => bill.id === saved.id ? saved : bill));
    setReceipt(current => current?.id === saved.id ? saved : current);
    try {
      const fresh = await getBill(user.hotelId, saved.id);
      setReceipt(current => current?.id === saved.id ? fresh : current);
      await reload();
    } catch (error) { setLoadError("Saved, but billing could not be refreshed. Reload before another action."); failed(error); }
  };
  const finalize = async bill => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      const saved = await finalizeBill(user.hotelId, bill.id, billSelection);
      setToast({ title: "Bill finalized", message: saved.invoice_number + " · " + saved.status });
      await refreshSaved(saved);
    } catch (error) { failed(error); }
    finally { submitting.current = false; setBusy(false); }
  };
  const recalculate = async bill => {
    if (submitting.current || bill.status !== "DRAFT") return;
    submitting.current = true; setBusy(true);
    try { const saved = await recalculateBill(user.hotelId, bill.id, billSelection); setBillSelection(selectionFromBill(saved)); await refreshSaved(saved); setToast({ title: "Bill recalculated", message: saved.invoice_number }); }
    catch (error) { failed(error); } finally { submitting.current = false; setBusy(false); }
  };
  const openGenerator = async () => {
    setGenerator(true); setBookings(null); setBookingId(""); setBookingError(""); setBillSelection(emptyBillingSelection);
    try {
      const [workspace] = await Promise.all([getRoomBookingWorkspace(user.hotelId), reload()]);
      setBookings(workspace.room_bookings);
    } catch (error) { setBookingError(error.message); failed(error); }
  };
  const existingBill = (bills || []).find(bill => bill.room_booking_id === bookingId);
  const generate = async () => {
    if (submitting.current || !bookingId || existingBill) return;
    submitting.current = true; setBusy(true);
    try {
      const saved = await createRoomBill(user.hotelId, bookingId, billSelection);
      setGenerator(false); setReceipt(saved);
      setToast({ title: "Bill generated", message: saved.invoice_number });
      await refreshSaved(saved);
    } catch (error) { failed(error); }
    finally { submitting.current = false; setBusy(false); }
  };
  const collect = async () => {
    if (submitting.current || !collection) return;
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(String(collection.amount)) || Number(collection.amount) <= 0) {
      failed(new Error("Enter a positive payment amount with at most two decimal places.")); return;
    }
    submitting.current = true; setBusy(true);
    try {
      const saved = await recordBillPayment(user.hotelId, collection.bill.id, { amount: collection.amount, method: collection.method, reference: collection.reference || null, idempotency_key: collection.idempotency_key });
      setCollection(null); setUncertain(false); setToast({ title: "Payment collected", message: saved.invoice_number + " · " + saved.status });
      await refreshSaved(saved);
    } catch (error) {
      const unknown = !error.status || error.status >= 500;
      setUncertain(current => current || unknown);
      failed(unknown ? new Error("Payment confirmation was not received. Retry the unchanged payment to safely verify the result.") : error);
    }
    finally { submitting.current = false; setBusy(false); }
  };

  return <AppShell navigationGroups={receptionNavigationGroups} profile={receptionProfile} title="Reception Dashboard">
    {loadError ? <main className="reception-billing-page"><EmptyState description={loadError} icon={ReceiptIndianRupee} title="Unable to load billing" /></main> : bills ? <main className="reception-billing-page">
      <header className="reception-billing-header"><div><p className="eyebrow">Reception billing</p><h2>Billing Management</h2><Breadcrumb /><p>Review room bills and manage payment collection.</p></div><div className="reception-billing-header__badges"><Badge variant="warning">{summary.pendingCount} Pending</Badge><Badge variant="success">{summary.paidCount} Paid</Badge></div></header>
      <section aria-label="Billing summary" className="reception-billing-stats"><BillingMetric icon={IndianRupee} label="Total Billed" value={money(summary.total)} /><BillingMetric icon={ReceiptIndianRupee} label="Total Bills" value={summary.count} /><BillingMetric icon={CircleDollarSign} label="Collected" value={money(summary.collected)} /><BillingMetric icon={HandCoins} label="Pending" value={money(summary.pending)} /></section>
      <div className="reception-billing-toolbar"><div className="search-with-filter"><label className="reception-billing-search"><Search aria-hidden="true" size={18} /><input aria-label="Search bills" onChange={(event) => setQuery(event.target.value)} placeholder="Search by bill ID, customer, or room..." value={query} /></label><FilterButton><Select aria-label="Filter bills by status" onChange={(event) => setStatus(event.target.value)} value={status}><option value="all">All Status</option><option value="paid">Paid</option><option value="pending">Pending</option></Select></FilterButton></div><Button disabled={busy} onClick={openGenerator}>Generate Bill</Button></div>
      <Card className="reception-billing-table-card"><CardContent><div className="reception-billing-table-wrap"><table className="reception-billing-table"><thead><tr><th>Bill ID</th><th>Room</th><th>Customer</th><th>Amount</th><th>Time</th><th>Status</th><th>Actions</th></tr></thead><PaginatedTableBody colSpan={7} items={filteredBills}>{(bill) => <tr key={bill.id}><td><strong><CopyableIdentifier label="invoice ID" value={bill.invoice_number} /></strong></td><td><span className="billing-table-chip">{bill.guest_snapshot.room_number}</span></td><td><strong>{bill.guest_snapshot.name}</strong></td><td><b>{money(bill.total_amount)}</b><small>Paid {money(bill.amount_paid)}</small><small>Balance {money(bill.balance_due)}</small></td><td>{billingDateTime(bill.created_at, timezone, { timeOnly: true })}</td><td><Badge variant={bill.status === "PAID" ? "success" : "warning"}>{bill.status}</Badge></td><td><div className="reception-billing-actions"><Button icon={Printer} onClick={() => openReceipt(bill)} size="sm" variant="outline">Print</Button>{payable(bill) ? <Button icon={CircleDollarSign} disabled={busy} onClick={() => startCollection(bill)} size="sm" variant="success">Record Payment</Button> : null}</div></td></tr>}</PaginatedTableBody></table></div>{filteredBills.length === 0 ? <EmptyState description={bills.length ? "No bills match your search or selected status." : "Generated room bills will appear here."} icon={ReceiptIndianRupee} title={bills.length ? "No bills match your search" : "No bills found"} /> : null}</CardContent></Card>
      <Modal actions={<><Button disabled={busy} onClick={() => setReceipt(null)} variant="ghost">Close</Button>{receipt?.status === "DRAFT" ? <><Button disabled={busy} onClick={() => recalculate(receipt)} variant="outline">Recalculate</Button><Button disabled={busy} onClick={() => finalize(receipt)}>{busy ? "Finalizing…" : "Finalize Bill"}</Button></> : payable(receipt || {}) ? <Button disabled={busy} onClick={() => startCollection(receipt)}>Record Payment</Button> : null}<Button icon={Printer} onClick={() => window.print()}>Print Receipt</Button></>} description={receipt ? `${receipt.invoice_number} · ${receipt.guest_snapshot.name}` : ""} isOpen={Boolean(receipt) && !collection} onClose={() => !busy && setReceipt(null)} title="Printable Bill Receipt">{receipt ? <>{receipt.status === "DRAFT" ? <BillingAdjustmentFields disabled={busy} options={adjustments} selection={billSelection} onChange={setBillSelection} /> : null}<BillReceipt bill={receipt} timezone={timezone} /></> : null}</Modal>
      <Modal actions={<><Button disabled={busy || uncertain} onClick={() => setCollection(null)} variant="ghost">Cancel</Button><Button disabled={busy || !collection?.method || !collection?.amount} onClick={collect}>{busy ? "Recording…" : uncertain ? "Retry Payment" : "Record payment"}</Button></>} description={collection ? collection.bill.invoice_number + " · Balance " + money(collection.bill.balance_due) : ""} isOpen={Boolean(collection)} onClose={() => !busy && !uncertain && setCollection(null)} title="Record payment">{collection ? <div className="form-grid">{uncertain ? <p className="form-grid__full" role="alert">Confirmation is uncertain. Retry this unchanged payment before starting another.</p> : null}<Input disabled={busy || uncertain} label="Amount" min="0.01" step="0.01" type="number" value={collection.amount} onChange={event => changeCollection("amount", event.target.value)} /><Select disabled={busy || uncertain} label="Payment method" value={collection.method} onChange={event => changeCollection("method", event.target.value)}><option value="">Select method</option><option value="Cash">Cash</option><option value="UPI">UPI</option><option value="Card">Card</option></Select><Input disabled={busy || uncertain} label="Reference (optional; no card details)" maxLength={255} value={collection.reference} onChange={event => changeCollection("reference", event.target.value)} /></div> : null}</Modal>

      <Modal title="Generate Room Bill" description="Choose a room booking. The backend calculates all charges." isOpen={generator} onClose={() => !busy && setGenerator(false)} actions={<><Button disabled={busy} onClick={() => setGenerator(false)} variant="ghost">Cancel</Button>{existingBill ? <Button onClick={() => { setGenerator(false); void openReceipt(existingBill); }}>Open Bill</Button> : <Button disabled={busy || !bookingId || Boolean(bookingError)} onClick={generate}>{busy ? "Generating…" : "Generate Bill"}</Button>}</>}>
        {bookingError ? <p role="alert">{bookingError}</p> : !bookings ? <LoadingState label="Loading bookings" /> : <div className="form-grid"><Select className="form-grid__full" label="Room booking" disabled={busy} value={bookingId} onChange={event => setBookingId(event.target.value)}><option value="">Select booking</option>{bookings.map(booking => <option key={booking.id} value={booking.id}>Room {booking.room?.room_number || "—"} · {booking.customer_name} · {booking.status}</option>)}</Select><div className="form-grid__full"><BillingAdjustmentFields disabled={busy} options={adjustments} selection={billSelection} onChange={setBillSelection} /></div></div>}
        {existingBill ? <p>Already billed: {existingBill.invoice_number} · {existingBill.status}</p> : null}
      </Modal>
    </main> : <LoadingState label="Loading billing records" />}
      {toast ? <div className="toast-region"><Toast message={toast.message} onDismiss={() => setToast(null)} title={toast.title} /></div> : null}
  </AppShell>;
}
