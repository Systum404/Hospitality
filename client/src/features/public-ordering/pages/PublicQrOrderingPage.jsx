import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useParams } from "react-router-dom";
import { Button } from "../../../components/ui/Button.jsx";
import { OrderConfirmation } from "../components/OrderConfirmation.jsx";
import { OrderReview } from "../components/OrderReview.jsx";
import { PublicCart } from "../components/PublicCart.jsx";
import { PublicMenu } from "../components/PublicMenu.jsx";
import { PublicQrState } from "../components/PublicQrState.jsx";
import { RoomCapabilityGate } from "../components/RoomCapabilityGate.jsx";
import { TrackingRecoveryNotice } from "../components/TrackingRecoveryNotice.jsx";
import {
  clearPendingOrderRecovery,
  createPendingOrderRecovery,
  readPendingOrderRecovery,
  restorePendingOrderState,
  shouldPreservePendingOrder,
  writePendingOrderRecovery,
} from "../services/publicOrderRecovery.js";
import { getPublicQrMenu, resolvePublicQr, submitPublicQrOrder, verifyRoomCapability } from "../services/publicQrService.js";
import { clearOrderTrackingCapability, generateOrderTrackingCapability, readOrderTrackingCapability, storeOrderTrackingCapability } from "../services/orderTracking.js";
import { nextPublicOrderQuantity, validateTableCustomer } from "../services/publicOrderRules.js";
import "../styles/publicQrOrdering.css";

const emptyCustomer = { customer_name: "", customer_phone: "", customer_email: "" };
const safeMessage = error => {
  if (error?.code === "QR_NOT_AVAILABLE") return "This QR code is unavailable. Please ask hotel staff.";
  if (error?.code === "QR_CONTEXT_UNAVAILABLE") return "Ordering is unavailable for this location. Please ask hotel staff.";
  if (error?.code === "INVALID_ROOM_CAPABILITY") return "Room access code is invalid or no longer available.";
  if (error?.code === "ROOM_ORDERING_UNAVAILABLE") return "Room ordering is closed for this stay. Please contact reception.";
  if (error?.code === "PUBLIC_ORDER_RATE_LIMITED" || error?.code === "QR_RATE_LIMITED") return "Too many requests. Please wait a moment and try again.";
  if (error?.code === "ORDER_KEY_CONFLICT") return "This submission no longer matches the order being retried. Abandon it before starting a new submission.";
  if (error?.code === "PUBLIC_MENU_ITEM_NOT_FOUND") return "The menu changed and one or more selected items are no longer available. Please review your order.";
  return error?.message || "Unable to complete the request. Please try again.";
};

export function RoomQrAccessPage({ capabilityError, context, onDismissRecovery, onVerifyCapability, recoverableTrackingCapability, verifying }) {
  return (
    <main className="public-order-page">
      {recoverableTrackingCapability ? <TrackingRecoveryNotice capability={recoverableTrackingCapability} onDismiss={onDismissRecovery} /> : null}
      {context.ordering.eligible
        ? <RoomCapabilityGate error={capabilityError} hotelName={context.hotel.name} loading={verifying} onSubmit={onVerifyCapability} roomNumber={context.room.number} />
        : <PublicQrState description="Room ordering is not currently available. Please contact reception." title="Ordering unavailable" />}
    </main>
  );
}

