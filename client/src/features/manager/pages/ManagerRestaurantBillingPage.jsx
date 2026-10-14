import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, ReceiptIndianRupee } from "lucide-react";
import { useLocation } from "react-router-dom";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Badge } from "../../../components/ui/Badge.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";
import { CopyableIdentifier, compactIdentifier } from "../../../components/ui/CopyableIdentifier.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { Input } from "../../../components/ui/Input.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { Modal } from "../../../components/ui/Modal.jsx";
import { PaginatedTableBody } from "../../../components/ui/TablePagination.jsx";
import { Select } from "../../../components/ui/Select.jsx";
import { Textarea } from "../../../components/ui/Textarea.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import {
  billingMoney,
  createRestaurantBill,
  finalizeBill,
  getBillingAdjustments,
  getBill,
  getBills,
  recalculateBill,
  recordBillPayment,
  voidBill,
} from "../../billing/services/billingService.js";
import { BillingAdjustmentFields, BillingAdjustmentSummary, emptyBillingSelection, selectionFromBill } from "../../billing/components/BillingAdjustments.jsx";
import { billingLineAmount } from "../../billing/utils/billingLinePresentation.js";
import { managerNavigationGroups, managerProfile } from "../managerConfig.js";
import { isRestaurantOrderBillable } from "../services/managerRestaurantOrdersFilter.js";
import { getManagerRestaurantOrders } from "../services/managerRestaurantOrdersService.js";

const payableStatuses = ["FINALIZED", "PARTIALLY_PAID"];
const tableLabel = (snapshot) => [snapshot?.dining_area, snapshot?.table_number].filter(Boolean).join(" · ") || "—";
const statusVariants = { DRAFT: "warning", FINALIZED: "info", PARTIALLY_PAID: "warning", PAID: "success", VOID: "neutral" };

