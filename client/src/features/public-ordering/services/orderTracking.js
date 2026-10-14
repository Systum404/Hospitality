export const ORDER_TRACKING_CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const orderTrackingStorageKey = "aazira-public-order-tracking-current";

export const ORDER_STATUS_PRESENTATION = Object.freeze({
  pending: { label: "Order received", description: "Your order has been received by the hotel." },
  preparing: { label: "Preparing", description: "The kitchen is preparing your order." },
  ready: { label: "Ready", description: "Your order is ready for service or delivery." },
  completed: { label: "Completed", description: "Your order has been completed." },
});

export function generateOrderTrackingCapability(cryptoImplementation = globalThis.crypto) {
  if (!cryptoImplementation?.getRandomValues) throw new Error("Secure tracking capability generation is unavailable.");
  const bytes = new Uint8Array(32);
  cryptoImplementation.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

export function trackingLink(capability, origin = globalThis.location?.origin || "") {
  if (!ORDER_TRACKING_CAPABILITY_PATTERN.test(capability || "")) throw new Error("Invalid tracking capability.");
  return `${origin}/order-tracking#${capability}`;
}

export async function copyTrackingLink(link, clipboard = globalThis.navigator?.clipboard) {
  try {
    if (!clipboard?.writeText) throw new Error("Clipboard unavailable");
    await clipboard.writeText(link);
    return { ok: true, message: "Link copied" };
  } catch {
    return { ok: false, message: "Copy unavailable. Use Track Order instead." };
  }
}

export function storeOrderTrackingCapability(capability, storage = globalThis.sessionStorage) {
  if (!ORDER_TRACKING_CAPABILITY_PATTERN.test(capability || "")) return false;
  storage?.setItem(orderTrackingStorageKey, capability);
  return true;
}

export function readOrderTrackingCapability(storage = globalThis.sessionStorage) {
  const capability = storage?.getItem(orderTrackingStorageKey) || "";
  if (ORDER_TRACKING_CAPABILITY_PATTERN.test(capability)) return capability;
  storage?.removeItem(orderTrackingStorageKey);
  return "";
}

export function clearOrderTrackingCapability(storage = globalThis.sessionStorage) {
  storage?.removeItem(orderTrackingStorageKey);
}

export function consumeOrderTrackingCapability({
  location = globalThis.location,
  history = globalThis.history,
  storage = globalThis.sessionStorage,
} = {}) {
  const fragment = location?.hash?.slice(1) || "";
  if (fragment) history?.replaceState(null, "", `${location.pathname}${location.search}`);
  const capability = fragment || readOrderTrackingCapability(storage);
  if (!ORDER_TRACKING_CAPABILITY_PATTERN.test(capability)) {
    if (fragment) storage?.removeItem(orderTrackingStorageKey);
    return { capability: "", malformed: Boolean(fragment) };
  }
  storeOrderTrackingCapability(capability, storage);
  return { capability, malformed: false };
}

export const shouldPollOrderTracking = status => status !== "completed";

export function trackingStatusAnnouncement(previousStatus, nextStatus) {
  if (!previousStatus || previousStatus === nextStatus || !ORDER_STATUS_PRESENTATION[nextStatus]) return "";
  return `Order status changed to ${ORDER_STATUS_PRESENTATION[nextStatus].label}.`;
}

export function formatPublicOrderTimestamp(value, timeZone) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}
