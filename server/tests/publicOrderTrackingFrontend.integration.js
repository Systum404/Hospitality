import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  ORDER_STATUS_PRESENTATION,
  ORDER_TRACKING_CAPABILITY_PATTERN,
  clearOrderTrackingCapability,
  copyTrackingLink,
  consumeOrderTrackingCapability,
  formatPublicOrderTimestamp,
  generateOrderTrackingCapability,
  orderTrackingStorageKey,
  readOrderTrackingCapability,
  shouldPollOrderTracking,
  storeOrderTrackingCapability,
  trackingStatusAnnouncement,
  trackingLink,
} from "../../client/src/features/public-ordering/services/orderTracking.js";
import { createPendingOrderRecovery, readPendingOrderRecovery, writePendingOrderRecovery } from "../../client/src/features/public-ordering/services/publicOrderRecovery.js";
import { nextPublicOrderQuantity, PUBLIC_ORDER_MAX_QUANTITY, validateTableCustomer } from "../../client/src/features/public-ordering/services/publicOrderRules.js";

const requireFromClient = createRequire(new URL("../../client/package.json", import.meta.url));
const React = requireFromClient("react");
const { renderToStaticMarkup } = requireFromClient("react-dom/server");
const { MemoryRouter } = requireFromClient("react-router-dom");
const { createServer } = await import(pathToFileURL(requireFromClient.resolve("vite")).href);

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const deterministicCrypto = { getRandomValues(bytes) { for (let index = 0; index < bytes.length; index++) bytes[index] = index; return bytes; } };
const capability = generateOrderTrackingCapability(deterministicCrypto);
check(ORDER_TRACKING_CAPABILITY_PATTERN.test(capability) && capability.length === 43, "Web Crypto helper produces a 256-bit base64url tracking capability");

const link = trackingLink(capability, "https://hotel.example");
check(link === `https://hotel.example/order-tracking#${capability}` && !link.includes("?") && !link.includes("%3F"), "tracking link keeps the capability only in the URL fragment");

const storage = new MemoryStorage();
const replacements = [];
const consumed = consumeOrderTrackingCapability({
  location: { hash: `#${capability}`, pathname: "/order-tracking", search: "" },
  history: { replaceState(_state, _title, value) { replacements.push(value); } },
  storage,
});
check(consumed.capability === capability && !consumed.malformed, "tracking page consumes a valid fragment capability");
check(replacements[0] === "/order-tracking" && storage.getItem(orderTrackingStorageKey) === capability, "tracking fragment is removed from the visible URL and retained in session recovery");
check(readOrderTrackingCapability(storage) === capability, "tracking capability survives page refresh through session recovery");
const malformed = consumeOrderTrackingCapability({ location: { hash: "#bad", pathname: "/order-tracking", search: "" }, history: { replaceState() {} }, storage });
check(malformed.malformed && malformed.capability === "", "malformed tracking fragment is rejected safely");

for (const [status, label] of [["pending", "Order received"], ["preparing", "Preparing"], ["ready", "Ready"], ["completed", "Completed"]]) {
  check(ORDER_STATUS_PRESENTATION[status].label === label, `customer status label for ${status} is stable`);
}
check(shouldPollOrderTracking("pending") && shouldPollOrderTracking("preparing") && shouldPollOrderTracking("ready") && !shouldPollOrderTracking("completed"), "polling stops only at completed");
check(nextPublicOrderQuantity(99, 1) === 100 && nextPublicOrderQuantity(100, 1) === 100, "customer quantity reaches but cannot exceed the backend maximum");
check(nextPublicOrderQuantity(2, -1) === 1 && nextPublicOrderQuantity(1, -1) === 0 && PUBLIC_ORDER_MAX_QUANTITY === 100, "normal decrement and remove-at-zero behavior remain unchanged");
check(Object.keys(validateTableCustomer({ customer_name: "", customer_phone: "", customer_email: "" })).sort().join(",") === "customer_name,customer_phone", "table customer validation still requires name and phone");
check(validateTableCustomer({ customer_name: "Guest", customer_phone: "123", customer_email: "guest@example.invalid" }).customer_email === undefined && validateTableCustomer({ customer_name: "Guest", customer_phone: "123", customer_email: "bad" }).customer_email, "table customer validation preserves the established optional email rule");
check(trackingStatusAnnouncement("pending", "preparing") === "Order status changed to Preparing." && trackingStatusAnnouncement("preparing", "ready") === "Order status changed to Ready." && trackingStatusAnnouncement("ready", "completed") === "Order status changed to Completed.", "tracking lifecycle changes produce customer-facing announcements");
check(trackingStatusAnnouncement("ready", "ready") === "" && trackingStatusAnnouncement("", "pending") === "", "initial and unchanged tracking states are not repeatedly announced");
check(formatPublicOrderTimestamp("2026-09-26T12:00:00.000Z", "Asia/Kolkata").includes("5:30") || formatPublicOrderTimestamp("2026-09-26T12:00:00.000Z", "Asia/Kolkata").includes("5:30 pm"), "customer timestamps use the supplied hotel IANA timezone");

