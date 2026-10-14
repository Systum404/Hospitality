export const NOTIFICATION_REFRESH_INTERVAL_MS = 30_000;

export const STAFF_NOTIFICATION_ROLE_KEYS = Object.freeze([
  "HOTEL_ADMIN",
  "MANAGER",
  "RECEPTION",
  "CAPTAIN",
  "KITCHEN",
]);

const STAFF_NOTIFICATION_ROLE_KEY_SET = new Set(STAFF_NOTIFICATION_ROLE_KEYS);

export function supportsStaffNotificationPolling(user) {
  return Boolean(
    user?.scope === "HOTEL"
    && typeof user?.hotelId === "string"
    && STAFF_NOTIFICATION_ROLE_KEY_SET.has(user?.roleKey),
  );
}

export function createNotificationPoller({
  addDocumentListener = (type, listener) => document.addEventListener(type, listener),
  addWindowListener = (type, listener) => window.addEventListener(type, listener),
  clearTimer = clearTimeout,
  focusDeduplicationMs = 1_000,
  intervalMs = NOTIFICATION_REFRESH_INTERVAL_MS,
  isVisible = () => document.visibilityState === "visible",
  load,
  now = () => Date.now(),
  onData,
  onError,
  onSettled,
  removeDocumentListener = (type, listener) => document.removeEventListener(type, listener),
  removeWindowListener = (type, listener) => window.removeEventListener(type, listener),
  scheduleTimer = setTimeout,
}) {
  let active = true;
  let controller = null;
  let inFlight = null;
  let timer = null;
  let lastForegroundRefreshAt = Number.NEGATIVE_INFINITY;

  const clearScheduled = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const schedule = () => {
    clearScheduled();
    if (!active || !isVisible()) return;
    timer = scheduleTimer(run, intervalMs);
  };

  function run() {
    if (!active) return Promise.resolve();
    if (inFlight) return inFlight;
    clearScheduled();
    controller = new AbortController();
    inFlight = Promise.resolve()
      .then(() => load({ signal: controller.signal }))
      .then((data) => { if (active) onData(data); })
      .catch(async (error) => {
        if (!active || error?.name === "AbortError") return;
        if (await onError?.(error) === false) stop();
      })
      .finally(() => {
        inFlight = null;
        controller = null;
        if (active) {
          onSettled?.();
          schedule();
        }
      });
    return inFlight;
  }

  async function refreshAfterCurrent() {
    const current = inFlight;
    if (current) await current;
    return run();
  }

  const refreshFromForeground = () => {
    if (!active || !isVisible()) return;
    const timestamp = now();
    if (timestamp - lastForegroundRefreshAt < focusDeduplicationMs) return;
    lastForegroundRefreshAt = timestamp;
    void run();
  };

  const onVisibilityChange = () => {
    if (!isVisible()) {
      clearScheduled();
      return;
    }
    refreshFromForeground();
  };

  const onFocus = () => refreshFromForeground();

  function stop() {
    if (!active) return;
    active = false;
    clearScheduled();
    controller?.abort();
    removeDocumentListener("visibilitychange", onVisibilityChange);
    removeWindowListener("focus", onFocus);
  }

  addDocumentListener("visibilitychange", onVisibilityChange);
  addWindowListener("focus", onFocus);
  void run();

  return { refresh: run, refreshAfterCurrent, stop };
}
