export function formatElapsedTime(createdAt, { includeDays = true, roundMinutes = false } = {}) {
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return "Just now";
  const elapsedMinutes = (Date.now() - timestamp) / 60000;
  const minutes = Math.max(1, roundMinutes ? Math.round(elapsedMinutes) : Math.floor(elapsedMinutes));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (!includeDays || hours < 24) return `${hours} hr${includeDays && hours !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