let copiedValue = "";
const copied = await copyTrackingLink(link, { async writeText(value) { copiedValue = value; } });
check(copied.ok && copied.message === "Link copied" && copiedValue === link, "tracking-link clipboard success preserves the complete fragment link");
const copyFailure = await copyTrackingLink(link, { async writeText() { throw new Error("denied"); } });
check(!copyFailure.ok && copyFailure.message === "Copy unavailable. Use Track Order instead." && !copyFailure.message.includes(capability), "clipboard failure returns safe customer-visible feedback without exposing the capability");

const recoveryStorage = new MemoryStorage();
storeOrderTrackingCapability(capability, recoveryStorage);
check(readOrderTrackingCapability(recoveryStorage) === capability, "successful order tracking recovery remains session-scoped");
clearOrderTrackingCapability(recoveryStorage);
check(readOrderTrackingCapability(recoveryStorage) === "", "dismissed tracking recovery clears the current-session capability");
check(readOrderTrackingCapability(new MemoryStorage()) === "", "a different browser session cannot automatically access tracking recovery");

const payload = { idempotency_key: "11111111-1111-4111-8111-111111111111", items: [{ menu_item_id: "22222222-2222-4222-8222-222222222222", quantity: 1 }] };
const cart = [{ id: payload.items[0].menu_item_id, name: "Meal", price: "10.00", quantity: 1 }];
const pendingStorage = new MemoryStorage();
writePendingOrderRecovery("qr-token", createPendingOrderRecovery(payload, cart, capability), pendingStorage);
check(readPendingOrderRecovery("qr-token", pendingStorage).tracking_capability === capability, "uncertain submission recovery preserves the same tracking capability");

