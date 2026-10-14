const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.000)?Z)?$/;

export function parseBookingDate(value) {
  if (typeof value !== "string") return null;
  const match = DATE_ONLY.exec(value);
  if (!match || match[1].startsWith("0000-")) return null;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === match[1] ? date : null;
}

export function isBookingDate(value) {
  return value instanceof Date
    && !Number.isNaN(value.valueOf())
    && value.toISOString().endsWith("T00:00:00.000Z");
}

export function bookingDateKey(value) {
  if (!isBookingDate(value)) throw new TypeError("Expected a canonical booking date.");
  return value.toISOString().slice(0, 10);
}

export function addBookingDays(value, days) {
  return new Date(value.getTime() + days * 86400000);
}

export function bookingNights(from, to) {
  if (!isBookingDate(from) || !isBookingDate(to)) return NaN;
  return (to.getTime() - from.getTime()) / 86400000;
}

export function hotelDateKey(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function hotelBookingDateBounds(now, timeZone) {
  const start = parseBookingDate(hotelDateKey(now, timeZone));
  return { start, next: addBookingDays(start, 1) };
}
