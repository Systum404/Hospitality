import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";

const REPORT_RANGES = new Set(["today", "yesterday", "week", "month", "year"]);

const money = value => value == null ? "0.00" : Number(value).toFixed(2);
const dateKey = date => date.toISOString().slice(0, 10);
const parseDateKey = value => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};
const addDays = (value, days) => {
  const date = parseDateKey(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
};
const monthKey = (year, month) => `${year}-${String(month).padStart(2, "0")}-01`;
const localDateKey = (instant, timezone) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

function rangeKeys(range, currentDate) {
  const current = parseDateKey(currentDate);
  const year = current.getUTCFullYear();
  const month = current.getUTCMonth() + 1;
  if (range === "today") {
    return { start: currentDate, end: addDays(currentDate, 1), previousStart: addDays(currentDate, -1), previousEnd: currentDate, bucket: "hour" };
  }
  if (range === "yesterday") {
    const start = addDays(currentDate, -1);
    return { start, end: currentDate, previousStart: addDays(start, -1), previousEnd: start, bucket: "hour" };
  }
  if (range === "week") {
    const daysFromMonday = (current.getUTCDay() + 6) % 7;
    const start = addDays(currentDate, -daysFromMonday);
    return { start, end: addDays(start, 7), previousStart: addDays(start, -7), previousEnd: start, bucket: "day" };
  }
  if (range === "month") {
    const start = monthKey(year, month);
    const end = month === 12 ? monthKey(year + 1, 1) : monthKey(year, month + 1);
    const previousStart = month === 1 ? monthKey(year - 1, 12) : monthKey(year, month - 1);
    return { start, end, previousStart, previousEnd: start, bucket: "day" };
  }
  const start = monthKey(year, 1);
  return { start, end: monthKey(year + 1, 1), previousStart: monthKey(year - 1, 1), previousEnd: start, bucket: "month" };
}

async function timestampBounds(keys, timezone) {
  const rows = await prisma.$queryRaw`
    SELECT
      extract(epoch FROM timezone(${timezone}::text, ${keys.start}::date::timestamp))::text AS period_start,
      extract(epoch FROM timezone(${timezone}::text, ${keys.end}::date::timestamp))::text AS period_end,
      extract(epoch FROM timezone(${timezone}::text, ${keys.previousStart}::date::timestamp))::text AS previous_start,
      extract(epoch FROM timezone(${timezone}::text, ${keys.previousEnd}::date::timestamp))::text AS previous_end
  `;
  return rows[0];
}

function makeBuckets(keys) {
  if (keys.bucket === "hour") {
    return Array.from({ length: 24 }, (_, hour) => ({
      key: `${keys.start} ${String(hour).padStart(2, "0")}`,
      label: `${String(hour).padStart(2, "0")}:00`,
    }));
  }
  if (keys.bucket === "month") {
    const year = Number(keys.start.slice(0, 4));
    return Array.from({ length: 12 }, (_, index) => ({
      key: `${year}-${String(index + 1).padStart(2, "0")}`,
      label: new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, index, 1))),
    }));
  }
  const buckets = [];
  for (let key = keys.start; key < keys.end; key = addDays(key, 1)) {
    const date = parseDateKey(key);
    const label = keys.end === addDays(keys.start, 7)
      ? new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(date)
      : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
    buckets.push({ key, label });
  }
  return buckets;
}

const percentageChange = (current, previous) => {
  const currentNumber = Number(current ?? 0);
  const previousNumber = Number(previous ?? 0);
  if (previousNumber === 0) return currentNumber === 0 ? 0 : null;
  return Math.round(((currentNumber - previousNumber) / Math.abs(previousNumber)) * 1000) / 10;
};

async function periodAggregates(hotelId, start, end) {
  const rows = await prisma.$queryRaw`
    SELECT
      (SELECT COALESCE(sum(p.amount), 0)::text
       FROM payment p JOIN bill b ON b.id = p.bill_id AND b.hotel_id = p.hotel_id
       WHERE p.hotel_id = ${hotelId}::uuid AND p.status = 'RECORDED'
         AND b.type IN ('ROOM', 'CAPTAIN') AND b.status <> 'VOID'
         AND p.created_at >= to_timestamp(${start}::double precision)
         AND p.created_at < to_timestamp(${end}::double precision)) AS collections,
      (SELECT count(*)::int FROM orders o
       WHERE o.hotel_id = ${hotelId}::uuid AND o.source IN ('room_qr', 'captain', 'dining_table_qr')
         AND o.created_at >= to_timestamp(${start}::double precision)
         AND o.created_at < to_timestamp(${end}::double precision)) AS orders,
      (SELECT COALESCE(avg(b.total_amount), 0)::text FROM bill b
       WHERE b.hotel_id = ${hotelId}::uuid AND b.type IN ('ROOM', 'CAPTAIN')
         AND b.status IN ('FINALIZED', 'PARTIALLY_PAID', 'PAID')
         AND b.created_at >= to_timestamp(${start}::double precision)
         AND b.created_at < to_timestamp(${end}::double precision)) AS average_bill
  `;
  return { collections: money(rows[0].collections), orders: rows[0].orders, averageBill: money(rows[0].average_bill) };
}