const vite = await createServer({ root: path.resolve("client"), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
const savedComponentWindow = globalThis.window;
if (savedComponentWindow === undefined) globalThis.window = { location: { protocol: "http:", hostname: "localhost" } };
try {
  const { OrderTrackingDetails } = await vite.ssrLoadModule("/src/features/public-ordering/components/OrderTrackingDetails.jsx");
  const { CustomerBillingDocument } = await vite.ssrLoadModule("/src/features/public-ordering/components/CustomerBillingDocument.jsx");
  const { OrderConfirmation } = await vite.ssrLoadModule("/src/features/public-ordering/components/OrderConfirmation.jsx");
  const { OrderReview } = await vite.ssrLoadModule("/src/features/public-ordering/components/OrderReview.jsx");
  const { TrackingRecoveryNotice } = await vite.ssrLoadModule("/src/features/public-ordering/components/TrackingRecoveryNotice.jsx");
  const { RoomQrAccessPage } = await vite.ssrLoadModule("/src/features/public-ordering/pages/PublicQrOrderingPage.jsx");
  const order = {
    order_number: "ORD-11111111-1111-4111-8111-111111111111",
    hotel: { name: "Tracking Hotel", timezone: "Asia/Kolkata" }, context: { type: "dining_table", label: "Terrace · Table 4" },
    items: [{ name: "Meal", quantity: 2, special_instructions: "No onion" }], notes: "Window table",
    created_at: "2026-09-26T12:00:00.000Z", completed_at: "2026-09-26T12:30:00.000Z",
  };
  for (const [status, label] of [["pending", "Order received"], ["preparing", "Preparing"], ["ready", "Ready"], ["completed", "Completed"]]) {
    const announcement = status === "pending" ? "" : `Order status changed to ${label}.`;
    const markup = renderToStaticMarkup(React.createElement(OrderTrackingDetails, { announcement, order: { ...order, status, completed_at: status === "completed" ? order.completed_at : null } }));
    check(markup.includes(`<h1 id="order-tracking-title">${label}</h1>`) && markup.includes(`>${label}</span>`), `tracking component actually renders ${label} for ${status}`);
    check(!markup.includes(capability), `tracking component does not render the raw capability for ${status}`);
    check(markup.includes('aria-live="polite"') && markup.includes(announcement), `tracking component exposes the ${status} lifecycle announcement through a polite live region`);
  }

  const confirmationOrder = {
    order_number: order.order_number, status: "pending", target: { type: "dining_table", dining_area: "Terrace", table_number: "4" },
    items: [{ item_name: "Meal", quantity: 2, unit_price: "10.00", subtotal: "20.00", special_instructions: null }],
    subtotal: "20.00", tax_amount: "0.00", discount_amount: "0.00", total_amount: "20.00", notes: null, created_at: order.created_at,
  };
  const confirmationMarkup = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(OrderConfirmation, { order: confirmationOrder, timezone: "Asia/Kolkata", trackingCapability: capability })));
  const visibleConfirmationText = confirmationMarkup.replace(/<[^>]*>/g, "");
  check(confirmationMarkup.includes(`href="/order-tracking#${capability}"`) && visibleConfirmationText.includes("Track Order"), "rendered confirmation contains the fragment-only Track Order action");
  check(visibleConfirmationText.includes("Copy tracking link") && !visibleConfirmationText.includes(capability), "rendered confirmation offers copy-link without visibly exposing the raw capability");
  check(visibleConfirmationText.includes("5:30") && !visibleConfirmationText.includes("12:00"), "rendered confirmation presents its timestamp in the hotel timezone");

  const reviewMarkup = renderToStaticMarkup(React.createElement(OrderReview, {
    cart, conflict: false, context: { hotel: { name: "Tracking Hotel" }, qr: { type: "dining_table" }, dining_area: { name: "Terrace" }, table: { number: "4" } },
    customer: { customer_name: "Guest", customer_phone: "123", customer_email: "" }, customerErrors: {}, customerRef: { current: null },
    error: "", notes: "", onAbandon() {}, onBack() {}, onCustomerChange() {}, onSubmit() {}, submitting: false, uncertain: false,
  }));
  check(reviewMarkup.startsWith('<form aria-labelledby="order-review-title"') && reviewMarkup.includes('type="submit"'), "review uses one native form and one submit path for button or Enter submission");
  const submittingReviewMarkup = renderToStaticMarkup(React.createElement(OrderReview, {
    cart, conflict: false, context: { hotel: { name: "Tracking Hotel" }, qr: { type: "dining_table" }, dining_area: { name: "Terrace" }, table: { number: "4" } },
    customer: { customer_name: "Guest", customer_phone: "123", customer_email: "" }, customerErrors: {}, customerRef: { current: null },
    error: "", notes: "", onAbandon() {}, onBack() {}, onCustomerChange() {}, onSubmit() {}, submitting: true, uncertain: false,
  }));
  check(submittingReviewMarkup.includes('disabled=""') && submittingReviewMarkup.includes("Submitting…"), "submitting review disables its single submit control to prevent duplicate submission");

  const recoveryMarkup = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(TrackingRecoveryNotice, { capability, onDismiss() {} })));
  const visibleRecoveryText = recoveryMarkup.replace(/<[^>]*>/g, "");
  check(recoveryMarkup.includes(`href="/order-tracking#${capability}"`) && visibleRecoveryText.includes("Continue tracking"), "session recovery renders a capability-authorized continuation to tracking");
  check(!visibleRecoveryText.includes(capability) && !visibleRecoveryText.includes(order.order_number), "tracking recovery exposes neither the raw capability nor order data as visible text");

  const roomContext = { hotel: { name: "Tracking Hotel" }, ordering: { eligible: true }, qr: { type: "room" }, room: { number: "204" } };
  const roomRecoveryMarkup = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(RoomQrAccessPage, {
    capabilityError: "", context: roomContext, onDismissRecovery() {}, onVerifyCapability() {}, recoverableTrackingCapability: capability, verifying: false,
  })));
  const visibleRoomRecoveryText = roomRecoveryMarkup.replace(/<[^>]*>/g, "");
  check(roomRecoveryMarkup.includes(`href="/order-tracking#${capability}"`) && visibleRoomRecoveryText.includes("Continue tracking"), "room QR recovery remains reachable without a room capability after refresh");
  check(roomRecoveryMarkup.includes('id="room-capability"') && visibleRoomRecoveryText.includes("Enter the room access code"), "room recovery does not bypass the existing capability gate for new ordering");
  check(!visibleRoomRecoveryText.includes(capability) && !roomRecoveryMarkup.includes('value="' + capability + '"'), "room recovery exposes neither tracking nor room capabilities as visible or form data");

  const roomNoRecoveryMarkup = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(RoomQrAccessPage, {
    capabilityError: "", context: roomContext, onDismissRecovery() {}, onVerifyCapability() {}, recoverableTrackingCapability: "", verifying: false,
  })));
  check(!roomNoRecoveryMarkup.includes("Continue tracking") && roomNoRecoveryMarkup.includes('id="room-capability"'), "room QR without recovery retains the normal capability-gate behavior");

  const unavailableRoomMarkup = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(RoomQrAccessPage, {
    capabilityError: "", context: { ...roomContext, ordering: { eligible: false } }, onDismissRecovery() {}, onVerifyCapability() {}, recoverableTrackingCapability: capability, verifying: false,
  })));
  check(unavailableRoomMarkup.includes("Continue tracking") && unavailableRoomMarkup.includes("Ordering unavailable") && !unavailableRoomMarkup.includes('id="room-capability"'), "existing tracking remains reachable after room ordering becomes unavailable without opening a new ordering path");

  const customerInvoice = {
    available: true, document_type: "invoice", invoice_number: "INV-000000000999", bill_type: "ROOM", status: "PARTIALLY_PAID",
    issued_at: "2026-09-26T12:00:00.000Z", hotel: { name: "Tracking Hotel", address: "1 Safe Street", timezone: "Asia/Kolkata" },
    context: { type: "room", room_number: "204", booking_from: "2026-09-25", booking_to: "2026-09-27" },
    items: [{ description: "Meal", quantity: 1, unit_price: "499.00", subtotal: "499.00", discount_amount: "0.00", tax_amount: "49.90", total_amount: "548.90" }],
    subtotal: "499.00", discount_amount: "0.00", taxable_subtotal: "499.00", tax_amount: "49.90", total_amount: "548.90",
    amount_paid: "500.00", balance_due: "48.90", payment_status: "PARTIALLY_PAID", tax: { name: "GST", rate: "10.00", amount: "49.90" }, discount: null,
    payments: [{ amount: "500.00", method: "UPI", status: "RECORDED", recorded_at: "2026-09-26T12:30:00.000Z" }],
  };
  const invoiceMarkup = renderToStaticMarkup(React.createElement(CustomerBillingDocument, { billing: customerInvoice, onDownload() {} }));
  const invoiceText = invoiceMarkup.replace(/<[^>]*>/g, "");
  check(invoiceText.includes("Customer invoice") && invoiceText.includes("INV-000000000999") && invoiceText.includes("₹499.00") && invoiceText.includes("₹49.90") && invoiceText.includes("₹548.90"), "customer invoice renders persisted pre-tax line, tax, and total values");
  check(invoiceText.includes("PARTIALLY PAID") && invoiceText.includes("₹500.00") && invoiceText.includes("₹48.90") && invoiceText.includes("UPI"), "partial-payment invoice renders approved payment and balance information");
  check(invoiceText.includes("Print Invoice") && !invoiceText.includes("Download PDF"), "finalized or partially paid customer invoice is printable but not presented as a receipt download");
  const receiptMarkup = renderToStaticMarkup(React.createElement(CustomerBillingDocument, { billing: { ...customerInvoice, document_type: "receipt", status: "PAID", payment_status: "PAID", amount_paid: "548.90", balance_due: "0.00" }, onDownload() {} }));
  check(receiptMarkup.includes("Customer receipt") && receiptMarkup.includes("Print Receipt") && receiptMarkup.includes("Download PDF"), "paid customer bill renders receipt print and PDF actions");
  const unavailableBillingMarkup = renderToStaticMarkup(React.createElement(CustomerBillingDocument, { billing: { available: false } }));
  check(unavailableBillingMarkup.includes("Bill not available yet") && !unavailableBillingMarkup.includes("INV-"), "unavailable customer billing state reveals no draft invoice data");

  const savedWindow = globalThis.window;
  const savedFetch = globalThis.fetch;
  globalThis.window = { location: { protocol: "http:", hostname: "localhost" } };
  let observedRequest;
  globalThis.fetch = async (url, options) => {
    observedRequest = { url, options };
    return { ok: true, async json() { return { status: "success", data: { order } }; } };
  };
  try {
    const { getPublicOrderBilling, getPublicOrderTracking, getPublicReceiptPdf } = await vite.ssrLoadModule("/src/features/public-ordering/services/publicOrderTrackingService.js");
    const response = await getPublicOrderTracking(capability);
    check(response.order === order, "tracking service returns the successful customer projection");
    check(observedRequest.options.headers["X-Order-Tracking-Capability"] === capability && observedRequest.options.credentials === "omit", "tracking service actually sends the raw capability only in the dedicated header");
    check(new URL(observedRequest.url).pathname === "/api/public/order-tracking" && !observedRequest.url.includes(capability) && !new URL(observedRequest.url).search, "tracking service request contains no capability in its path or query string");
    globalThis.fetch = async (url, options) => {
      observedRequest = { url, options };
      return { ok: true, async json() { return { status: "success", data: { billing: customerInvoice } }; } };
    };
    check((await getPublicOrderBilling(capability)).billing === customerInvoice, "customer billing service returns only the public projection envelope");
    check(observedRequest.options.headers["X-Order-Tracking-Capability"] === capability && observedRequest.options.credentials === "omit", "customer billing sends the capability only in the established header and omits credentials");
    check(new URL(observedRequest.url).pathname === "/api/public/order-billing" && !observedRequest.url.includes(capability) && !new URL(observedRequest.url).search, "customer billing URL contains no capability or substitutable identifier");
    globalThis.fetch = async (url, options) => {
      observedRequest = { url, options };
      return { ok: true, headers: { get() { return 'attachment; filename="INV-000000000999-receipt.pdf"'; } }, async blob() { return new Blob(["%PDF-"]); } };
    };
    const pdfDownload = await getPublicReceiptPdf(capability);
    check(pdfDownload.filename === "INV-000000000999-receipt.pdf" && observedRequest.options.headers["X-Order-Tracking-Capability"] === capability, "PDF download preserves secure header authorization and server filename");
    check(new URL(observedRequest.url).pathname === "/api/public/order-billing/pdf" && !observedRequest.url.includes(capability), "PDF URL exposes no tracking capability");
  } finally {
    globalThis.fetch = savedFetch;
    if (savedWindow === undefined) delete globalThis.window;
    else globalThis.window = savedWindow;
  }

  const pageSource = await readFile(new URL("../../client/src/features/public-ordering/pages/PublicOrderTrackingPage.jsx", import.meta.url), "utf8");
  check(pageSource.includes("15_000") && pageSource.includes("shouldPollOrderTracking"), "15-second interval wiring remains source-verified while terminal polling behavior is exercised through the helper");
  const orderingPageSource = await readFile(new URL("../../client/src/features/public-ordering/pages/PublicQrOrderingPage.jsx", import.meta.url), "utf8");
  check((orderingPageSource.match(/nextPublicOrderQuantity\(/gu) || []).length >= 2, "both menu Add and cart increment paths enforce the shared quantity maximum");
  check(orderingPageSource.includes('context?.qr.type === "room" && (!context.ordering.eligible || !capability)') && !orderingPageSource.includes("storeRoomCapability"), "room entry branching remains capability-protected and introduces no room-capability persistence");
} finally {
  await vite.close();
  if (savedComponentWindow === undefined) delete globalThis.window;
  else globalThis.window = savedComponentWindow;
}

console.log(`Public order tracking frontend integration: ${checks}/${checks} passed`);
