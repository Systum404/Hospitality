// Explicit local-only integration test. Fixtures are isolated and removed in finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import pg from "pg";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";
import { deleteHotelFixtures } from "./helpers/hotelFixtureCleanup.js";

const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Local hms only");

const { Client } = pg;
const models = ["hotel", "users", "user_role", "menu_item", "discount", "discount_menu_item", "orders", "order_item"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async (name) => [name, await prisma[name].count()])));
const fixture = { hotelIds: [], userIds: [] };
const before = await counts();
const existingMenuItems = await prisma.menu_item.findMany({ orderBy: { id: "asc" } });
const existingDiscounts = await prisma.discount.findMany({ orderBy: { id: "asc" } });
const existingItemMappings = await prisma.discount_menu_item.findMany({ orderBy: [{ discount_id: "asc" }, { menu_item_id: "asc" }] });
const results = [];
const pass = (name) => results.push(name);
let server;

try {
  const hotelA = randomUUID();
  const hotelB = randomUUID();
  fixture.hotelIds.push(hotelA, hotelB);
  await prisma.hotel.createMany({
    data: [
    { id: hotelA, name: `Menu item test A ${hotelA}`, status: "ACTIVE" },
    { id: hotelB, name: `Menu item test B ${hotelB}`, status: "ACTIVE" },
    ].map(entitledHotelFixture),
  });

  const roles = Object.fromEntries(await Promise.all(
    ["Admin", "Manager", "Reception"].map(async (name) => [name, await prisma.role.findUniqueOrThrow({ where: { name } })]),
  ));
  const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
  const tokens = {};
  const addUser = async (role, hotelId) => {
    const userId = randomUUID();
    const userRoleId = randomUUID();
    fixture.userIds.push(userId);
    await prisma.users.create({
      data: { id: userId, name: `${role} menu test`, email: `${userId}@menu-item-test.invalid`, password_hash: passwordHash },
    });
    await prisma.user_role.create({
      data: { id: userRoleId, user_id: userId, role_id: roles[role].id, hotel_id: hotelId },
    });
    tokens[`${role}:${hotelId}`] = await createAuthenticationToken({ userId, userRoleId }, 600);
  };
  await addUser("Admin", hotelA);
  await addUser("Admin", hotelB);
  await addUser("Manager", hotelA);
  await addUser("Reception", hotelA);

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, hotelId, path, { body, role = "Admin", tokenHotel = hotelId, expected = 200 } = {}) => {
    const token = role ? tokens[`${role}:${tokenHotel}`] : null;
    const response = await fetch(`${origin}/api/hotels/${hotelId}${path}`, {
      method,
      headers: {
        ...(token ? { Cookie: `aazira_auth=${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
    return payload;
  };
  const createItem = async (label) => (await request("POST", hotelA, "/menu-items", {
    body: { name: `Menu item ${label} ${randomUUID()}`, price: "25.00", is_available: true },
    expected: 201,
  })).data.menu_item;
  const createDiscount = async (itemId, { active = true, type = "percentage" } = {}) => prisma.discount.create({
    data: {
      id: randomUUID(),
      hotel_id: hotelA,
      name: `Menu item discount ${randomUUID()}`,
      description: "must remain unchanged",
      discount_type: type,
      discount_value: type === "percentage" ? "10.00" : "25.00",
      applicable_on: "specific_items",
      end_date: new Date("2099-12-31T00:00:00.000Z"),
      is_active: active,
      discount_menu_item: { create: { menu_item_id: itemId } },
    },
  });

  const negativeCount = await prisma.menu_item.count({ where: { hotel_id: hotelA } });
  for (const price of ["-1", "-1.00", "-0.01"]) {
    const payload = await request("POST", hotelA, "/menu-items", {
      body: { name: `Rejected ${price}`, price },
      expected: 400,
    });
    assert.equal(payload.error.code, "INVALID_MENU_ITEM");
  }
  assert.equal(await prisma.menu_item.count({ where: { hotel_id: hotelA } }), negativeCount);
  pass("negative prices on create return 400 INVALID_MENU_ITEM and create no rows");

  const created = [];
  for (const price of ["1", "1.00", "10.50", "99999999.99", "+1.00"]) {
    const payload = await request("POST", hotelA, "/menu-items", {
      body: { name: `Accepted ${price} ${randomUUID()}`, price, is_available: true },
      expected: 201,
    });
    created.push(payload.data.menu_item);
  }
  assert.deepEqual(created.map((item) => item.price), ["1.00", "1.00", "10.50", "99999999.99", "1.00"]);
  pass("all previously accepted positive and explicitly signed-positive formats still create successfully");

  const patchTarget = created[0];
  const rejectedPatch = await request("PATCH", hotelA, `/menu-items/${patchTarget.id}`, {
    body: { price: "-1.00" },
    expected: 400,
  });
  assert.equal(rejectedPatch.error.code, "INVALID_MENU_ITEM");
  assert.equal((await prisma.menu_item.findUniqueOrThrow({ where: { id: patchTarget.id } })).price.toFixed(2), "1.00");
  pass("negative price on update returns 400 and preserves the stored price");

  const acceptedPatch = await request("PATCH", hotelA, `/menu-items/${patchTarget.id}`, {
    body: { price: "10.50" },
  });
  assert.equal(acceptedPatch.data.menu_item.price, "10.50");
  assert.equal((await prisma.menu_item.findUniqueOrThrow({ where: { id: patchTarget.id } })).price.toFixed(2), "10.50");
  pass("valid positive price update still succeeds and persists");

  const malformed = await request("POST", hotelA, "/menu-items", {
    body: { name: "Malformed price", price: "not-a-price" },
    expected: 400,
  });
  assert.equal(malformed.error.code, "INVALID_MENU_ITEM");
  pass("existing malformed-price validation remains unchanged");

  await request("GET", hotelB, "/menu-items", { tokenHotel: hotelA, expected: 403 });
  await request("POST", hotelA, "/menu-items", {
    body: { name: "Unauthorized item", price: "1.00" },
    role: "Reception",
    expected: 403,
  });
  await request("POST", hotelA, "/menu-items", {
    body: { name: "Unauthenticated item", price: "1.00" },
    role: null,
    expected: 401,
  });
  assert.equal(await prisma.menu_item.count({ where: { hotel_id: hotelB } }), 0);
  pass("hotel scope, role authorization, and authentication remain enforced");

  const mappedItem = await createItem("MAPPED");
  const mappedDiscount = await createDiscount(mappedItem.id);
  const mappedItemBefore = await prisma.menu_item.findUniqueOrThrow({ where: { id: mappedItem.id } });
  const mappedDiscountBefore = await prisma.discount.findUniqueOrThrow({ where: { id: mappedDiscount.id } });
  const mappedDelete = await request("DELETE", hotelA, `/menu-items/${mappedItem.id}`, { role: "Manager", expected: 409 });
  assert.equal(mappedDelete.error.code, "MENU_ITEM_HAS_DISCOUNTS");
  assert.deepEqual(await prisma.menu_item.findUniqueOrThrow({ where: { id: mappedItem.id } }), mappedItemBefore);
  assert.deepEqual(await prisma.discount.findUniqueOrThrow({ where: { id: mappedDiscount.id } }), mappedDiscountBefore);
  assert.equal(await prisma.discount_menu_item.count({ where: { discount_id: mappedDiscount.id, menu_item_id: mappedItem.id } }), 1);
  pass("active percentage Discount blocks Manager deletion and preserves item, Discount, and mapping");

  const multiplyMappedItem = await createItem("MULTI");
  const inactiveDiscount = await createDiscount(multiplyMappedItem.id, { active: false });
  const fixedDiscount = await createDiscount(multiplyMappedItem.id, { type: "fixed_amount" });
  const multipleDelete = await request("DELETE", hotelA, `/menu-items/${multiplyMappedItem.id}`, { expected: 409 });
  assert.equal(multipleDelete.error.code, "MENU_ITEM_HAS_DISCOUNTS");
  assert.ok(await prisma.menu_item.findUnique({ where: { id: multiplyMappedItem.id } }));
  assert.ok(await prisma.discount.findUnique({ where: { id: inactiveDiscount.id } }));
  assert.ok(await prisma.discount.findUnique({ where: { id: fixedDiscount.id } }));
  assert.equal(await prisma.discount_menu_item.count({ where: { menu_item_id: multiplyMappedItem.id } }), 2);
  pass("multiple, inactive, and fixed-amount Discount mappings all block Admin deletion and remain intact");

  const orderItem = await createItem("ORDER-HISTORY");
  const historicalOrder = await prisma.orders.create({
    data: {
      id: randomUUID(), hotel_id: hotelA, order_number: `MI-ORDER-${randomUUID()}`, source: "admin",
      customer_name: "Menu Item Test", customer_phone: "0", status: "completed", payment_status: "pending",
      subtotal: "25.00", total_amount: "25.00",
      order_item: { create: { id: randomUUID(), menu_item_id: orderItem.id, item_name: orderItem.name, quantity: 1, unit_price: "25.00", subtotal: "25.00", status: "completed" } },
    },
  });
  const historyDelete = await request("DELETE", hotelA, `/menu-items/${orderItem.id}`, { expected: 409 });
  assert.equal(historyDelete.error.code, "MENU_ITEM_HAS_ORDERS");
  assert.ok(await prisma.menu_item.findUnique({ where: { id: orderItem.id } }));
  assert.equal(await prisma.order_item.count({ where: { order_id: historicalOrder.id, menu_item_id: orderItem.id } }), 1);
  pass("existing order-history deletion protection remains unchanged");

  const unmappedItem = await createItem("UNMAPPED");
  await request("DELETE", hotelA, `/menu-items/${unmappedItem.id}`);
  assert.equal(await prisma.menu_item.count({ where: { id: unmappedItem.id } }), 0);
  pass("unreferenced Menu Item retains successful deletion behavior");

  const foreignItem = (await request("POST", hotelB, "/menu-items", {
    body: { name: `Foreign item ${randomUUID()}`, price: "25.00" }, tokenHotel: hotelB, expected: 201,
  })).data.menu_item;
  await request("DELETE", hotelB, `/menu-items/${foreignItem.id}`, { tokenHotel: hotelA, expected: 403 });
  await request("DELETE", hotelA, `/menu-items/${mappedItem.id}`, { role: "Reception", expected: 403 });
  await request("DELETE", hotelA, `/menu-items/${mappedItem.id}`, { role: null, expected: 401 });
  const invalidDelete = await request("DELETE", hotelA, "/menu-items/not-a-uuid", { expected: 400 });
  assert.equal(invalidDelete.error.code, "INVALID_MENU_ITEM_ID");
  assert.ok(await prisma.menu_item.findUnique({ where: { id: foreignItem.id } }));
  pass("delete authentication, Admin/Manager authorization, hotel scope, and UUID validation remain enforced");

  const raceItem = await createItem("RACE");
  const raceDiscount = await prisma.discount.create({
    data: {
      id: randomUUID(), hotel_id: hotelA, name: `Menu item race discount ${randomUUID()}`,
      discount_type: "percentage", discount_value: "10.00", applicable_on: "specific_items",
      end_date: new Date("2099-12-31T00:00:00.000Z"), is_active: true,
    },
  });
  const connection = new Client({ connectionString: environment.databaseUrl });
  await connection.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("INSERT INTO discount_menu_item (discount_id, menu_item_id) VALUES ($1, $2)", [raceDiscount.id, raceItem.id]);
    const racingDelete = request("DELETE", hotelA, `/menu-items/${raceItem.id}`, { expected: 409 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await connection.query("COMMIT");
    const racingPayload = await racingDelete;
    assert.equal(racingPayload.error.code, "MENU_ITEM_HAS_DISCOUNTS");
  } finally {
    await connection.query("ROLLBACK").catch(() => {});
    await connection.end();
  }
  assert.ok(await prisma.menu_item.findUnique({ where: { id: raceItem.id } }));
  assert.equal(await prisma.discount_menu_item.count({ where: { discount_id: raceDiscount.id, menu_item_id: raceItem.id } }), 1);
  pass("concurrent Discount mapping cannot race past the Menu Item dependency guard");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixture.hotelIds.length) {
    await prisma.orders.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.discount.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.menu_item.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.user_role.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  }
  if (fixture.userIds.length) await prisma.users.deleteMany({ where: { id: { in: fixture.userIds } } });
  await deleteHotelFixtures(fixture.hotelIds);
  assert.deepEqual(await counts(), before, "Temporary Menu Item fixtures were not completely removed");
  assert.deepEqual(await prisma.menu_item.findMany({ orderBy: { id: "asc" } }), existingMenuItems, "Existing Menu Item data changed");
  assert.deepEqual(await prisma.discount.findMany({ orderBy: { id: "asc" } }), existingDiscounts, "Existing Discount data changed");
  assert.deepEqual(await prisma.discount_menu_item.findMany({ orderBy: [{ discount_id: "asc" }, { menu_item_id: "asc" }] }), existingItemMappings, "Existing Discount item mappings changed");
  await prisma.$disconnect();
}

console.log(`Menu Item integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
