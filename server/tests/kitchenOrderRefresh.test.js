import assert from "node:assert/strict";
import { createKitchenOrderPoller, filterKitchenOrders, KITCHEN_ORDER_REFRESH_INTERVAL_MS } from "../../client/src/features/kitchen/services/kitchenOrderRefresh.js";

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(next => { resolve = next; });
  return { promise, resolve };
};

const scheduled = [];
const cleared = [];
const responses = [deferred(), deferred(), deferred()];
const received = [];
let calls = 0;
const poller = createKitchenOrderPoller({
  clearTimer: timer => { timer.cleared = true; cleared.push(timer); },
  load: ({ signal }) => { calls++; return responses[calls - 1].promise.then(orders => ({ orders, signal })); },
  onData: result => received.push(result),
  scheduleTimer: (callback, delay) => { const timer = { callback, delay, cleared: false }; scheduled.push(timer); return timer; },
});

await flush();
check(calls === 1, "Kitchen polling performs the initial fetch immediately");
const overlapping = poller.refresh();
await flush();
check(calls === 1, "Kitchen polling reuses the in-flight request instead of overlapping it");
responses[0].resolve([{ id: "ORD-old", source: "room", kitchenStatus: "pending", location: "101", guest: "Guest" }]);
await overlapping;
check(received.length === 1 && received[0].orders.length === 1, "The initial order response reaches dashboard state once");
check(scheduled.length === 1 && scheduled[0].delay === KITCHEN_ORDER_REFRESH_INTERVAL_MS && scheduled[0].delay === 15_000, "The next refresh is scheduled at the established 15-second cadence");

scheduled[0].callback();
await flush();
check(calls === 2, "A scheduled refresh performs a subsequent order fetch");
responses[1].resolve([
  { id: "ORD-old", source: "room", kitchenStatus: "pending", location: "101", guest: "Guest" },
  { id: "ORD-new", source: "room", kitchenStatus: "pending", location: "102", guest: "New Guest" },
]);
await flush();
check(received.at(-1).orders.some(order => order.id === "ORD-new"), "A newly created order becomes visible after a subsequent refresh");
const filterState = { query: "102", status: "pending", type: "room" };
check(filterKitchenOrders(received.at(-1).orders, filterState).map(order => order.id).join() === "ORD-new", "Existing Kitchen filters remain effective across refreshed order data");

scheduled[1].callback();
await flush();
responses[2].resolve([{ id: "ORD-new", source: "room", kitchenStatus: "preparing", location: "102", guest: "New Guest" }]);
await flush();
check(received.at(-1).orders.length === 1 && received.at(-1).orders[0].kitchenStatus === "preparing", "Polling replaces state without duplicating orders and preserves status updates");
poller.stop();
check(cleared.length === 1 && scheduled.at(-1).cleared, "Unmount cleanup cancels the scheduled refresh timer");

const pending = deferred();
let aborted = false;
const unmounted = createKitchenOrderPoller({
  load: ({ signal }) => { signal.addEventListener("abort", () => { aborted = true; }); return pending.promise; },
  onData: () => assert.fail("Unmounted poller must not publish data"),
  scheduleTimer: () => assert.fail("Unmounted poller must not schedule another refresh"),
});
await flush();
unmounted.stop();
pending.resolve([]);
await flush();
check(aborted, "Unmount cleanup aborts the active request and prevents further polling");

console.log(`Kitchen order refresh tests: ${checks}/${checks} passed`);
