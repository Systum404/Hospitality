import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createNotificationPoller,
  NOTIFICATION_REFRESH_INTERVAL_MS,
  STAFF_NOTIFICATION_ROLE_KEYS,
  supportsStaffNotificationPolling,
} from "../../client/src/features/notifications/notificationRefresh.js";

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, reject, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

const timers = [];
const cleared = [];
const documentListeners = new Map();
const windowListeners = new Map();
const removedDocumentListeners = [];
const removedWindowListeners = [];
let visible = true;
let clock = 10_000;
let calls = 0;
let activeRequest = deferred();
const received = [];
const errors = [];
const poller = createNotificationPoller({
  addDocumentListener: (type, listener) => documentListeners.set(type, listener),
  addWindowListener: (type, listener) => windowListeners.set(type, listener),
  clearTimer: timer => { timer.cleared = true; cleared.push(timer); },
  isVisible: () => visible,
  load: ({ signal }) => { calls += 1; signal.addEventListener("abort", () => activeRequest.reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }); return activeRequest.promise; },
  now: () => clock,
  onData: data => received.push(data),
  onError: error => { errors.push(error); return true; },
  removeDocumentListener: (type, listener) => { removedDocumentListeners.push([type, listener]); documentListeners.delete(type); },
  removeWindowListener: (type, listener) => { removedWindowListeners.push([type, listener]); windowListeners.delete(type); },
  scheduleTimer: (callback, delay) => { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
});

await tick();
check(calls === 1, "initial fetch starts immediately");
check(timers.length === 0, "no next timer is scheduled while the request is active");
check(poller.refresh() === poller.refresh(), "concurrent refresh calls share the in-flight request");
check(calls === 1, "refresh calls do not overlap an active request");
activeRequest.resolve({ notifications: [{ id: "first" }], unreadCount: 1, timezone: "Asia/Kolkata" });
await tick();
check(received.at(-1).unreadCount === 1, "successful fetch publishes unread notification data");
check(timers.length === 1 && timers[0].delay === NOTIFICATION_REFRESH_INTERVAL_MS && timers[0].delay === 30_000, "next fetch uses the approved 30-second cadence after settlement");

visible = false;
documentListeners.get("visibilitychange")();
check(timers[0].cleared, "hidden document clears the pending timer");
clock += 5_000;
visible = true;
activeRequest = deferred();
documentListeners.get("visibilitychange")();
await tick();
check(calls === 2, "visibility restoration refreshes immediately");
windowListeners.get("focus")();
await tick();
check(calls === 2, "focus restoration is deduplicated against the visibility refresh");
activeRequest.resolve({ notifications: [{ id: "second" }], unreadCount: 2, timezone: "Asia/Kolkata" });
await tick();
check(received.at(-1).unreadCount === 2, "background refresh updates unread count without opening the popover");

activeRequest = deferred();
timers.at(-1).callback();
await tick();
check(calls === 3, "scheduled timer starts the next request");
const previousData = received.at(-1);
activeRequest.reject(Object.assign(new Error("temporary"), { status: 503 }));
await tick();
check(errors.length === 1 && received.at(-1) === previousData, "transient failure preserves the latest successful notification data");
check(timers.length === 3, "transient failure continues with one polling timer");

let aborted = false;
activeRequest = deferred();
timers.at(-1).callback();
await tick();
activeRequest.promise.catch(error => { if (error.name === "AbortError") aborted = true; });
poller.stop();
await tick();
check(aborted, "cleanup aborts the active request");
check(timers.at(-1).cleared, "cleanup clears the pending timer");
check(removedDocumentListeners.length === 1 && removedWindowListeners.length === 1 && cleared.length >= 2, "cleanup removes focus/visibility listeners and cancels timers");

let unauthorizedCalls = 0;
let signOutCalls = 0;
const unauthorizedTimers = [];
const unauthorizedPoller = createNotificationPoller({
  addDocumentListener: () => {}, addWindowListener: () => {}, removeDocumentListener: () => {}, removeWindowListener: () => {},
  isVisible: () => true,
  load: async () => { unauthorizedCalls += 1; throw Object.assign(new Error("expired"), { status: 401 }); },
  onData: () => {},
  onError: async error => { if (error.status === 401) { signOutCalls += 1; return false; } return true; },
  scheduleTimer: (callback, delay) => { unauthorizedTimers.push({ callback, delay }); return unauthorizedTimers.at(-1); },
});
await tick();
check(unauthorizedCalls === 1 && signOutCalls === 1, "HTTP 401 signs out exactly once");
check(unauthorizedTimers.length === 0, "HTTP 401 stops polling without scheduling another request");
unauthorizedPoller.stop();

for (const roleKey of STAFF_NOTIFICATION_ROLE_KEYS) {
  check(supportsStaffNotificationPolling({ roleKey, scope: "HOTEL", hotelId: "hotel-id" }), `${roleKey} starts hotel notification polling`);
}
check(!supportsStaffNotificationPolling({ roleKey: "SUPER_ADMIN", scope: "COMPANY", hotelId: null }), "SUPER_ADMIN company context does not poll hotel notifications");
check(!supportsStaffNotificationPolling({ roleKey: "MANAGER", scope: "HOTEL", hotelId: null }), "hotel notification polling requires an authenticated hotel");

const [appShell, header, reception, provider] = await Promise.all([
  readFile(new URL("../../client/src/components/layout/AppShell.jsx", import.meta.url), "utf8"),
  readFile(new URL("../../client/src/components/layout/Header.jsx", import.meta.url), "utf8"),
  readFile(new URL("../../client/src/features/reception/pages/ReceptionDashboard.jsx", import.meta.url), "utf8"),
  readFile(new URL("../../client/src/features/notifications/NotificationRefreshProvider.jsx", import.meta.url), "utf8"),
]);
check(appShell.includes("<NotificationRefreshProvider>"), "AppShell owns one shared notification provider");
check(header.includes("useNotificationRefresh") && !header.includes("getNotifications"), "Header consumes shared notification state instead of fetching independently");
check(reception.includes("useNotificationRefresh") && !reception.includes("getNotifications"), "Reception alerts consume shared notification state instead of fetching independently");
check(provider.includes("markNotificationRead") && provider.includes("refreshAfterCurrent"), "mark-one-read uses the existing mutation then refreshes shared state");
check(provider.includes("markAllNotificationsRead") && provider.includes("refreshAfterCurrent"), "mark-all-read uses the existing mutation then refreshes shared state");
check(!`${appShell}${header}${reception}${provider}`.includes("location.reload"), "notification refresh never reloads the page");
check(!provider.includes("navigate(") && !provider.includes("window.location"), "notification refresh preserves route and page-owned UI state");

console.log(`Notification auto-refresh tests: ${checks}/${checks} passed`);
