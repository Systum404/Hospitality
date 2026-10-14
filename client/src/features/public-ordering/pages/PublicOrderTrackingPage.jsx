import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import { OrderTrackingDetails } from "../components/OrderTrackingDetails.jsx";
import { CustomerBillingDocument } from "../components/CustomerBillingDocument.jsx";
import { PublicQrState } from "../components/PublicQrState.jsx";
import { consumeOrderTrackingCapability, shouldPollOrderTracking, trackingStatusAnnouncement } from "../services/orderTracking.js";
import { getPublicOrderBilling, getPublicOrderTracking, getPublicReceiptPdf } from "../services/publicOrderTrackingService.js";
import "../styles/publicQrOrdering.css";

const safeMessage = error => {
  if (error?.code === "INVALID_TRACKING_CAPABILITY") return "This tracking link is invalid.";
  if (error?.code === "TRACKING_NOT_AVAILABLE") return "This order is not available for tracking.";
  if (error?.code === "TRACKING_RATE_LIMITED") return "Too many tracking requests. Please wait a moment and try again.";
  return "Unable to load this order right now. Please try again.";
};

export function PublicOrderTrackingPage() {
  const initial = useRef(null);
  if (!initial.current) initial.current = consumeOrderTrackingCapability();
  const capability = initial.current.capability;
  const [order, setOrder] = useState(null);
  const [billing, setBilling] = useState(null);
  const [billingError, setBillingError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const previousStatus = useRef("");
  const [statusAnnouncement, setStatusAnnouncement] = useState("");
  const [loading, setLoading] = useState(Boolean(capability));
  const [error, setError] = useState(initial.current.malformed || !capability ? "This tracking link is invalid." : "");

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!capability) return;
    if (!quiet) setLoading(true);
    try {
      const [trackingResult, billingResult] = await Promise.allSettled([
        getPublicOrderTracking(capability),
        getPublicOrderBilling(capability),
      ]);
      if (trackingResult.status === "fulfilled") { setOrder(trackingResult.value.order); setError(""); }
      else setError(safeMessage(trackingResult.reason));
      if (billingResult.status === "fulfilled") { setBilling(billingResult.value.billing); setBillingError(""); }
      else setBillingError(billingResult.reason?.message || "Unable to load billing right now.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [capability]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const nextStatus = order?.status || "";
    if (!nextStatus) return;
    const announcement = trackingStatusAnnouncement(previousStatus.current, nextStatus);
    previousStatus.current = nextStatus;
    if (announcement) setStatusAnnouncement(announcement);
  }, [order?.status]);
  useEffect(() => {
    if (!capability || !order || !shouldPollOrderTracking(order.status)) return undefined;
    const timer = setInterval(() => load({ quiet: true }), 15_000);
    return () => clearInterval(timer);
  }, [capability, load, order]);

  const download = async () => {
    if (downloading) return;
    setDownloading(true); setBillingError("");
    try {
      const { blob, filename } = await getPublicReceiptPdf(capability);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = filename; link.click();
      URL.revokeObjectURL(url);
    } catch (requestError) { setBillingError(requestError.message); }
    finally { setDownloading(false); }
  };
  if (loading && !order && !billing) return <main className="public-order-page"><PublicQrState description="Checking the latest order and billing status." loading title="Tracking order" /></main>;
  if (error && !order && !billing?.available) return <main className="public-order-page"><PublicQrState action={capability ? <Button icon={RefreshCw} onClick={() => load()}>Try again</Button> : null} description={error} title="Tracking unavailable" /></main>;
  return <main className="public-order-page public-tracking-page">{order ? <OrderTrackingDetails announcement={statusAnnouncement} order={order} /> : null}{error && billing?.available ? <p className="public-tracking__notice" role="status">Order status is unavailable, but your issued billing document remains accessible.</p> : error ? <p className="public-tracking__notice" role="status">Status refresh failed. The last available update is shown.</p> : null}{billing ? <CustomerBillingDocument billing={billing} downloading={downloading} onDownload={download} /> : null}{billingError ? <p className="public-tracking__notice" role="status">{billingError}</p> : null}<div className="public-tracking__actions"><Button icon={RefreshCw} onClick={() => load()}>Refresh status</Button></div></main>;
}