export function PublicQrOrderingPage() {
  const { token = "" } = useParams();
  const [context, setContext] = useState(null);
  const [capability, setCapability] = useState("");
  const [capabilityError, setCapabilityError] = useState("");
  const [menu, setMenu] = useState(null);
  const [cart, setCart] = useState([]);
  const [notes, setNotes] = useState("");
  const [customer, setCustomer] = useState(emptyCustomer);
  const [customerErrors, setCustomerErrors] = useState({});
  const [category, setCategory] = useState("all");
  const [menuNotice, setMenuNotice] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [order, setOrder] = useState(null);
  const [orderTrackingCapability, setOrderTrackingCapability] = useState("");
  const [recoverableTrackingCapability, setRecoverableTrackingCapability] = useState(() => readOrderTrackingCapability());
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const customerRef = useRef(null);
  const recoveryAppliedRef = useRef(false);

  const applyPendingRecovery = useCallback((pending) => {
    const restored = restorePendingOrderState(pending);
    setCart(restored.cart);
    setNotes(restored.notes);
    setCustomer(restored.customer);
    setSubmitError({ message: "A previous submission may still be processing. Retry it with the same details, or abandon it before editing.", uncertain: true, conflict: false });
    setReviewing(true);
  }, []);

  const loadMenu = useCallback(async (roomCapability) => {
    const data = await getPublicQrMenu(token, roomCapability);
    setContext(data.context);
    setMenu(data.menu);
    if (!recoveryAppliedRef.current) {
      recoveryAppliedRef.current = true;
      const pending = readPendingOrderRecovery(token);
      if (pending) {
        applyPendingRecovery(pending);
        return;
      }
    }
    setCart(current => {
      const available = new Map(data.menu.items.map(item => [item.id, item]));
      const removed = current.filter(item => !available.has(item.id));
      const changed = current.filter(item => available.has(item.id) && available.get(item.id).price !== item.price);
      if (removed.length || changed.length) setMenuNotice("The menu changed. Unavailable items were removed and current prices are shown. Please review your order again.");
      return current.filter(item => available.has(item.id)).map(item => ({ ...item, ...available.get(item.id) }));
    });
  }, [applyPendingRecovery, token]);

  const resolve = useCallback(async () => {
    setLoading(true); setPageError(null);
    try {
      const data = await resolvePublicQr(token);
      setContext(data);
      if (data.qr.type === "dining_table") await loadMenu();
    } catch (error) { setPageError(safeMessage(error)); }
    finally { setLoading(false); }
  }, [loadMenu, token]);

  useEffect(() => { resolve(); }, [resolve]);

  const verifyCapability = async value => {
    setVerifying(true); setCapabilityError("");
    try {
      await verifyRoomCapability(token, value); await loadMenu(value); setCapability(value);
      const pending = readPendingOrderRecovery(token);
      if (pending) applyPendingRecovery(pending);
    }
    catch (error) { setCapabilityError(safeMessage(error)); }
    finally { setVerifying(false); }
  };

  const add = item => setCart(current => current.some(line => line.id === item.id)
    ? current.map(line => line.id === item.id ? { ...line, quantity: nextPublicOrderQuantity(line.quantity, 1) } : line)
    : [...current, { ...item, quantity: 1, special_instructions: "" }]);
  const quantity = (id, delta) => setCart(current => current.map(item => item.id === id ? { ...item, quantity: nextPublicOrderQuantity(item.quantity, delta) } : item).filter(item => item.quantity > 0));
  const customerChange = event => setCustomer(current => ({ ...current, [event.target.name]: event.target.value }));
  const validateCustomer = () => {
    if (context.qr.type === "room") return true;
    const errors = validateTableCustomer(customer);
    setCustomerErrors(errors);
    if (Object.keys(errors).length) customerRef.current?.focus();
    return !Object.keys(errors).length;
  };
  const openReview = () => { setSubmitError(null); setCustomerErrors({}); setReviewing(true); };
  const abandonPending = () => { clearPendingOrderRecovery(token); setSubmitError(null); setReviewing(false); };

  const submit = async () => {
    if (submitting || !validateCustomer()) return;
    let pending = readPendingOrderRecovery(token);
    if (!pending) {
      const payload = {
        idempotency_key: crypto.randomUUID(),
        items: cart.map(item => ({ menu_item_id: item.id, quantity: item.quantity, special_instructions: item.special_instructions || null })),
        notes: notes || null,
        ...(context.qr.type === "dining_table" ? {
          customer_name: customer.customer_name.trim(), customer_phone: customer.customer_phone.trim(), customer_email: customer.customer_email.trim() || null,
        } : {}),
      };
      pending = createPendingOrderRecovery(payload, cart, generateOrderTrackingCapability());
      writePendingOrderRecovery(token, pending);
    } else if (!pending.tracking_capability) {
      pending = { ...pending, version: 2, tracking_capability: generateOrderTrackingCapability() };
      writePendingOrderRecovery(token, pending);
    }
    setSubmitting(true); setSubmitError(null);
    try {
      const data = await submitPublicQrOrder(token, pending.payload, capability || undefined, pending.tracking_capability);
      storeOrderTrackingCapability(pending.tracking_capability);
      setRecoverableTrackingCapability(pending.tracking_capability);
      clearPendingOrderRecovery(token);
      setCart([]); setOrderTrackingCapability(pending.tracking_capability); setOrder(data.order);
    } catch (error) {
      const uncertain = Boolean(error.uncertain || error.status === 429);
      setSubmitError({ message: safeMessage(error), uncertain, conflict: error.code === "ORDER_KEY_CONFLICT" });
      if (!shouldPreservePendingOrder(error)) clearPendingOrderRecovery(token);
      if (error.code === "INVALID_ROOM_CAPABILITY") { setCapability(""); setMenu(null); setReviewing(false); setCapabilityError(safeMessage(error)); }
      if (error.code === "PUBLIC_MENU_ITEM_NOT_FOUND") { await loadMenu(capability || undefined).catch(() => {}); setReviewing(false); }
    } finally { setSubmitting(false); }
  };

  if (loading) return <main className="public-order-page"><PublicQrState description="Checking this hotel ordering point." loading title="Opening menu" /></main>;
  if (pageError) return <main className="public-order-page"><PublicQrState action={<Button icon={RefreshCw} onClick={resolve}>Try again</Button>} description={pageError} title="Ordering unavailable" /></main>;
  if (context?.qr.type === "room" && (!context.ordering.eligible || !capability)) return <RoomQrAccessPage capabilityError={capabilityError} context={context} onDismissRecovery={() => { clearOrderTrackingCapability(); setRecoverableTrackingCapability(""); }} onVerifyCapability={verifyCapability} recoverableTrackingCapability={recoverableTrackingCapability} verifying={verifying} />;
  if (!menu) return <main className="public-order-page"><PublicQrState description="Please try loading the menu again." title="Menu unavailable" /></main>;
  if (order) return <main className="public-order-page"><OrderConfirmation order={order} timezone={context.hotel.timezone} trackingCapability={orderTrackingCapability} /></main>;
  if (reviewing) return <main className="public-order-page"><OrderReview cart={cart} conflict={submitError?.conflict} context={context} customer={customer} customerErrors={customerErrors} customerRef={customerRef} error={submitError?.message} notes={notes} onAbandon={abandonPending} onBack={() => !submitting && setReviewing(false)} onCustomerChange={customerChange} onSubmit={submit} submitting={submitting} uncertain={submitError?.uncertain} /></main>;
  return <main className="public-order-page public-order-page--menu"><header className="public-order-header"><div><p className="public-order-eyebrow">{context.hotel.name}</p><h1>Order from your {context.qr.type === "room" ? "room" : "table"}</h1><p>{context.qr.type === "room" ? `Room ${context.room.number}` : `${context.dining_area.name} · Table ${context.table.number}`}</p></div></header>{recoverableTrackingCapability ? <TrackingRecoveryNotice capability={recoverableTrackingCapability} onDismiss={() => { clearOrderTrackingCapability(); setRecoverableTrackingCapability(""); }} /> : null}<div className="public-order-layout"><PublicMenu activeCategory={category} categories={menu.categories} items={menu.items} notice={menuNotice} onAdd={add} onCategoryChange={setCategory} /><PublicCart cart={cart} notes={notes} onChangeInstructions={(id, value) => setCart(current => current.map(item => item.id === id ? { ...item, special_instructions: value } : item))} onChangeNotes={setNotes} onQuantity={quantity} onRemove={id => setCart(current => current.filter(item => item.id !== id))} onReview={openReview} /></div></main>;
}