export function ManagerRestaurantBillingPage() {
  const { signOut, user } = useAuth();
  const location = useLocation();
  const [bills, setBills] = useState(null);
  const [orders, setOrders] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [detail, setDetail] = useState(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [payment, setPayment] = useState(null);
  const [paymentUncertain, setPaymentUncertain] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [filters, setFilters] = useState({ query: "", status: "all" });
  const [adjustments, setAdjustments] = useState(null);
  const [billSelection, setBillSelection] = useState(emptyBillingSelection);
  const submitting = useRef(false);

  const report = useCallback(async failure => {
    if (failure?.status === 401) await signOut().catch(() => {});
    else setToast({ title: "Unable to complete request", message: failure?.message || "Restaurant billing request failed.", variant: "error" });
  }, [signOut]);

  const load = useCallback(async signal => {
    if (!user?.hotelId) return;
    try {
      const [allBills, restaurantOrders, availableAdjustments] = await Promise.all([
        getBills(user.hotelId, { signal }),
        getManagerRestaurantOrders(user.hotelId, { signal }),
        getBillingAdjustments(user.hotelId, { signal }),
      ]);
      setBills(allBills.filter(bill => bill.type === "CAPTAIN"));
      setOrders(restaurantOrders);
      setAdjustments(availableAdjustments);
      setLoadError("");
    } catch (failure) {
      if (failure.name === "AbortError") return;
      if (failure.status === 401) await signOut().catch(() => {});
      else setLoadError(failure.message || "Restaurant billing could not be loaded.");
    }
  }, [signOut, user?.hotelId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!user?.hotelId || !location.state?.billId) return;
    getBill(user.hotelId, location.state.billId).then(bill => {
      if (bill.type === "CAPTAIN") { setDetail(bill); setBillSelection(selectionFromBill(bill)); }
    }).catch(report);
  }, [location.state?.billId, report, user?.hotelId]);

  const existingByOrder = useMemo(() => new Map((bills || []).map(bill => [bill.order_id, bill])), [bills]);
  const unbilledOrders = useMemo(() => (orders || []).filter(order => isRestaurantOrderBillable(order) && !existingByOrder.has(order.id)), [existingByOrder, orders]);
  const selectedOrder = orders?.find(order => order.id === orderId);
  const visibleBills = useMemo(() => (bills || []).filter(bill => {
    const query = filters.query.trim().toLowerCase();
    const searchable = `${bill.invoice_number} ${bill.source_reference} ${bill.guest_snapshot?.dining_area || ""} ${bill.guest_snapshot?.table_number || ""} ${bill.guest_snapshot?.name || ""}`.toLowerCase();
    return (!query || searchable.includes(query)) && (filters.status === "all" || bill.status === filters.status);
  }), [bills, filters]);

  const openBill = async id => {
    if (!user?.hotelId) return;
    try {
      const bill = await getBill(user.hotelId, id);
      if (bill.type !== "CAPTAIN") throw new Error("This is not a restaurant bill.");
      setDetail(bill);
      setBillSelection(selectionFromBill(bill));
    } catch (failure) { await report(failure); }
  };

  const refresh = async updated => {
    setDetail(updated);
    setBills(current => current?.map(bill => bill.id === updated.id ? updated : bill));
    try {
      const [fresh, allBills] = await Promise.all([getBill(user.hotelId, updated.id), getBills(user.hotelId)]);
      setDetail(fresh);
      setBills(allBills.filter(bill => bill.type === "CAPTAIN"));
    } catch (failure) {
      await report(new Error(`Saved, but refresh failed. Reopen the bill to verify its state. ${failure.message}`));
      if (failure.status === 401) await signOut().catch(() => {});
    }
  };

  const generate = async () => {
    if (!selectedOrder || !user?.hotelId || submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      const created = await createRestaurantBill(user.hotelId, selectedOrder.id, billSelection);
      setSelectorOpen(false); setOrderId(""); setDetail(created);
      setToast({ title: "Restaurant bill generated", message: `${created.invoice_number} was saved.`, variant: "success" });
      await load();
    } catch (failure) {
      await report(failure);
      await load();
    } finally { submitting.current = false; setBusy(false); }
  };

  const recalculate = async () => {
    if (detail?.status !== "DRAFT" || submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      const updated = await recalculateBill(user.hotelId, detail.id, billSelection);
      setBillSelection(selectionFromBill(updated));
      setToast({ title: "Bill recalculated", message: `${updated.invoice_number} was refreshed from the persisted order.`, variant: "success" });
      await refresh(updated);
    } catch (failure) { await report(failure); }
    finally { submitting.current = false; setBusy(false); }
  };

  const finalize = async () => {
    if (detail?.status !== "DRAFT" || submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      const updated = await finalizeBill(user.hotelId, detail.id, billSelection);
      setToast({ title: "Bill finalized", message: `${updated.invoice_number} was finalized.`, variant: "success" });
      await refresh(updated);
    } catch (failure) { await report(failure); }
    finally { submitting.current = false; setBusy(false); }
  };

  const confirmVoid = async () => {
    if (!voiding || submitting.current || !detail) return;
    submitting.current = true; setBusy(true);
    try {
      const updated = await voidBill(user.hotelId, detail.id);
      setVoiding(false);
      setToast({ title: "Bill voided", message: `${updated.invoice_number} was voided.`, variant: "success" });
      await refresh(updated);
    } catch (failure) { await report(failure); }
    finally { submitting.current = false; setBusy(false); }
  };

  const startPayment = () => {
    setPaymentUncertain(false);
    setPayment({ amount: detail.balance_due, method: "Cash", reference: "", notes: "", idempotency_key: crypto.randomUUID() });
  };

  const pay = async () => {
    if (!payment || submitting.current) return;
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(payment.amount) || Number(payment.amount) <= 0) {
      await report(new Error("Enter a positive payment amount with at most two decimal places.")); return;
    }
    submitting.current = true; setBusy(true);
    try {
      const updated = await recordBillPayment(user.hotelId, detail.id, payment);
      setPayment(null); setPaymentUncertain(false);
      setToast({ title: "Payment recorded", message: `${updated.invoice_number} was updated.`, variant: "success" });
      await refresh(updated);
    } catch (failure) {
      const uncertain = !failure.status || failure.status >= 500;
      setPaymentUncertain(uncertain || paymentUncertain);
      await report(uncertain ? new Error("Payment confirmation was not received. Retry this unchanged payment to safely verify the result.") : failure);
    } finally { submitting.current = false; setBusy(false); }
  };

  const canVoid = detail && ["DRAFT", "FINALIZED"].includes(detail.status) && !detail.payments?.length;

  return <AppShell navigationGroups={managerNavigationGroups} profile={managerProfile} title="Hotel Management System">
    <main className="manager-workspace">
      <section className="manager-heading"><div><h2>Restaurant Billing</h2><Breadcrumb /></div></section>
      <div className="manager-restaurant-billing-controls">
        <Input className="manager-restaurant-billing-controls__search" aria-label="Search restaurant bills" onChange={event => setFilters(current => ({ ...current, query: event.target.value }))} placeholder="Search invoice, order, table, or customer..." value={filters.query} />
        <div className="manager-toolbar__actions">
          <Select className="manager-restaurant-billing-controls__status" aria-label="Filter restaurant bills by status" onChange={event => setFilters(current => ({ ...current, status: event.target.value }))} value={filters.status}><option value="all">All statuses</option><option value="DRAFT">Draft</option><option value="FINALIZED">Finalized</option><option value="PARTIALLY_PAID">Partially paid</option><option value="PAID">Paid</option><option value="VOID">Void</option></Select>
          <Button disabled={busy || !user?.hotelId} icon={Plus} onClick={() => { setOrderId(""); setBillSelection(emptyBillingSelection); setSelectorOpen(true); }}>Generate Bill</Button>
        </div>
      </div>
      <Card className="manager-restaurant-orders-card">
        <CardHeader><div><CardTitle>Restaurant Bills</CardTitle><CardDescription>Captain and Table QR billing for this hotel.</CardDescription></div></CardHeader>
        <CardContent>
          {loadError ? <EmptyState description={loadError} icon={ReceiptIndianRupee} title="Unable to load restaurant billing" />
            : bills === null ? <LoadingState label="Loading restaurant bills" />
              : visibleBills.length ? <div className="manager-table-wrap"><table className="manager-table"><thead><tr><th>Invoice</th><th>Order</th><th>Table</th><th>Customer</th><th>Subtotal</th><th>Tax</th><th>Discount</th><th>Total</th><th>Paid / Balance</th><th>Status</th><th>Created</th></tr></thead><PaginatedTableBody colSpan={11} items={visibleBills}>{bill => <tr key={bill.id}><td><span className="identifier-with-action"><CopyableIdentifier label="invoice ID" value={bill.invoice_number} /><Button aria-label={`Open ${bill.invoice_number}`} onClick={() => openBill(bill.id)} size="sm" variant="ghost">View</Button></span></td><td><CopyableIdentifier label="order ID" value={bill.source_reference} /></td><td>{tableLabel(bill.guest_snapshot)}</td><td>{bill.guest_snapshot?.name || "Guest"}</td><td>{billingMoney(bill.subtotal)}</td><td>{billingMoney(bill.tax_amount)}</td><td>{billingMoney(bill.discount_amount)}</td><td><strong>{billingMoney(bill.total_amount)}</strong></td><td><small>Paid {billingMoney(bill.amount_paid)}</small><small>Balance {billingMoney(bill.balance_due)}</small></td><td><Badge variant={statusVariants[bill.status] || "neutral"}>{bill.status}</Badge></td><td>{new Date(bill.created_at).toLocaleString()}</td></tr>}</PaginatedTableBody></table></div>
                : <EmptyState description={bills.length ? "No restaurant bills match the selected filters." : "Generated restaurant bills will appear here."} icon={ReceiptIndianRupee} title={bills.length ? "No matching restaurant bills" : "No restaurant bills yet"} />}
        </CardContent>
      </Card>
    </main>

    <Modal className="room-bill-selector-modal" title="Generate Restaurant Bill" description="Choose a restaurant order. The backend calculates all charges." isOpen={selectorOpen} onClose={() => !busy && setSelectorOpen(false)} actions={<><Button disabled={busy} onClick={() => setSelectorOpen(false)} variant="ghost">Cancel</Button><Button disabled={busy || !selectedOrder} onClick={generate}>{busy ? "Generating…" : "Generate Bill"}</Button></>}>
      {orders === null ? <LoadingState label="Loading restaurant orders" /> : unbilledOrders.length ? <div className="form-grid"><Select className="form-grid__full" disabled={busy} label="Restaurant order" onChange={event => setOrderId(event.target.value)} value={orderId}><option value="">Select an order</option>{unbilledOrders.map(order => <option key={order.id} value={order.id}>{compactIdentifier(order.order_number)} · {[order.dining_table?.dining_area?.name, order.dining_table?.table_number].filter(Boolean).join(" · ") || "—"} · {order.customer_name} · {order.status}</option>)}</Select><div className="form-grid__full"><BillingAdjustmentFields disabled={busy} options={adjustments} selection={billSelection} onChange={setBillSelection} /></div>{selectedOrder ? <div className="form-grid__full"><p>Order: <CopyableIdentifier label="order ID" value={selectedOrder.order_number} /></p><p>Table: {[selectedOrder.dining_table?.dining_area?.name, selectedOrder.dining_table?.table_number].filter(Boolean).join(" · ") || "—"} · Customer: {selectedOrder.customer_name}</p><p>Total snapshot source: {billingMoney(selectedOrder.total_amount)}</p><p>The server will validate and calculate the draft bill.</p></div> : null}</div> : <EmptyState description="Every restaurant order currently has a bill." icon={ReceiptIndianRupee} title="No unbilled restaurant orders" />}
    </Modal>

    <Modal className="room-bill-preview-modal" title={detail?.invoice_number || "Restaurant Bill"} description={detail ? `Order ${detail.source_reference} · ${tableLabel(detail.guest_snapshot)} · ${detail.guest_snapshot?.name || "Guest"} · ${detail.status}` : ""} isOpen={Boolean(detail) && !payment && !voiding} onClose={() => !busy && setDetail(null)} actions={<><Button disabled={busy} onClick={() => setDetail(null)} variant="ghost">Close</Button>{detail?.status === "DRAFT" ? <Button disabled={busy} onClick={recalculate} variant="outline">Recalculate</Button> : null}{canVoid ? <Button disabled={busy} onClick={() => setVoiding(true)} variant="danger">Void Bill</Button> : null}{detail?.status === "DRAFT" ? <Button disabled={busy} onClick={finalize}>{busy ? "Finalizing…" : "Finalize Bill"}</Button> : payableStatuses.includes(detail?.status) ? <Button disabled={busy} onClick={startPayment}>Record Payment</Button> : null}</>}>
      {detail ? <>{detail.status === "DRAFT" ? <BillingAdjustmentFields disabled={busy} options={adjustments} selection={billSelection} onChange={setBillSelection} /> : null}<div className="room-bill-preview__items"><table><thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody>{detail.items.map(item => <tr key={item.id}><td>{item.description}</td><td>{item.quantity}</td><td>{billingMoney(item.unit_price)}</td><td>{billingMoney(billingLineAmount(item))}</td></tr>)}</tbody></table>{detail.payments?.length ? <section className="room-bill-preview__history" aria-label="Payment history"><strong>Payment history</strong><table><thead><tr><th>Date</th><th>Method</th><th>Amount</th><th>Reference</th></tr></thead><tbody>{detail.payments.map(entry => <tr key={entry.id}><td>{new Date(entry.created_at).toLocaleString()}</td><td>{entry.method}</td><td>{billingMoney(entry.amount)}</td><td>{entry.reference || "—"}</td></tr>)}</tbody></table></section> : null}</div><dl className="room-bill-preview__totals"><dt>Subtotal</dt><dd>{billingMoney(detail.subtotal)}</dd><BillingAdjustmentSummary bill={detail} money={billingMoney} /><dt className="room-bill-preview__total">Total</dt><dd className="room-bill-preview__total">{billingMoney(detail.total_amount)}</dd><dt>Paid</dt><dd>{billingMoney(detail.amount_paid)}</dd><dt>Balance</dt><dd>{billingMoney(detail.balance_due)}</dd></dl></> : null}
    </Modal>

    <Modal title="Void Restaurant Bill" description={detail?.invoice_number || ""} isOpen={voiding} onClose={() => !busy && setVoiding(false)} actions={<><Button disabled={busy} onClick={() => setVoiding(false)} variant="ghost">Cancel</Button><Button disabled={busy} onClick={confirmVoid} variant="danger">{busy ? "Voiding…" : "Void Bill"}</Button></>}><p className="modal-copy">Void this unpaid bill? Financial history will be preserved and the bill cannot be recreated for this order.</p></Modal>

    <Modal className="room-bill-selector-modal" title="Record Restaurant Payment" description={detail?.invoice_number || ""} isOpen={Boolean(payment)} onClose={() => !busy && !paymentUncertain && setPayment(null)} actions={<><Button disabled={busy || paymentUncertain} onClick={() => setPayment(null)} variant="ghost">Cancel</Button><Button disabled={busy} onClick={pay}>{busy ? "Recording…" : paymentUncertain ? "Retry Payment" : "Record Payment"}</Button></>}>
      {payment ? <div className="form-grid">{paymentUncertain ? <p className="form-grid__full" role="alert">Confirmation is uncertain. Retry the unchanged payment before starting another payment.</p> : null}<Input disabled={busy || paymentUncertain} inputMode="decimal" label="Amount" onChange={event => setPayment(current => ({ ...current, amount: event.target.value }))} value={payment.amount} /><Select disabled={busy || paymentUncertain} label="Payment Method" onChange={event => setPayment(current => ({ ...current, method: event.target.value }))} value={payment.method}><option value="Cash">Cash</option><option value="UPI">UPI</option><option value="Card">Card</option></Select><Input className="form-grid__full" disabled={busy || paymentUncertain} label="Reference / Transaction ID" maxLength={255} onChange={event => setPayment(current => ({ ...current, reference: event.target.value }))} value={payment.reference} /><Textarea className="form-grid__full" disabled={busy || paymentUncertain} label="Notes" maxLength={2000} onChange={event => setPayment(current => ({ ...current, notes: event.target.value }))} value={payment.notes} /></div> : null}
    </Modal>
    {toast ? <div className="toast-region"><Toast message={toast.message} onDismiss={() => setToast(null)} title={toast.title} variant={toast.variant} /></div> : null}
  </AppShell>;
}
