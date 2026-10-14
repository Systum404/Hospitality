import { ORDER_TRACKING_CAPABILITY_PATTERN } from "./orderTracking.js";

export const pendingOrderStorageKey = token => `aazira-public-order-pending:${token}`;

const presentationItems = cart => cart.map(item => ({ name: item.name, price: item.price }));

export function createPendingOrderRecovery(payload, cart, trackingCapability = null) {
  return { version: 2, payload, tracking_capability: trackingCapability, presentation: { items: presentationItems(cart) } };
}

function normalizedRecovery(value) {
  if (!value?.payload || !Array.isArray(value.payload.items)) return null;
  const presentation = Array.isArray(value.presentation?.items)
    ? value.presentation.items
    : Array.isArray(value.display?.cart)
      ? presentationItems(value.display.cart)
      : null;
  if (!presentation || presentation.length !== value.payload.items.length) return null;
  const trackingCapability = ORDER_TRACKING_CAPABILITY_PATTERN.test(value.tracking_capability || "") ? value.tracking_capability : null;
  return { version: 2, payload: value.payload, tracking_capability: trackingCapability, presentation: { items: presentation } };
}

export function readPendingOrderRecovery(token, storage = globalThis.sessionStorage) {
  try {
    const raw = storage?.getItem(pendingOrderStorageKey(token));
    if (!raw) return null;
    const recovery = normalizedRecovery(JSON.parse(raw));
    if (!recovery) {
      storage.removeItem(pendingOrderStorageKey(token));
      return null;
    }
    storage.setItem(pendingOrderStorageKey(token), JSON.stringify(recovery));
    return recovery;
  } catch {
    storage?.removeItem(pendingOrderStorageKey(token));
    return null;
  }
}

export function writePendingOrderRecovery(token, recovery, storage = globalThis.sessionStorage) {
  storage.setItem(pendingOrderStorageKey(token), JSON.stringify(recovery));
}

export function clearPendingOrderRecovery(token, storage = globalThis.sessionStorage) {
  storage.removeItem(pendingOrderStorageKey(token));
}

export function restorePendingOrderState(recovery) {
  return {
    cart: recovery.payload.items.map((item, index) => ({
      id: item.menu_item_id,
      name: recovery.presentation.items[index].name,
      price: recovery.presentation.items[index].price,
      quantity: item.quantity,
      special_instructions: item.special_instructions || "",
    })),
    customer: {
      customer_name: recovery.payload.customer_name || "",
      customer_phone: recovery.payload.customer_phone || "",
      customer_email: recovery.payload.customer_email || "",
    },
    notes: recovery.payload.notes || "",
    locked: true,
  };
}

export function shouldPreservePendingOrder(error) {
  return Boolean(error?.uncertain || error?.status === 429 || error?.code === "ORDER_KEY_CONFLICT" || error?.code === "INVALID_ROOM_CAPABILITY");
}
