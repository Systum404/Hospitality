export const KITCHEN_ORDER_REFRESH_INTERVAL_MS = 15_000;

export function filterKitchenOrders(orders, { query = "", status = "all", type = "all" } = {}) {
  const needle = query.trim().toLowerCase();
  return (orders || []).filter((order) => {
    const searchable = `${order.id} ${order.location} ${order.table || ""} ${order.room || ""} ${order.guest}`.toLowerCase();
    return (type === "all" || order.source === type)
      && (status === "all" || order.kitchenStatus === status)
      && searchable.includes(needle);
  });
}

export function createKitchenOrderPoller({
  clearTimer = clearTimeout,
  intervalMs = KITCHEN_ORDER_REFRESH_INTERVAL_MS,
  load,
  onData,
  onError,
  scheduleTimer = setTimeout,
}) {
  let active = true;
  let controller = null;
  let inFlight = null;
  let timer = null;

  const schedule = () => {
    if (!active) return;
    timer = scheduleTimer(run, intervalMs);
  };

  const stop = () => {
    active = false;
    if (timer !== null) clearTimer(timer);
    timer = null;
    controller?.abort();
  };

  function run() {
    if (!active) return Promise.resolve();
    if (inFlight) return inFlight;

    controller = new AbortController();
    inFlight = Promise.resolve()
      .then(() => load({ signal: controller.signal }))
      .then((orders) => { if (active) onData(orders); })
      .catch(async (error) => {
        if (!active || error?.name === "AbortError") return;
        if (await onError?.(error) === false) stop();
      })
      .finally(() => {
        inFlight = null;
        controller = null;
        schedule();
      });

    return inFlight;
  }

  run();
  return { refresh: run, stop };
}
