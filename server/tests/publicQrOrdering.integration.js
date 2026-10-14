// Explicit local-only integration test. Every committed fixture is removed in finally.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";
import { deleteHotelFixtures } from "./helpers/hotelFixtureCleanup.js";
import { PUBLIC_ORDER_LIMITS } from "../config/publicOrderLimits.js";
import { prisma } from "../db/prisma.js";
import { publicOrderRateLimit } from "../middleware/publicOrderRateLimit.js";
import { createPublicQrOrder } from "../services/publicQrOrderService.js";
import { createAuthenticationToken } from "../services/tokenService.js";

const database = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && database.pathname === "/hms", "Public QR order tests are local hms only");

const models = ["hotel", "users", "user_role", "customer", "room", "room_booking", "dining_area", "dining_table", "menu_category", "menu_item", "qr_code", "orders", "order_item", "notification"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const hotelIds = [], userIds = [];
let server;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const secret = () => randomBytes(32).toString("base64url");
const hash = value => createHash("sha256").update(value, "utf8").digest("hex");

try {
  const hotelA = randomUUID(), hotelB = randomUUID(); hotelIds.push(hotelA, hotelB);
  await prisma.hotel.createMany({ data: [
  { id: hotelA, name: "Public Order Test A", status: "ACTIVE" },
  { id: hotelB, name: "Public Order Test B", status: "ACTIVE" },
  ].map(entitledHotelFixture) });
  const tokens = {}, actorIds = {};
  for (const roleName of ["Manager", "Captain", "Kitchen", "Reception"]) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    const userId = randomUUID(), userRoleId = randomUUID(); userIds.push(userId);
    await prisma.users.create({ data: { id: userId, name: `${roleName} QR test`, email: `${userId}@public-order.invalid`, password_hash: "not-a-login-secret" } });
    await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: role.id, hotel_id: hotelA } });
    tokens[roleName] = await createAuthenticationToken({ userId, userRoleId }, 900);
    actorIds[roleName] = userId;
  }

  const area = await prisma.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "Public Area", status: "active" } });
  const inactiveArea = await prisma.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "Inactive Public Area", status: "inactive" } });
  const table = await prisma.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelA, dining_area_id: area.id, table_number: "PUB-1", capacity: 4, status: "available" } });
  const captainTable = await prisma.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelA, dining_area_id: area.id, table_number: "PUB-CAPTAIN", capacity: 4, status: "available" } });
  const occupiedTable = await prisma.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelA, dining_area_id: area.id, table_number: "PUB-2", capacity: 4, status: "occupied" } });
  const inactiveTable = await prisma.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelA, dining_area_id: area.id, table_number: "PUB-3", capacity: 4, status: "inactive" } });
  const inactiveAreaTable = await prisma.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelA, dining_area_id: inactiveArea.id, table_number: "PUB-4", capacity: 4, status: "available" } });
  const otherArea = await prisma.dining_area.create({ data: { id: randomUUID(), hotel_id: hotelB, name: "Other Area", status: "active" } });
  const otherTable = await prisma.dining_table.create({ data: { id: randomUUID(), hotel_id: hotelB, dining_area_id: otherArea.id, table_number: "OTHER", capacity: 2, status: "available" } });

  const category = await prisma.menu_category.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "Public Menu", is_active: true } });
  const inactiveCategory = await prisma.menu_category.create({ data: { id: randomUUID(), hotel_id: hotelA, name: "Hidden Menu", is_active: false } });
  const item = await prisma.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelA, category_id: category.id, name: "Historical Public Item", price: "12.50", is_available: true } });
  const unavailableItem = await prisma.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelA, category_id: category.id, name: "Unavailable", price: "3.00", is_available: false } });
  const hiddenItem = await prisma.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelA, category_id: inactiveCategory.id, name: "Hidden", price: "4.00", is_available: true } });
  const otherItem = await prisma.menu_item.create({ data: { id: randomUUID(), hotel_id: hotelB, name: "Other Item", price: "99.00", is_available: true } });

  const activeRoom = await prisma.room.create({ data: { id: randomUUID(), hotel_id: hotelA, room_number: "PUB-R1", status: "active", base_price: "100.00" } });
  const secondRoom = await prisma.room.create({ data: { id: randomUUID(), hotel_id: hotelA, room_number: "PUB-R2", status: "active", base_price: "100.00" } });
  const inactiveRoom = await prisma.room.create({ data: { id: randomUUID(), hotel_id: hotelA, room_number: "PUB-R3", status: "inactive", base_price: "100.00" } });
  const dates = { booking_from: new Date(Date.now() - 86400000), booking_to: new Date(Date.now() + 86400000) };
  const capability = secret(), legacyCapability = secret(), inactiveCapability = secret();
  const booking = await prisma.room_booking.create({ data: { id: randomUUID(), hotel_id: hotelA, room_id: activeRoom.id, booking_number: `PUB-${randomUUID()}`, customer_name: "Canonical Room Guest", customer_phone: "111", customer_email: "room@example.invalid", status: "checked-in", payment_status: "pending", room_rate: "100.00", checked_in_at: new Date(), ordering_capability_hash: hash(capability), ordering_capability_created_at: new Date(), ...dates } });
  const legacyBooking = await prisma.room_booking.create({ data: { id: randomUUID(), hotel_id: hotelA, room_id: secondRoom.id, booking_number: `PUB-${randomUUID()}`, customer_name: "Legacy Room Guest", customer_phone: "222", status: "checked-in", payment_status: "pending", room_rate: "100.00", checked_in_at: new Date(), ordering_capability_hash: hash(legacyCapability), ordering_capability_created_at: new Date(), ...dates } });
  await prisma.room_booking.create({ data: { id: randomUUID(), hotel_id: hotelA, room_id: inactiveRoom.id, booking_number: `PUB-${randomUUID()}`, customer_name: "Inactive Room Guest", customer_phone: "333", status: "checked-in", payment_status: "pending", room_rate: "100.00", checked_in_at: new Date(), ordering_capability_hash: hash(inactiveCapability), ordering_capability_created_at: new Date(), ...dates } });

  const qr = async (type, target, active = true) => prisma.qr_code.create({ data: { id: randomUUID(), hotel_id: type === "other" ? hotelB : hotelA, code: secret(), type: type === "room" ? "room" : "dining_table", room_id: type === "room" ? target : null, dining_table_id: type === "room" ? null : target, is_active: active } });
  const roomQr = await qr("room", activeRoom.id), legacyRoomQr = await qr("room", secondRoom.id), inactiveRoomQr = await qr("room", inactiveRoom.id);
  const tableQr = await qr("table", table.id), occupiedQr = await qr("table", occupiedTable.id), inactiveTableQr = await qr("table", inactiveTable.id), inactiveAreaQr = await qr("table", inactiveAreaTable.id), otherQr = await qr("other", otherTable.id);
  // A target can have one QR, so deactivate/reactivate the table QR for that case.

  const externalOrigin = process.env.PUBLIC_QR_TEST_BASE_URL?.replace(/\/$/, "");
  if (!externalOrigin) {
    const listenPort = process.env.PUBLIC_QR_TEST_PORT ? Number.parseInt(process.env.PUBLIC_QR_TEST_PORT, 10) : 0;
    server = app.listen(listenPort, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  }
  const origin = externalOrigin || `http://127.0.0.1:${server.address().port}`;
  const trackingCapabilities = new Map();
  const trackingFor = key => {
    if (!trackingCapabilities.has(key)) trackingCapabilities.set(key, secret());
    return trackingCapabilities.get(key);
  };
  check(environment.trustedProxies.length ? typeof app.get("trust proxy fn") === "function" : app.get("trust proxy") === false, "proxy trust is disabled by default and configured only through explicit proxy addresses");
  const request = async (method, path, { body, headers = {}, role, expected = 201 } = {}) => {
    const trackingHeaders = method === "POST" && path.startsWith("/api/public/qr/") && path.endsWith("/orders") && body?.idempotency_key
      ? { "x-order-tracking-capability": trackingFor(body.idempotency_key) }
      : {};
    const response = await fetch(`${origin}${path}`, { method, headers: { "Content-Type": "application/json", ...(role ? { Cookie: `aazira_auth=${tokens[role]}` } : {}), ...trackingHeaders, ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const payload = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`); checks++;
    return payload;
  };
  const healthResponse = await fetch(`${origin}/api/health`);
  const health = await healthResponse.json();
  check(healthResponse.status === 200 && health.database === "connected", "live backend health is connected");
  const cacheProbe = await fetch(`${origin}/api/public/qr/${tableQr.code}`);
  const cachePayload = await cacheProbe.json();
  check(cacheProbe.headers.get("cache-control")?.includes("no-store") && cacheProbe.headers.get("pragma") === "no-cache", "public QR API responses explicitly prohibit intermediary and browser caching");
  check(cacheProbe.headers.get("content-security-policy")?.includes("default-src 'self'") && cacheProbe.headers.get("x-content-type-options") === "nosniff", "Helmet security headers remain active on public QR responses");
  check(cachePayload.data.hotel.timezone === "Asia/Kolkata", "public QR context exposes the hotel's established IANA timezone for presentation");
  const publicPath = code => `/api/public/qr/${code}/orders`;
  const base = key => ({ idempotency_key: key, items: [{ menu_item_id: item.id, quantity: 2, special_instructions: "No onion" }], notes: "Public order" });
  const createTrackedOrder = (code, roomCapability, body) => createPublicQrOrder(code, roomCapability, trackingFor(body.idempotency_key), body);

  await request("POST", publicPath(roomQr.code), { body: base(randomUUID()), expected: 403 });
  await request("POST", publicPath(roomQr.code), { body: base(randomUUID()), headers: { "x-room-capability": "malformed" }, expected: 403 });
  await request("POST", publicPath(roomQr.code), { body: base(randomUUID()), headers: { "x-room-capability": legacyCapability }, expected: 403 });
  check(true, "room capabilities are mandatory and room-specific");

  const notificationsBeforeRejectedRoomOrder = await prisma.notification.count({ where: { hotel_id: hotelA } });
  await request("POST", publicPath(roomQr.code), { body: { ...base(randomUUID()), items: [{ menu_item_id: item.id, quantity: 0 }] }, headers: { "x-room-capability": capability }, expected: 400 });
  check(await prisma.notification.count({ where: { hotel_id: hotelA } }) === notificationsBeforeRejectedRoomOrder, "failed room QR order validation creates no false Kitchen or other notification");

  const roomKey = randomUUID();
  const roomResult = await request("POST", publicPath(roomQr.code), { body: base(roomKey), headers: { "x-room-capability": capability } });
  const roomOrder = roomResult.data.order;
  check(roomOrder.source === "room_qr" && roomOrder.target.room_number === activeRoom.room_number, "room context is server-derived");
  check(roomOrder.total_amount === "25.00" && roomOrder.items[0].unit_price === "12.50" && roomOrder.items[0].item_name === item.name && roomOrder.status === "pending" && roomOrder.items[0].status === "pending", "price, snapshot, totals, and initial statuses are authoritative");
  const serializedRoomResult = JSON.stringify(roomResult);
  check(!serializedRoomResult.includes(booking.id) && !serializedRoomResult.includes(roomOrder.id || "never") && !serializedRoomResult.includes(booking.customer_name) && !serializedRoomResult.includes(item.id), "public confirmation omits customer name and internal order, booking, and menu-item IDs");
  const replay = await request("POST", publicPath(roomQr.code), { body: base(roomKey), headers: { "x-room-capability": capability } });
  assert.equal(replay.data.order.order_number, roomOrder.order_number); checks++;
  await request("POST", publicPath(roomQr.code), { body: { ...base(roomKey), notes: "different" }, headers: { "x-room-capability": capability }, expected: 409 });
  check(await prisma.orders.count({ where: { hotel_id: hotelA, idempotency_key: roomKey } }) === 1, "idempotency persists one order");
  const storedRoomOrder = await prisma.orders.findUniqueOrThrow({ where: { hotel_id_idempotency_key: { hotel_id: hotelA, idempotency_key: roomKey } } });
  const roomReceptionNotification = await prisma.notification.findMany({ where: { hotel_id: hotelA, user_id: actorIds.Reception, event_key: `room-order-created:${storedRoomOrder.id}`, type: "room_order" } });
  check(roomReceptionNotification.length === 1, "room QR order preserves the same-hotel Reception notification exactly once");
  const roomKitchenNotification = await prisma.notification.findMany({ where: { hotel_id: hotelA, user_id: actorIds.Kitchen, event_key: `kitchen-room-order-created:${storedRoomOrder.id}`, type: "room_order" } });
  check(roomKitchenNotification.length === 1 && roomKitchenNotification[0].title === "New Room-Service Order" && roomKitchenNotification[0].message.includes(storedRoomOrder.order_number) && roomKitchenNotification[0].message.includes(activeRoom.room_number), "room QR order notifies the same-hotel Kitchen user with operational order and room context exactly once");
  const serializedRoomKitchenNotification = JSON.stringify(roomKitchenNotification);
  check(!serializedRoomKitchenNotification.includes(capability) && !serializedRoomKitchenNotification.includes(trackingFor(roomKey)) && !serializedRoomKitchenNotification.includes(booking.customer_name) && !serializedRoomKitchenNotification.includes(booking.customer_phone), "room QR Kitchen notification excludes room/tracking capabilities, internal secrets, and unnecessary customer PII");
  check(await prisma.notification.count({ where: { hotel_id: hotelA, user_id: actorIds.Manager, event_key: `manager-order-created:${storedRoomOrder.id}`, type: "manager_operational" } }) === 1, "room QR order notifies the same-hotel Manager exactly once");

  const legacyResult = await request("POST", publicPath(legacyRoomQr.code), { body: base(randomUUID()), headers: { "x-room-capability": legacyCapability } });
  const legacyStored = await prisma.orders.findUnique({ where: { hotel_id_order_number: { hotel_id: hotelA, order_number: legacyResult.data.order.order_number } } });
  check(legacyStored.customer_id === null && legacyStored.customer_name === legacyBooking.customer_name, "legacy room booking remains snapshot-only");
  const notificationsBeforeInactiveRoomOrder = await prisma.notification.count({ where: { hotel_id: hotelA } });
  await request("POST", publicPath(inactiveRoomQr.code), { body: base(randomUUID()), headers: { "x-room-capability": inactiveCapability }, expected: 403 });
  check(await prisma.notification.count({ where: { hotel_id: hotelA } }) === notificationsBeforeInactiveRoomOrder, "rejected inactive room QR order creates no false Kitchen or other notification");

  const tableBody = (key, overrides = {}) => ({ ...base(key), customer_name: "Submitted Guest", customer_phone: "555", customer_email: "guest@example.invalid", ...overrides });
  const ordersBeforeInvalidEmail = await prisma.orders.count({ where: { hotel_id: hotelA } });
  const invalidEmail = await request("POST", publicPath(tableQr.code), { body: tableBody(randomUUID(), { customer_email: "not-an-email" }), expected: 400 });
  check(invalidEmail.error.code === "INVALID_PUBLIC_ORDER_CUSTOMER", "direct API submissions reject malformed optional customer email with the established validation contract");
  await assert.rejects(
    createTrackedOrder(tableQr.code, undefined, tableBody(randomUUID(), { customer_email: `${"a".repeat(250)}@example.invalid` })),
    error => error?.statusCode === 400,
  );
  checks++;
  check(await prisma.orders.count({ where: { hotel_id: hotelA } }) === ordersBeforeInvalidEmail, "rejected email submissions persist no order");
  const withoutEmail = tableBody(randomUUID());
  delete withoutEmail.customer_email;
  const tableResult = await request("POST", publicPath(tableQr.code), { body: withoutEmail });
  check(typeof tableResult.data.order.order_number === "string" && tableResult.data.order.order_number.length > 0, "optional customer email may be omitted without changing successful table ordering");
  const serializedTableResult = JSON.stringify(tableResult);
  check(!serializedTableResult.includes("Submitted Guest") && !serializedTableResult.includes(item.id) && !Object.hasOwn(tableResult.data.order, "customer_name") && !Object.hasOwn(tableResult.data.order.items[0], "menu_item_id"), "table confirmation omits unused customer name and confirmation-only menu-item IDs");
  const tableOrder = await prisma.orders.findUniqueOrThrow({ where: { hotel_id_order_number: { hotel_id: hotelA, order_number: tableResult.data.order.order_number } }, include: { order_item: true } });
  check(tableOrder.source === "dining_table_qr" && tableOrder.table_id === table.id && tableOrder.hotel_id === hotelA && tableOrder.captain_id === null, "table target and source are server-derived");
  const tableNotification = await prisma.notification.findMany({ where: { hotel_id: hotelA, event_key: `captain-table-order-created:${tableOrder.id}` } });
  check(tableNotification.length === 1 && tableNotification[0].user_id === actorIds.Captain && tableNotification[0].title === "New Table QR Order" && tableNotification[0].message.includes(tableOrder.order_number), "dining-table QR order notifies the same-hotel Captain user exactly once");
  check(await prisma.notification.count({ where: { hotel_id: hotelA, user_id: actorIds.Kitchen, event_key: `restaurant-order-created:${tableOrder.id}` } }) === 0, "dining-table QR creation does not notify Kitchen before Captain handoff");
  const tableManagerNotification = await prisma.notification.findMany({ where: { hotel_id: hotelA, event_key: `manager-order-created:${tableOrder.id}` } });
  check(tableManagerNotification.length === 1 && tableManagerNotification[0].user_id === actorIds.Manager && tableManagerNotification[0].type === "manager_operational" && tableManagerNotification[0].title === "New Order" && tableManagerNotification[0].message.includes(tableOrder.order_number), "dining-table QR order notifies the same-hotel Manager exactly once");
  check((await prisma.dining_table.findUnique({ where: { id: table.id } })).status === "occupied", "public table order marks the table occupied");
  await request("POST", publicPath(tableQr.code), { body: tableBody(randomUUID(), { customer_name: "Second Table Guest", customer_phone: "556" }) });
  await prisma.menu_item.update({ where: { id: item.id }, data: { name: "Renamed Current Item", price: "88.00" } });
  check(tableOrder.order_item[0].item_name === "Historical Public Item" && String(tableOrder.order_item[0].unit_price) === "12.5", "historical item name and price snapshots are immutable");
  await prisma.menu_item.update({ where: { id: item.id }, data: { name: "Historical Public Item", price: "12.50" } });

  const existingCustomer = await prisma.customer.findUniqueOrThrow({ where: { hotel_id_phone: { hotel_id: hotelA, phone: "555" } } });
  await request("POST", publicPath(occupiedQr.code), { body: tableBody(randomUUID(), { customer_name: "Attempted overwrite", customer_email: "changed@example.invalid" }) });
  const unchanged = await prisma.customer.findUniqueOrThrow({ where: { id: existingCustomer.id } });
  check(unchanged.first_name === existingCustomer.first_name && unchanged.email === existingCustomer.email, "occupied tables remain orderable and existing customer profiles are not overwritten");

  const concurrentKey = randomUUID(), concurrentBody = tableBody(concurrentKey, { customer_phone: "777" });
  const concurrent = await Promise.all([1, 2, 3].map(() => request("POST", publicPath(occupiedQr.code), { body: concurrentBody })));
  check(new Set(concurrent.map(result => result.data.order.order_number)).size === 1, "concurrent identical submissions return one order");
  check(await prisma.orders.count({ where: { hotel_id: hotelA, idempotency_key: concurrentKey } }) === 1, "concurrent idempotency is database-backed");
  const concurrentOrder = await prisma.orders.findUniqueOrThrow({ where: { hotel_id_idempotency_key: { hotel_id: hotelA, idempotency_key: concurrentKey } } });
  check(await prisma.notification.count({ where: { hotel_id: hotelA, user_id: actorIds.Captain, event_key: `captain-table-order-created:${concurrentOrder.id}` } }) === 1, "concurrent dining-table QR retries emit one Captain notification");
  check(await prisma.notification.count({ where: { hotel_id: hotelA, user_id: actorIds.Manager, event_key: `manager-order-created:${concurrentOrder.id}` } }) === 1, "concurrent dining-table QR retries emit one Manager notification");
  await Promise.all([1, 2, 3].map(() => request("POST", `/api/hotels/${hotelA}/captain/orders/${concurrentOrder.id}/kitchen-handoff`, { role: "Captain", body: {}, expected: 200 })));
  check((await prisma.orders.findUniqueOrThrow({ where: { id: concurrentOrder.id } })).captain_id === actorIds.Captain, "concurrent Captain handoff attempts converge on one authenticated Captain assignment");
  check(await prisma.notification.count({ where: { hotel_id: hotelA, user_id: actorIds.Kitchen, event_key: `restaurant-order-created:${concurrentOrder.id}` } }) === 1, "concurrent Captain handoff attempts emit one Kitchen notification");

  const customerRequests = ["A", "B"].map(name => request("POST", publicPath(occupiedQr.code), { body: tableBody(randomUUID(), { customer_name: name, customer_phone: "888", customer_email: null }) }));
  const customerOrders = await Promise.all(customerRequests);
  check(await prisma.customer.count({ where: { hotel_id: hotelA, phone: "888" } }) === 1, "concurrent first-order customer creation yields one customer");

  for (const bad of [
    { body: tableBody(randomUUID(), { price: "0" }), status: 400 },
    { body: tableBody(randomUUID(), { items: [{ menu_item_id: item.id, quantity: 0 }] }), status: 400 },
    { body: tableBody(randomUUID(), { items: [{ menu_item_id: item.id, quantity: 1.5 }] }), status: 400 },
    { body: tableBody(randomUUID(), { items: [{ menu_item_id: item.id, quantity: "1" }] }), status: 400 },
    { body: tableBody(randomUUID(), { items: [{ menu_item_id: item.id, quantity: 1 }, { menu_item_id: item.id, quantity: 1 }] }), status: 400 },
    { body: tableBody(randomUUID(), { items: [{ menu_item_id: unavailableItem.id, quantity: 1 }] }), status: 404 },
    { body: tableBody(randomUUID(), { items: [{ menu_item_id: hiddenItem.id, quantity: 1 }] }), status: 404 },
    { body: tableBody(randomUUID(), { items: [{ menu_item_id: otherItem.id, quantity: 1 }] }), status: 404 },
  ]) await request("POST", publicPath(occupiedQr.code), { body: bad.body, expected: bad.status });
  await assert.rejects(
    createTrackedOrder(occupiedQr.code, undefined, tableBody(randomUUID(), { customer_name: "" })),
    error => error?.statusCode === 400 && error?.code === "INVALID_PUBLIC_ORDER_CUSTOMER",
  );
  checks++;
  await request("POST", publicPath(inactiveTableQr.code), { body: tableBody(randomUUID()), expected: 409 });
  await request("POST", publicPath(inactiveAreaQr.code), { body: tableBody(randomUUID()), expected: 409 });
  await request("POST", publicPath(otherQr.code), { body: tableBody(randomUUID(), { items: [{ menu_item_id: item.id, quantity: 1 }] }), expected: 404 });
  await prisma.qr_code.update({ where: { id: tableQr.id }, data: { is_active: false } });
  await request("POST", publicPath(tableQr.code), { body: tableBody(randomUUID()), expected: 404 });
  await prisma.qr_code.update({ where: { id: tableQr.id }, data: { is_active: true } });

  const boundedMenuItems = Array.from({ length: PUBLIC_ORDER_LIMITS.maxUniqueLines - 1 }, (_, index) => ({
    id: randomUUID(), hotel_id: hotelA, category_id: category.id, name: `Bounded item ${index + 1}`,
    price: index < 2 ? "99999999.99" : "1.00", is_available: true,
  }));
  await prisma.menu_item.createMany({ data: boundedMenuItems });
  const maxQuantityBody = tableBody(randomUUID(), {
    customer_phone: "max-quantity",
    items: [{ menu_item_id: item.id, quantity: PUBLIC_ORDER_LIMITS.maxQuantityPerLine }],
  });
  const maxQuantity = await createTrackedOrder(tableQr.code, undefined, maxQuantityBody);
  check(maxQuantity.items[0].quantity === PUBLIC_ORDER_LIMITS.maxQuantityPerLine, "maximum public line quantity is accepted");
  const maxLinesBody = tableBody(randomUUID(), {
    customer_phone: "max-lines",
    items: [item, ...boundedMenuItems].map(menuItem => ({ menu_item_id: menuItem.id, quantity: 1 })),
  });
  const maxLines = await createTrackedOrder(tableQr.code, undefined, maxLinesBody);
  check(maxLines.items.length === PUBLIC_ORDER_LIMITS.maxUniqueLines, "maximum unique public order line count is accepted");

  const invalidResourceBaseline = {
    customers: await prisma.customer.count({ where: { hotel_id: hotelA } }),
    notifications: await prisma.notification.count({ where: { hotel_id: hotelA } }),
    orders: await prisma.orders.count({ where: { hotel_id: hotelA } }),
  };
  const rejectsResourceInput = async (items, code) => {
    await assert.rejects(
      (() => { const body = tableBody(randomUUID(), { customer_phone: "resource-check", items }); return createTrackedOrder(tableQr.code, undefined, body); })(),
      error => error?.statusCode === 400 && error?.code === code,
    );
    checks++;
  };
  await rejectsResourceInput([{ menu_item_id: item.id, quantity: PUBLIC_ORDER_LIMITS.maxQuantityPerLine + 1 }], "PUBLIC_ORDER_QUANTITY_LIMIT_EXCEEDED");
  await rejectsResourceInput([{ menu_item_id: item.id, quantity: 0 }], "PUBLIC_ORDER_QUANTITY_LIMIT_EXCEEDED");
  await rejectsResourceInput([{ menu_item_id: item.id, quantity: -1 }], "PUBLIC_ORDER_QUANTITY_LIMIT_EXCEEDED");
  await rejectsResourceInput([{ menu_item_id: item.id, quantity: 1.5 }], "PUBLIC_ORDER_QUANTITY_LIMIT_EXCEEDED");
  await rejectsResourceInput([{ menu_item_id: item.id, quantity: Number.MAX_SAFE_INTEGER + 1 }], "PUBLIC_ORDER_QUANTITY_LIMIT_EXCEEDED");
  await rejectsResourceInput([{ menu_item_id: item.id, quantity: Number.MAX_VALUE }], "PUBLIC_ORDER_QUANTITY_LIMIT_EXCEEDED");
  await rejectsResourceInput(Array.from({ length: PUBLIC_ORDER_LIMITS.maxUniqueLines + 1 }, () => ({ menu_item_id: randomUUID(), quantity: 1 })), "PUBLIC_ORDER_LINE_LIMIT_EXCEEDED");
  await rejectsResourceInput(Array.from({ length: 1000 }, () => ({ menu_item_id: randomUUID(), quantity: 1 })), "PUBLIC_ORDER_LINE_LIMIT_EXCEEDED");
  await rejectsResourceInput(boundedMenuItems.slice(0, 2).map(menuItem => ({ menu_item_id: menuItem.id, quantity: PUBLIC_ORDER_LIMITS.maxQuantityPerLine })), "PUBLIC_ORDER_TOTAL_LIMIT_EXCEEDED");
  check(JSON.stringify({
    customers: await prisma.customer.count({ where: { hotel_id: hotelA } }),
    notifications: await prisma.notification.count({ where: { hotel_id: hotelA } }),
    orders: await prisma.orders.count({ where: { hotel_id: hotelA } }),
  }) === JSON.stringify(invalidResourceBaseline), "rejected resource-amplifying input creates no customer, order, or notification");

  { const body = tableBody(randomUUID(), { items: [{ menu_item_id: item.id, quantity: -1 }] }); await assert.rejects(createTrackedOrder(tableQr.code, undefined, body), error => error?.statusCode === 400); checks++; }
  { const body = tableBody(randomUUID(), { items: [{ menu_item_id: randomUUID(), quantity: 1 }] }); await assert.rejects(createTrackedOrder(tableQr.code, undefined, body), error => error?.statusCode === 404); checks++; }
  { const body = tableBody(randomUUID(), { notes: "x".repeat(10001) }); await assert.rejects(createTrackedOrder(tableQr.code, undefined, body), error => error?.statusCode === 400); checks++; }
  const captainIntakeNotifications = await prisma.notification.findMany({ where: { hotel_id: hotelA, event_key: { startsWith: "captain-table-order-created:" } } });
  check(captainIntakeNotifications.length > 0 && captainIntakeNotifications.every(row => row.user_id === actorIds.Captain), "table QR intake notifications remain scoped to Captain");

  const captainWorkspace = await request("GET", `/api/hotels/${hotelA}/captain/workspace`, { role: "Captain", expected: 200 });
  check(captainWorkspace.data.orders.some(order => order.order_number === tableOrder.order_number && order.source === "dining_table_qr"), "Captain workspace includes public table orders");
  check(captainWorkspace.data.areas.flatMap(row => row.tables).find(row => row.id === table.id).status === "occupied", "Captain occupancy includes public table orders");
  const kitchenBeforeHandoff = await request("GET", `/api/hotels/${hotelA}/kitchen/orders`, { role: "Kitchen", expected: 200 });
  check(!kitchenBeforeHandoff.data.orders.some(order => order.order_number === tableOrder.order_number), "Kitchen does not receive an unassigned Table QR order");
  await request("PATCH", `/api/hotels/${hotelA}/kitchen/orders/${tableOrder.id}/status`, { role: "Kitchen", body: { status: "preparing" }, expected: 404 });
  const prematureManage = await request("PATCH", `/api/hotels/${hotelA}/captain/orders/${tableOrder.id}`, { role: "Captain", body: { status: "preparing" }, expected: 409 });
  check(prematureManage.error.code === "TABLE_QR_HANDOFF_REQUIRED", "Table QR order cannot bypass Captain handoff through direct management");

  await prisma.user_role.updateMany({ where: { hotel_id: hotelA, user_id: actorIds.Captain }, data: { status: "INACTIVE" } });
  await request("POST", `/api/hotels/${hotelA}/captain/orders/${tableOrder.id}/kitchen-handoff`, { role: "Captain", body: {}, expected: 401 });
  check((await prisma.orders.findUniqueOrThrow({ where: { id: tableOrder.id } })).captain_id === null && await prisma.notification.count({ where: { hotel_id: hotelA, user_id: actorIds.Kitchen, event_key: `restaurant-order-created:${tableOrder.id}` } }) === 0, "inactive Captain assignment cannot hand off or partially mutate a Table QR order");
  await prisma.user_role.updateMany({ where: { hotel_id: hotelA, user_id: actorIds.Captain }, data: { status: "ACTIVE" } });

  const captainRole = await prisma.role.findUniqueOrThrow({ where: { name: "Captain" } });
  const secondCaptainId = randomUUID(), secondCaptainAssignment = randomUUID(); userIds.push(secondCaptainId);
  await prisma.users.create({ data: { id: secondCaptainId, name: "Second Captain QR test", email: `${secondCaptainId}@public-order.invalid`, password_hash: "not-a-login-secret" } });
  await prisma.user_role.create({ data: { id: secondCaptainAssignment, user_id: secondCaptainId, role_id: captainRole.id, hotel_id: hotelA } });
  tokens.CaptainTwo = await createAuthenticationToken({ userId: secondCaptainId, userRoleId: secondCaptainAssignment }, 900);
  actorIds.CaptainTwo = secondCaptainId;
  const handoffAttempt = async role => {
    const response = await fetch(`${origin}/api/hotels/${hotelA}/captain/orders/${tableOrder.id}/kitchen-handoff`, { method: "POST", headers: { Cookie: `aazira_auth=${tokens[role]}`, "Content-Type": "application/json" }, body: "{}" });
    return { status: response.status, payload: await response.json() };
  };
  const competingHandoffs = await Promise.all([handoffAttempt("Captain"), handoffAttempt("CaptainTwo")]);
  check(competingHandoffs.map(result => result.status).sort().join(",") === "200,409", "competing Captains cannot both claim the same Table QR order");
  const assignedTableOrder = await prisma.orders.findUniqueOrThrow({ where: { id: tableOrder.id } });
  check([actorIds.Captain, actorIds.CaptainTwo].includes(assignedTableOrder.captain_id), "Captain handoff atomically assigns the Table QR order to exactly one authenticated Captain");
  check(await prisma.notification.count({ where: { hotel_id: hotelA, user_id: actorIds.Kitchen, event_key: `restaurant-order-created:${tableOrder.id}` } }) === 1, "Captain handoff notifies Kitchen exactly once across idempotent retries");
  const assignedCaptainRole = assignedTableOrder.captain_id === actorIds.Captain ? "Captain" : "CaptainTwo";
  await request("POST", `/api/hotels/${hotelA}/captain/orders/${tableOrder.id}/kitchen-handoff`, { role: assignedCaptainRole, body: {}, expected: 200 });
  await request("POST", `/api/hotels/${hotelA}/captain/orders/${tableOrder.id}/kitchen-handoff`, { role: "Manager", body: {}, expected: 403 });
  await request("POST", `/api/hotels/${hotelB}/captain/orders/${tableOrder.id}/kitchen-handoff`, { role: "Captain", body: {}, expected: 403 });

  const captainManaged = await prisma.orders.findUniqueOrThrow({ where: { hotel_id_order_number: { hotel_id: hotelA, order_number: customerOrders[0].data.order.order_number } } });
  await request("POST", `/api/hotels/${hotelA}/captain/orders/${captainManaged.id}/kitchen-handoff`, { role: "Captain", body: {}, expected: 200 });
  await request("PATCH", `/api/hotels/${hotelA}/captain/orders/${captainManaged.id}`, { role: "Captain", body: { status: "preparing" }, expected: 200 });
  const captainDeleted = await prisma.orders.findUniqueOrThrow({ where: { hotel_id_order_number: { hotel_id: hotelA, order_number: customerOrders[1].data.order.order_number } } });
  await request("DELETE", `/api/hotels/${hotelA}/captain/orders/${captainDeleted.id}`, { role: "Captain", expected: 200 });
  check(await prisma.orders.findUnique({ where: { id: captainDeleted.id } }) === null, "Captain management updates handed-off orders and may delete a pending public table order by internal ID");
  const kitchen = await request("GET", `/api/hotels/${hotelA}/kitchen/orders`, { role: "Kitchen", expected: 200 });
  check(kitchen.data.orders.some(order => order.order_number === tableOrder.order_number), "Kitchen includes Table QR orders only after Captain handoff");

  await request("PATCH", `/api/hotels/${hotelA}/kitchen/orders/${tableOrder.id}/status`, { role: "Kitchen", body: { status: "preparing" }, expected: 200 });
  await request("PATCH", `/api/hotels/${hotelA}/kitchen/orders/${tableOrder.id}/status`, { role: "Kitchen", body: { status: "pending" }, expected: 400 });
  await request("PATCH", `/api/hotels/${hotelA}/kitchen/orders/${tableOrder.id}/status`, { role: "Kitchen", body: { status: "ready" }, expected: 200 });
  check(await prisma.notification.count({ where: { hotel_id: hotelA, user_id: assignedTableOrder.captain_id, event_key: `restaurant-order-ready:${tableOrder.id}` } }) === 1, "assigned Captain receives the existing ready notification exactly once");
  await request("PATCH", `/api/hotels/${hotelA}/kitchen/orders/${tableOrder.id}/status`, { role: "Kitchen", body: { status: "completed" }, expected: 200 });
  check((await prisma.dining_table.findUnique({ where: { id: table.id } })).status === "occupied", "completing one order preserves occupancy while another restaurant order is active");
  for (const body of [
    { items: [{ menu_item_id: item.id, quantity: 2, special_instructions: "Changed after completion" }] },
    { notes: "Changed after completion" },
  ]) {
    const result = await request("PATCH", `/api/hotels/${hotelA}/captain/orders/${tableOrder.id}`, { role: "Captain", body, expected: 409 });
    check(result.error.code === "RESTAURANT_ORDER_IMMUTABLE", "completed dining-table QR order mutation is rejected deterministically");
  }
  const completedQrDelete = await request("DELETE", `/api/hotels/${hotelA}/captain/orders/${tableOrder.id}`, { role: "Captain", expected: 409 });
  check(completedQrDelete.error.code === "RESTAURANT_ORDER_IMMUTABLE", "completed dining-table QR order deletion is rejected deterministically");

  const captainCreated = await request("POST", `/api/hotels/${hotelA}/captain/orders`, { role: "Captain", body: {
    table_id: captainTable.id, customer_name: "Lifecycle Guest", customer_phone: "lifecycle",
    items: [{ menu_item_id: item.id, quantity: 1, special_instructions: "Initial" }], notes: "Pending note",
  } });
  const captainOrder = captainCreated.data.order;
  await request("PATCH", `/api/hotels/${hotelA}/captain/orders/${captainOrder.id}`, { role: "Captain", body: { items: [{ menu_item_id: item.id, quantity: 2, special_instructions: "Pending edit" }], notes: "Pending edit" }, expected: 200 });
  await request("PATCH", `/api/hotels/${hotelA}/captain/orders/${captainOrder.id}`, { role: "Captain", body: { status: "preparing" }, expected: 200 });
  await request("PATCH", `/api/hotels/${hotelA}/captain/orders/${captainOrder.id}`, { role: "Captain", body: { notes: "Preparing edit" }, expected: 200 });
  await request("PATCH", `/api/hotels/${hotelA}/captain/orders/${captainOrder.id}`, { role: "Captain", body: { status: "ready" }, expected: 200 });
  await request("PATCH", `/api/hotels/${hotelA}/captain/orders/${captainOrder.id}`, { role: "Captain", body: { notes: "Ready edit" }, expected: 200 });
  await request("PATCH", `/api/hotels/${hotelA}/captain/orders/${captainOrder.id}`, { role: "Captain", body: { status: "completed" }, expected: 200 });
  for (const body of [
    { items: [{ menu_item_id: item.id, quantity: 1, special_instructions: "Forbidden" }] },
    { notes: "Forbidden" },
  ]) {
    const result = await request("PATCH", `/api/hotels/${hotelA}/captain/orders/${captainOrder.id}`, { role: "Captain", body, expected: 409 });
    check(result.error.code === "RESTAURANT_ORDER_IMMUTABLE", "completed Captain order mutation is rejected deterministically");
  }
  const completedCaptainDelete = await request("DELETE", `/api/hotels/${hotelA}/captain/orders/${captainOrder.id}`, { role: "Captain", expected: 409 });
  check(completedCaptainDelete.error.code === "RESTAURANT_ORDER_IMMUTABLE", "completed Captain order deletion is rejected deterministically");
  await request("PATCH", `/api/hotels/${hotelA}/captain/orders/${captainOrder.id}`, { role: "Manager", body: { notes: "Unauthorized" }, expected: 403 });
  await request("PATCH", `/api/hotels/${hotelB}/captain/orders/${captainOrder.id}`, { role: "Captain", body: { notes: "Cross hotel" }, expected: 403 });
  const storedCompleted = await prisma.orders.findUniqueOrThrow({ where: { id: captainOrder.id }, include: { order_item: true } });
  check(storedCompleted.status === "completed" && storedCompleted.notes === "Ready edit" && storedCompleted.order_item[0].quantity === 2, "completed order data remains unchanged after rejected direct API mutations");

  await request("PATCH", `/api/hotels/${hotelA}/captain/orders/${concurrent[0].data.order.order_number}`, { role: "Captain", body: { status: "preparing" }, expected: 400 });
  await request("PUT", publicPath(tableQr.code), { body: tableBody(randomUUID()), expected: 404 });
  await request("DELETE", publicPath(tableQr.code), { expected: 404 });
  const untrusted = await request("POST", publicPath(tableQr.code), { body: tableBody(randomUUID()), headers: { Origin: "https://evil.invalid" }, expected: 403 });
  check(untrusted.error.code === "UNTRUSTED_ORIGIN", "untrusted browser origins are rejected");

  const limiterIp = `integration-${randomUUID()}`;
  let rateError;
  for (let index = 0; index < 31; index++) publicOrderRateLimit({ ip: limiterIp, socket: {} }, {}, error => { if (error) rateError = error; });
  check(rateError?.statusCode === 429 && rateError?.code === "PUBLIC_ORDER_RATE_LIMITED", "mutation limiter enforces 30 requests per IP per minute independently");

  await assert.rejects(prisma.orders.create({ data: { id: randomUUID(), hotel_id: hotelA, order_number: `BAD-${randomUUID()}`, source: "dining_table_qr", room_booking_id: booking.id, customer_name: "Bad", customer_phone: "0", status: "pending", subtotal: "0", total_amount: "0", payment_status: "pending" } }), /constraint|violat/i); checks++;
  await assert.rejects(prisma.orders.create({ data: { id: randomUUID(), hotel_id: hotelA, order_number: `BAD-${randomUUID()}`, source: "captain", table_id: table.id, customer_name: "Bad", customer_phone: "0", status: "pending", subtotal: "0", total_amount: "0", payment_status: "pending", idempotency_key: randomUUID() } }), /constraint|violat/i); checks++;
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (hotelIds.length) {
    await prisma.notification.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await prisma.order_item.deleteMany({ where: { orders: { hotel_id: { in: hotelIds } } } });
    await prisma.orders.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await prisma.qr_code.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await prisma.room_booking.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await prisma.customer.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await prisma.menu_item.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await prisma.menu_category.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await prisma.dining_table.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await prisma.dining_area.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await prisma.room.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await prisma.user_role.deleteMany({ where: { hotel_id: { in: hotelIds } } });
  }
  if (userIds.length) await prisma.users.deleteMany({ where: { id: { in: userIds } } });
  await deleteHotelFixtures(hotelIds);
  assert.deepEqual(await counts(), before, "Temporary public QR order fixtures were not completely removed");
  await prisma.$disconnect();
}

console.log(`Public QR ordering integration: ${checks}/${checks} passed`);
console.log(JSON.stringify({ countsBeforeAndAfter: before, cleanup: "all temporary fixtures removed" }));