async function trendRows(hotelId, timezone, bounds, bucket) {
  const format = bucket === "hour" ? "YYYY-MM-DD HH24" : bucket === "month" ? "YYYY-MM" : "YYYY-MM-DD";
  const [collectionRows, orderRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT to_char(timezone(${timezone}::text, p.created_at), ${format}) AS bucket_key,
             COALESCE(sum(p.amount), 0)::text AS collections
      FROM payment p
      JOIN bill b ON b.id = p.bill_id AND b.hotel_id = p.hotel_id
      WHERE p.hotel_id = ${hotelId}::uuid
        AND p.status = 'RECORDED'
        AND b.type IN ('ROOM', 'CAPTAIN')
        AND b.status <> 'VOID'
        AND p.created_at >= to_timestamp(${bounds.period_start}::double precision)
        AND p.created_at < to_timestamp(${bounds.period_end}::double precision)
      GROUP BY 1
    `,
    prisma.$queryRaw`
      SELECT to_char(timezone(${timezone}::text, o.created_at), ${format}) AS bucket_key,
             count(*)::int AS orders
      FROM orders o
      WHERE o.hotel_id = ${hotelId}::uuid
        AND o.source IN ('room_qr', 'captain', 'dining_table_qr')
        AND o.created_at >= to_timestamp(${bounds.period_start}::double precision)
        AND o.created_at < to_timestamp(${bounds.period_end}::double precision)
      GROUP BY 1
    `,
  ]);
  return {
    collections: new Map(collectionRows.map(row => [row.bucket_key, row.collections])),
    orders: new Map(orderRows.map(row => [row.bucket_key, row.orders])),
  };
}

export function validateManagerReportRange(range) {
  const value = range || "today";
  if (!REPORT_RANGES.has(value)) {
    throw new AppError("range must be one of today, yesterday, week, month, or year.", { code: "INVALID_REPORT_RANGE", statusCode: 400 });
  }
  return value;
}

export async function getManagerReport(hotelId, requestedRange = "today", now = new Date()) {
  const range = validateManagerReportRange(requestedRange);
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { id: true, timezone: true } });
  if (!hotel) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
  try { new Intl.DateTimeFormat("en-IN", { timeZone: hotel.timezone }).format(now); }
  catch { throw new AppError("The hotel's timezone configuration is invalid.", { code: "INVALID_HOTEL_TIMEZONE", statusCode: 500 }); }

  const keys = rangeKeys(range, localDateKey(now, hotel.timezone));
  const bounds = await timestampBounds(keys, hotel.timezone);

  const [current, previous, outstandingRows, orderGroups, statusRows, billGroups, topItems, categoryRows, trends] = await Promise.all([
    periodAggregates(hotelId, bounds.period_start, bounds.period_end),
    periodAggregates(hotelId, bounds.previous_start, bounds.previous_end),
    prisma.$queryRaw`
      SELECT COALESCE(sum(balance_due), 0)::text AS outstanding
      FROM bill WHERE hotel_id = ${hotelId}::uuid AND type IN ('ROOM', 'CAPTAIN')
        AND status <> 'VOID' AND balance_due > 0
        AND created_at >= to_timestamp(${bounds.period_start}::double precision)
        AND created_at < to_timestamp(${bounds.period_end}::double precision)
    `,
    prisma.$queryRaw`
      SELECT source::text AS source, count(*)::int AS count
      FROM orders WHERE hotel_id = ${hotelId}::uuid AND source IN ('room_qr', 'captain', 'dining_table_qr')
        AND created_at >= to_timestamp(${bounds.period_start}::double precision)
        AND created_at < to_timestamp(${bounds.period_end}::double precision)
      GROUP BY source
    `,
    prisma.$queryRaw`
      SELECT count(*) FILTER (WHERE status IN ('pending', 'preparing', 'ready'))::int AS active,
             count(*) FILTER (WHERE status = 'completed')::int AS completed
      FROM orders WHERE hotel_id = ${hotelId}::uuid AND source IN ('room_qr', 'captain', 'dining_table_qr')
        AND created_at >= to_timestamp(${bounds.period_start}::double precision)
        AND created_at < to_timestamp(${bounds.period_end}::double precision)
    `,
    prisma.$queryRaw`
      SELECT type::text AS type, count(*)::int AS count,
             COALESCE(sum(total_amount), 0)::text AS total,
             COALESCE(sum(balance_due), 0)::text AS outstanding
      FROM bill WHERE hotel_id = ${hotelId}::uuid AND type IN ('ROOM', 'CAPTAIN') AND status <> 'VOID'
        AND created_at >= to_timestamp(${bounds.period_start}::double precision)
        AND created_at < to_timestamp(${bounds.period_end}::double precision)
      GROUP BY type
    `,
    prisma.$queryRaw`
      SELECT oi.item_name, COALESCE(sum(oi.quantity), 0)::int AS quantity,
             COALESCE(sum(oi.subtotal), 0)::text AS subtotal
      FROM order_item oi JOIN orders o ON o.id = oi.order_id
      WHERE o.hotel_id = ${hotelId}::uuid AND o.source IN ('room_qr', 'captain', 'dining_table_qr')
        AND o.status = 'completed'
        AND o.created_at >= to_timestamp(${bounds.period_start}::double precision)
        AND o.created_at < to_timestamp(${bounds.period_end}::double precision)
      GROUP BY oi.item_name ORDER BY quantity DESC, oi.item_name ASC LIMIT 10
    `,
    prisma.$queryRaw`
      SELECT mc.name,
             sum(oi.quantity)::bigint AS quantity,
             COALESCE(sum(oi.subtotal), 0)::text AS subtotal
      FROM order_item oi
      JOIN orders o ON o.id = oi.order_id
      JOIN menu_item mi ON mi.id = oi.menu_item_id
      LEFT JOIN menu_category mc ON mc.id = mi.category_id AND mc.hotel_id = o.hotel_id
      WHERE o.hotel_id = ${hotelId}::uuid
        AND o.source IN ('room_qr', 'captain', 'dining_table_qr')
        AND o.status = 'completed'
        AND o.created_at >= to_timestamp(${bounds.period_start}::double precision)
        AND o.created_at < to_timestamp(${bounds.period_end}::double precision)
      GROUP BY mc.name
      ORDER BY quantity DESC, mc.name ASC NULLS LAST
    `,
    trendRows(hotelId, hotel.timezone, bounds, keys.bucket),
  ]);

  const orderCounts = Object.fromEntries(orderGroups.map(row => [row.source, row.count]));
  const billCounts = Object.fromEntries(billGroups.map(row => [row.type, row]));
  const categorizedRows = categoryRows.filter(row => row.name);
  const categorizedQuantity = categorizedRows.reduce((sum, row) => sum + Number(row.quantity), 0);
  const unresolvedQuantity = categoryRows.filter(row => !row.name).reduce((sum, row) => sum + Number(row.quantity), 0);
  const categories = categorizedRows.map(row => ({
    name: row.name,
    quantity: Number(row.quantity),
    subtotal: row.subtotal,
    percentage: categorizedQuantity ? Math.round((Number(row.quantity) / categorizedQuantity) * 1000) / 10 : 0,
  }));
  const trend = makeBuckets(keys).map(bucket => ({
    ...bucket,
    collections: trends.collections.get(bucket.key) || "0.00",
    orders: trends.orders.get(bucket.key) || 0,
  }));

  return {
    meta: {
      range,
      timezone: hotel.timezone,
      from: keys.start,
      to: addDays(keys.end, -1),
      generatedAt: now.toISOString(),
      categoryCoverage: { categorizedQuantity, unresolvedQuantity },
    },
    summary: {
      collections: current.collections,
      orders: current.orders,
      averageBill: current.averageBill,
      outstanding: money(outstandingRows[0].outstanding),
      activeOrders: statusRows[0].active,
      completedOrders: statusRows[0].completed,
      comparisons: {
        collections: percentageChange(current.collections, previous.collections),
        orders: percentageChange(current.orders, previous.orders),
        averageBill: percentageChange(current.averageBill, previous.averageBill),
      },
    },
    orderBreakdown: {
      roomService: orderCounts.room_qr || 0,
      restaurant: (orderCounts.captain || 0) + (orderCounts.dining_table_qr || 0),
      captain: orderCounts.captain || 0,
      diningTableQr: orderCounts.dining_table_qr || 0,
    },
    billingBreakdown: {
      room: { count: billCounts.ROOM?.count || 0, total: money(billCounts.ROOM?.total), outstanding: money(billCounts.ROOM?.outstanding) },
      restaurant: { count: billCounts.CAPTAIN?.count || 0, total: money(billCounts.CAPTAIN?.total), outstanding: money(billCounts.CAPTAIN?.outstanding) },
    },
    trend,
    topItems: topItems.map(row => ({ name: row.item_name, quantity: row.quantity || 0, subtotal: money(row.subtotal) })),
    categories,
  };
}
