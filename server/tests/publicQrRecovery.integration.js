import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  clearPendingOrderRecovery,
  createPendingOrderRecovery,
  pendingOrderStorageKey,
  readPendingOrderRecovery,
  restorePendingOrderState,
  shouldPreservePendingOrder,
  writePendingOrderRecovery,
} from "../../client/src/features/public-ordering/services/publicOrderRecovery.js";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const token = "public-token";
const key = "11111111-1111-4111-8111-111111111111";
const trackingCapability = randomBytes(32).toString("base64url");
const payload = {
  idempotency_key: key,
  items: [{ menu_item_id: "22222222-2222-4222-8222-222222222222", quantity: 2, special_instructions: "No onion" }],
  notes: "Window table",
  customer_name: "Recovery Guest",
  customer_phone: "5550001",
  customer_email: "guest@example.invalid",
};
const cart = [{ id: payload.items[0].menu_item_id, name: "Paneer", price: "120.00", quantity: 2, special_instructions: "No onion" }];

const storage = new MemoryStorage();
const recovery = createPendingOrderRecovery(payload, cart, trackingCapability);
writePendingOrderRecovery(token, recovery, storage);
const serialized = storage.getItem(pendingOrderStorageKey(token));
const stored = JSON.parse(serialized);
check(stored.version === 2 && stored.payload.idempotency_key === key && stored.tracking_capability === trackingCapability, "pending recovery stores the immutable payload, idempotency key, and tracking capability");
check(!Object.hasOwn(stored, "display") && !Object.hasOwn(stored.presentation, "customer"), "pending recovery has no redundant customer presentation object");
check((serialized.match(/Recovery Guest/g) || []).length === 1 && (serialized.match(/5550001/g) || []).length === 1, "customer PII occurs only in the immutable request payload");
check((serialized.match(new RegExp(trackingCapability, "g")) || []).length === 1 && !serialized.includes("password") && !serialized.includes('"auth"'), "pending recovery stores the tracking capability once without unrelated authentication material");

const visibleState = { customer: { customer_name: "Diverged Guest" }, cart: [] };
const restored = restorePendingOrderState(readPendingOrderRecovery(token, storage));
check(restored.locked && restored.customer.customer_name === payload.customer_name && restored.cart[0].quantity === 2 && visibleState.customer.customer_name !== restored.customer.customer_name, "pending recovery restores and locks the immutable visible state instead of using diverged edits");
check(restored.notes === payload.notes && restored.cart[0].special_instructions === payload.items[0].special_instructions, "notes and item instructions are restored from the immutable payload");

const legacyStorage = new MemoryStorage();
legacyStorage.setItem(pendingOrderStorageKey(token), JSON.stringify({ payload, display: { cart, customer: restored.customer, notes: payload.notes } }));
const migrated = readPendingOrderRecovery(token, legacyStorage);
const migratedSerialized = legacyStorage.getItem(pendingOrderStorageKey(token));
check(migrated.version === 2 && migrated.tracking_capability === null && !migratedSerialized.includes('"display"'), "legacy recovery is minimized in place and marked for tracking-capability upgrade without losing retry state");
check((migratedSerialized.match(/Recovery Guest/g) || []).length === 1, "legacy duplicate customer PII is removed during recovery");

for (const error of [{ uncertain: true }, { status: 429 }, { code: "INVALID_ROOM_CAPABILITY" }, { code: "ORDER_KEY_CONFLICT" }]) {
  check(shouldPreservePendingOrder(error), "uncertain, limited, capability, and conflict errors preserve the immutable envelope");
}
check(!shouldPreservePendingOrder({ status: 400, code: "INVALID_PUBLIC_ORDER" }), "definitive validation failures do not retain a stale envelope");

clearPendingOrderRecovery(token, storage);
check(storage.getItem(pendingOrderStorageKey(token)) === null, "successful submission or explicit abandonment clears recovery");
const replacement = createPendingOrderRecovery({ ...payload, idempotency_key: "33333333-3333-4333-8333-333333333333" }, cart, randomBytes(32).toString("base64url"));
writePendingOrderRecovery(token, replacement, storage);
check(readPendingOrderRecovery(token, storage).payload.idempotency_key !== key, "a new independent order uses a new idempotency key after abandonment");

console.log(`Public QR recovery integration: ${checks}/${checks} checks passed.`);
