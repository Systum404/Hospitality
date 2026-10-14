// Explicit local-only integration test. All fixtures are isolated and removed in finally.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { updateKitchenOrderStatus } from "../services/kitchenService.js";
import { rotateQrCode } from "../services/qrService.js";
import { updateRoomBookingStatus } from "../services/roomBookingService.js";
import { deleteHotelFixtures } from "./helpers/hotelFixtureCleanup.js";

const database = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && database.pathname === "/hms", "Public order tracking tests are local hms only");

const models = ["hotel", "customer", "room", "room_booking", "dining_area", "dining_table", "menu_item", "qr_code", "orders", "order_item", "notification"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const hotelIds = [];
let server;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const secret = () => randomBytes(32).toString("base64url");
const digest = value => createHash("sha256").update(value, "utf8").digest("hex");

try {
  const hotelId = randomUUID();
  hotelIds.push(hotelId);
  await prisma.hotel.create({ data: { id: hotelId, name: "Tracking Test Hotel", status: "ACTIVE" } });
  const area = await prisma.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Tracking Area", status: "active" } });
  const table = await prisma.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelId, dining_area_id: area.id, table_number: "TRACK-1", capacity: 4, status: "available" } });
  const room = await prisma.room.create({ data: { id: randomUUID(), hotel_id: hotelId, room_number: "TRACK-R1", status: "active", base_price: "100.00" } });
  const menu = await prisma.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelId, name: "Tracking Meal", price: "25.00", is_available: true } });
  const roomCapability = secret();
  const booking = await prisma.room_booking.create({ data: {
    id: randomUUID(), hotel_id: hotelId, room_id: room.id, booking_number: `TRACK-${randomUUID()}`,
    customer_name: "Room Tracking Guest", customer_phone: "100", customer_email: "room-tracking@example.invalid",
    status: "checked-in", payment_status: "pending", room_rate: "100.00", checked_in_at: new Date(),
    booking_from: new Date(Date.now() - 86_400_000), booking_to: new Date(Date.now() + 86_400_000),
    ordering_capability_hash: digest(roomCapability), ordering_capability_created_at: new Date(),
  } });
  const tableQr = await prisma.qr_code.create({ data: { id: randomUUID(), hotel_id: hotelId, code: secret(), type: "dining_table", dining_table_id: table.id } });
  const roomQr = await prisma.qr_code.create({ data: { id: randomUUID(), hotel_id: hotelId, code: secret(), type: "room", room_id: room.id } });

  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, path, { body, headers = {}, expected = 200 } = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
    checks++;
    return { payload, response };
  };
  const orderBody = (key, tableOrder = false) => ({
    idempotency_key: key,
    items: [{ menu_item_id: menu.id, quantity: 2, special_instructions: "No chilli" }],
    notes: "Tracking note",
    ...(tableOrder ? { customer_name: "Table Tracking Guest", customer_phone: "919999000123", customer_email: "table-tracking@example.invalid" } : {}),
  });
  const place = (qr, trackingCapability, body, extraHeaders = {}) => request("POST", `/api/public/qr/${qr.code}/orders`, {
    body,
    expected: 201,
    headers: { "X-Order-Tracking-Capability": trackingCapability, ...extraHeaders },
  });
  const track = (trackingCapability, expected = 200) => request("GET", "/api/public/order-tracking", {
    expected,
    headers: { "X-Order-Tracking-Capability": trackingCapability },
  });

  const tableCapability = secret();
  const tableKey = randomUUID();
  const tableCreation = await place(tableQr, tableCapability, orderBody(tableKey, true));
  const tableOrder = await prisma.orders.findUniqueOrThrow({ where: { hotel_id_idempotency_key: { hotel_id: hotelId, idempotency_key: tableKey } } });
  check(tableOrder.tracking_capability_hash === digest(tableCapability) && tableOrder.tracking_capability_created_at instanceof Date, "public table order persists only the tracking hash and creation timestamp");
  check(tableOrder.tracking_capability_hash !== tableCapability && !JSON.stringify(tableCreation.payload).includes(tableCapability), "raw table tracking capability is neither persisted nor returned");

  const roomTrackingCapability = secret();
  const roomKey = randomUUID();
  await place(roomQr, roomTrackingCapability, orderBody(roomKey), { "X-Room-Capability": roomCapability });
  const roomOrder = await prisma.orders.findUniqueOrThrow({ where: { hotel_id_idempotency_key: { hotel_id: hotelId, idempotency_key: roomKey } } });
  check(roomOrder.source === "room_qr" && roomOrder.room_booking_id === booking.id && roomOrder.tracking_capability_hash === digest(roomTrackingCapability), "public room order receives its independent tracking hash");

  const tableTracking = await track(tableCapability);
  check(tableTracking.payload.data.order.order_number === tableOrder.order_number && tableTracking.payload.data.order.status === "pending", "valid capability retrieves only its table order");
  check(tableTracking.payload.data.order.hotel.name === "Tracking Test Hotel" && tableTracking.payload.data.order.hotel.timezone === "Asia/Kolkata", "tracking exposes only the hotel name and established IANA timezone needed for presentation");
  check(tableTracking.payload.data.order.context.type === "dining_table" && tableTracking.payload.data.order.context.label.includes(table.table_number), "table tracking returns customer-facing context");
  check(tableTracking.response.headers.get("cache-control")?.includes("no-store") && tableTracking.response.headers.get("pragma") === "no-cache" && tableTracking.response.headers.get("referrer-policy") === "no-referrer", "tracking response is private, no-store, and no-referrer");

  const roomTracking = await track(roomTrackingCapability);
  check(roomTracking.payload.data.order.order_number === roomOrder.order_number && roomTracking.payload.data.order.context.label === `Room ${room.room_number}`, "room capability retrieves only its room order");

  await updateRoomBookingStatus(hotelId, booking.id, "checked-out");
  const checkedOutTracking = await track(roomTrackingCapability);
  check(checkedOutTracking.payload.data.order.order_number === roomOrder.order_number && checkedOutTracking.payload.data.order.status === "pending", "room checkout does not revoke the existing order tracking capability");

  await updateKitchenOrderStatus(hotelId, roomOrder.id, "preparing");
  const preparingTracking = await track(roomTrackingCapability);
  check(preparingTracking.payload.data.order.order_number === roomOrder.order_number && preparingTracking.payload.data.order.status === "preparing", "preparing order remains directly retrievable through the public tracking API");
  check(Object.keys(preparingTracking.payload.data.order.items[0]).sort().join(",") === "name,quantity,special_instructions", "preparing tracking retains the customer-safe item projection");

  await updateKitchenOrderStatus(hotelId, roomOrder.id, "ready");
  const readyTracking = await track(roomTrackingCapability);
  check(readyTracking.payload.data.order.order_number === roomOrder.order_number && readyTracking.payload.data.order.status === "ready", "ready order remains directly retrievable through the public tracking API");
  check(!JSON.stringify(readyTracking.payload.data.order).includes(roomOrder.id), "ready tracking projection still excludes the internal order identifier");

  const serializedProjection = JSON.stringify(tableTracking.payload.data.order);
  for (const forbidden of [tableOrder.id, hotelId, table.id, menu.id, "table-tracking@example.invalid", "919999000123", tableCapability, digest(tableCapability), tableKey, "payment_status", "customer_id", "bill"]) {
    check(!serializedProjection.includes(forbidden), `tracking projection excludes internal or sensitive value ${forbidden === "919999000123" ? "phone" : "field"}`);
  }
  check(Object.keys(tableTracking.payload.data.order.items[0]).sort().join(",") === "name,quantity,special_instructions", "tracking items expose no item IDs, prices, or per-item status");

  await track(secret(), 404);
  await track("malformed", 400);
  await track(tableOrder.id, 400);
  await track(tableOrder.order_number, 400);
  await track(tableQr.code, 404);
  await track(roomCapability, 404);
  await request("GET", `/api/public/order-tracking?capability=${tableCapability}`, { expected: 400 });
  check(true, "unknown, malformed, UUID, order-number, QR, and room capabilities cannot authorize tracking");
  check(true, "tracking capability is rejected when supplied through a query parameter instead of the dedicated header");

  const replay = await place(tableQr, tableCapability, orderBody(tableKey, true));
  check(replay.payload.data.order.order_number === tableOrder.order_number && await prisma.orders.count({ where: { hotel_id: hotelId, idempotency_key: tableKey } }) === 1, "same idempotency key and tracking capability replay one order");
  await request("POST", `/api/public/qr/${tableQr.code}/orders`, { body: orderBody(tableKey, true), headers: { "X-Order-Tracking-Capability": secret() }, expected: 409 });
  await request("POST", `/api/public/qr/${tableQr.code}/orders`, { body: orderBody(randomUUID(), true), headers: { "X-Order-Tracking-Capability": tableCapability }, expected: 409 });
  check(await prisma.orders.count({ where: { tracking_capability_hash: digest(tableCapability) } }) === 1, "tracking hash uniqueness and idempotency fingerprint binding are enforced");

  const concurrentCapability = secret();
  const concurrentKey = randomUUID();
  const concurrentBody = orderBody(concurrentKey, true);
  const concurrent = await Promise.all([1, 2, 3].map(() => place(tableQr, concurrentCapability, concurrentBody)));
  check(new Set(concurrent.map(result => result.payload.data.order.order_number)).size === 1 && await prisma.orders.count({ where: { idempotency_key: concurrentKey } }) === 1, "concurrent duplicate submission creates one trackable order");

  const captainOrder = await prisma.orders.create({ data: {
    id: randomUUID(), hotel_id: hotelId, table_id: table.id, order_number: `CAP-${randomUUID()}`, source: "captain",
    customer_name: "Staff order", customer_phone: "300", status: "pending", payment_status: "pending",
    subtotal: "25.00", total_amount: "25.00",
  } });
  check(captainOrder.tracking_capability_hash === null && captainOrder.tracking_capability_created_at === null, "staff-created order has no tracking capability");

  await updateKitchenOrderStatus(hotelId, roomOrder.id, "completed");
  const completedTracking = await track(roomTrackingCapability);
  check(completedTracking.payload.data.order.status === "completed" && Boolean(completedTracking.payload.data.order.completed_at), "completed public order remains trackable");

  await prisma.hotel.update({ where: { id: hotelId }, data: { status: "INACTIVE" } });
  await track(tableCapability, 404);
  await prisma.hotel.update({ where: { id: hotelId }, data: { status: "ACTIVE" } });
  check(true, "inactive hotel tracking fails closed");

  const deletedCapability = secret();
  const deletedKey = randomUUID();
  await place(tableQr, deletedCapability, orderBody(deletedKey, true));
  const deleted = await prisma.orders.findUniqueOrThrow({ where: { hotel_id_idempotency_key: { hotel_id: hotelId, idempotency_key: deletedKey } } });
  await prisma.order_item.deleteMany({ where: { order_id: deleted.id } });
  await prisma.orders.delete({ where: { id: deleted.id } });
  await track(deletedCapability, 404);
  check(true, "deleted order tracking fails closed");

  const rotated = await rotateQrCode(hotelId, tableQr.id);
  check(rotated.code !== tableQr.code, "the legitimate QR rotation path changes the underlying QR token");
  const afterRotation = await track(tableCapability);
  check(afterRotation.payload.data.order.order_number === tableOrder.order_number, "QR rotation does not revoke an existing order tracking capability");

  const trackingHttpRequest = (localAddress, trackingCapability) => new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/api/public/order-tracking",
      method: "GET",
      localAddress,
      headers: { "X-Order-Tracking-Capability": trackingCapability },
    }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ response, payload: JSON.parse(body) }));
    });
    request.on("error", reject);
    request.end();
  });
  for (let index = 1; index <= 60; index++) {
    const limitedBoundary = await trackingHttpRequest("127.0.0.2", index % 2 ? tableCapability : secret());
    check(limitedBoundary.response.statusCode === (index % 2 ? 200 : 404), `tracking request ${index} is accepted before the 60-request boundary`);
  }
  const rateLimited = await trackingHttpRequest("127.0.0.2", tableCapability);
  check(rateLimited.response.statusCode === 429 && rateLimited.payload.error.code === "TRACKING_RATE_LIMITED", "tracking request 61 is rejected with the tracking-specific HTTP 429 contract");
  check(/^\d+$/.test(rateLimited.response.headers["retry-after"] || "") && Number(rateLimited.response.headers["retry-after"]) > 0, "tracking HTTP 429 includes a positive Retry-After value");
  const independentIp = await trackingHttpRequest("127.0.0.3", tableCapability);
  check(independentIp.response.statusCode === 200, "tracking limiter remains independently IP-based");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await deleteHotelFixtures(hotelIds);
  assert.deepEqual(await counts(), before, "Temporary public order tracking fixtures were not completely removed");
  await prisma.$disconnect();
}

console.log(`Public order tracking integration: ${checks}/${checks} passed`);
console.log(JSON.stringify({ countsBeforeAndAfter: before, cleanup: "all temporary tracking fixtures removed" }));
