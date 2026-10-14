export function formatReceptionDashboardMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function getReceptionDashboardNotificationPreview(data, limit = 5) {
  if (!Array.isArray(data?.notifications)) return [];
  return data.notifications.slice(0, limit);
}
