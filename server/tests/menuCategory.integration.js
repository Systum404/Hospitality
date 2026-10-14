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
const models = ["hotel", "users", "user_role", "menu_category", "discount", "discount_menu_category"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async (name) => [name, await prisma[name].count()])));
const before = await counts();
const existingCategories = await prisma.menu_category.findMany({ orderBy: { id: "asc" } });
const existingDiscounts = await prisma.discount.findMany({ orderBy: { id: "asc" } });
const existingCategoryMappings = await prisma.discount_menu_category.findMany({ orderBy: [{ discount_id: "asc" }, { category_id: "asc" }] });
const fixture = { hotelIds: [], userIds: [] };
const results = [];
const pass = (name) => results.push(name);
let server;

try {
  const hotelA = randomUUID();
  const hotelB = randomUUID();
  fixture.hotelIds.push(hotelA, hotelB);
  await prisma.hotel.createMany({ data: [
    { id: hotelA, name: `Menu category test A ${hotelA}`, status: "ACTIVE" },
    { id: hotelB, name: `Menu category test B ${hotelB}`, status: "ACTIVE" },
  ].map(entitledHotelFixture) });

  const roles = Object.fromEntries(await Promise.all(["Admin", "Manager", "Reception"].map(async (name) => [name, await prisma.role.findUniqueOrThrow({ where: { name } })])));
  const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
  const tokens = {};
  const addUser = async (role, hotelId) => {
    const userId = randomUUID();
    const userRoleId = randomUUID();
    fixture.userIds.push(userId);
    await prisma.users.create({ data: { id: userId, name: `${role} category test`, email: `${userId}@category-test.invalid`, password_hash: passwordHash } });
    await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: roles[role].id, hotel_id: hotelId } });
    tokens[`${role}:${hotelId}`] = await createAuthenticationToken({ userId, userRoleId }, 600);
  };
  await addUser("Admin", hotelA);
  await addUser("Manager", hotelA);
  await addUser("Manager", hotelB);
  await addUser("Reception", hotelA);

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, hotelId, path, { body, role = "Manager", tokenHotel = hotelId, expected = 200 } = {}) => {
    const token = role ? tokens[`${role}:${tokenHotel}`] : null;
    const response = await fetch(`${origin}/api/hotels/${hotelId}${path}`, {
      method,
      headers: { ...(token ? { Cookie: `aazira_auth=${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
    return payload;
  };
  const categoryBody = (displayOrder, label = "CATEGORY") => ({ name: `MC-${label}-${randomUUID().slice(0, 8)}`, display_order: displayOrder, is_active: true });
  const createDiscount = async (categoryId, { active = true, type = "percentage" } = {}) => prisma.discount.create({
    data: {
      id: randomUUID(),
      hotel_id: hotelA,
      name: `MC discount ${randomUUID()}`,
      discount_type: type,
      discount_value: type === "percentage" ? "10.00" : "25.00",
      applicable_on: "categories",
      end_date: new Date("2099-12-31T00:00:00.000Z"),
      is_active: active,
      discount_menu_category: { create: { category_id: categoryId } },
    },
  });

  const initialCount = await prisma.menu_category.count({ where: { hotel_id: hotelA } });
  for (const displayOrder of [2147483648, -2147483649]) {
    const payload = await request("POST", hotelA, "/menu-categories", { body: categoryBody(displayOrder, "REJECT"), expected: 400 });
    assert.equal(payload.error.code, "INVALID_MENU_CATEGORY");
  }
  assert.equal(await prisma.menu_category.count({ where: { hotel_id: hotelA } }), initialCount);
  pass("out-of-range CREATE display orders return 400 and create no rows");

  const maximum = (await request("POST", hotelA, "/menu-categories", { body: categoryBody(2147483647, "MAX"), expected: 201 })).data.menu_category;
  const minimum = (await request("POST", hotelA, "/menu-categories", { body: categoryBody(-2147483648, "MIN"), role: "Admin", expected: 201 })).data.menu_category;
  assert.equal(maximum.display_order, 2147483647);
  assert.equal(minimum.display_order, -2147483648);
  pass("both PostgreSQL INTEGER boundaries remain accepted on CREATE");

  const patchTarget = (await request("POST", hotelA, "/menu-categories", { body: categoryBody(7, "PATCH"), expected: 201 })).data.menu_category;
  for (const displayOrder of [2147483648, -2147483649]) {
    const payload = await request("PATCH", hotelA, `/menu-categories/${patchTarget.id}`, { body: { display_order: displayOrder }, expected: 400 });
    assert.equal(payload.error.code, "INVALID_MENU_CATEGORY");
    assert.equal((await prisma.menu_category.findUniqueOrThrow({ where: { id: patchTarget.id } })).display_order, 7);
  }
  pass("out-of-range PATCH display orders return 400 and preserve the stored value");

  for (const displayOrder of [2147483647, -2147483648]) {
    const payload = await request("PATCH", hotelA, `/menu-categories/${patchTarget.id}`, { body: { display_order: displayOrder } });
    assert.equal(payload.data.menu_category.display_order, displayOrder);
    assert.equal((await prisma.menu_category.findUniqueOrThrow({ where: { id: patchTarget.id } })).display_order, displayOrder);
  }
  pass("both PostgreSQL INTEGER boundaries remain accepted on PATCH");

  for (const displayOrder of [0, 1, -1]) {
    const payload = await request("POST", hotelA, "/menu-categories", { body: categoryBody(displayOrder, "NORMAL"), expected: 201 });
    assert.equal(payload.data.menu_category.display_order, displayOrder);
  }
  pass("existing normal integer behavior remains unchanged");

  for (const displayOrder of [1.5, "1", null]) {
    const payload = await request("POST", hotelA, "/menu-categories", { body: categoryBody(displayOrder, "INVALID"), expected: 400 });
    assert.equal(payload.error.code, "INVALID_MENU_CATEGORY");
  }
  const defaulted = (await request("POST", hotelA, "/menu-categories", { body: { name: `MC-DEFAULT-${randomUUID().slice(0, 8)}` }, expected: 201 })).data.menu_category;
  assert.equal(defaulted.display_order, 0);
  const beforeDescriptionPatch = defaulted.display_order;
  await request("PATCH", hotelA, `/menu-categories/${defaulted.id}`, { body: { description: "unchanged display order" } });
  assert.equal((await prisma.menu_category.findUniqueOrThrow({ where: { id: defaulted.id } })).display_order, beforeDescriptionPatch);
  pass("fractional, string, null, and missing display-order semantics remain unchanged");

  await request("POST", hotelA, "/menu-categories", { body: categoryBody(2, "AUTH"), role: null, expected: 401 });
  await request("POST", hotelA, "/menu-categories", { body: categoryBody(2, "ROLE"), role: "Reception", expected: 403 });
  await request("POST", hotelB, "/menu-categories", { body: categoryBody(2, "SCOPE"), tokenHotel: hotelA, expected: 403 });
  const adminCreated = (await request("POST", hotelA, "/menu-categories", { body: categoryBody(2, "ADMIN"), role: "Admin", expected: 201 })).data.menu_category;
  assert.ok(adminCreated.id);
  pass("authentication, Admin/Manager authorization, and hotel scope remain enforced");

  const mappedCategory = (await request("POST", hotelA, "/menu-categories", { body: categoryBody(3, "MAPPED"), expected: 201 })).data.menu_category;
  const mappedDiscount = await createDiscount(mappedCategory.id);
  const mappedCategoryBefore = await prisma.menu_category.findUniqueOrThrow({ where: { id: mappedCategory.id } });
  const mappedDiscountBefore = await prisma.discount.findUniqueOrThrow({ where: { id: mappedDiscount.id } });
  const mappedDelete = await request("DELETE", hotelA, `/menu-categories/${mappedCategory.id}`, { expected: 409 });
  assert.equal(mappedDelete.error.code, "MENU_CATEGORY_HAS_DISCOUNTS");
  assert.deepEqual(await prisma.menu_category.findUniqueOrThrow({ where: { id: mappedCategory.id } }), mappedCategoryBefore);
  assert.deepEqual(await prisma.discount.findUniqueOrThrow({ where: { id: mappedDiscount.id } }), mappedDiscountBefore);
  assert.equal(await prisma.discount_menu_category.count({ where: { discount_id: mappedDiscount.id, category_id: mappedCategory.id } }), 1);
  pass("mapped category deletion returns 409 and preserves category, discount, and mapping");

  const multiplyMappedCategory = (await request("POST", hotelA, "/menu-categories", { body: categoryBody(4, "MULTI"), expected: 201 })).data.menu_category;
  const inactiveDiscount = await createDiscount(multiplyMappedCategory.id, { active: false });
  const fixedDiscount = await createDiscount(multiplyMappedCategory.id, { type: "fixed_amount" });
  const multipleDelete = await request("DELETE", hotelA, `/menu-categories/${multiplyMappedCategory.id}`, { role: "Admin", expected: 409 });
  assert.equal(multipleDelete.error.code, "MENU_CATEGORY_HAS_DISCOUNTS");
  assert.ok(await prisma.menu_category.findUnique({ where: { id: multiplyMappedCategory.id } }));
  assert.equal(await prisma.discount_menu_category.count({ where: { category_id: multiplyMappedCategory.id } }), 2);
  assert.ok(await prisma.discount.findUnique({ where: { id: inactiveDiscount.id } }));
  assert.ok(await prisma.discount.findUnique({ where: { id: fixedDiscount.id } }));
  pass("multiple mappings, inactive discounts, and fixed-amount discounts all block deletion");

  const unmappedCategory = (await request("POST", hotelA, "/menu-categories", { body: categoryBody(5, "UNMAPPED"), expected: 201 })).data.menu_category;
  await request("DELETE", hotelA, `/menu-categories/${unmappedCategory.id}`);
  assert.equal(await prisma.menu_category.count({ where: { id: unmappedCategory.id } }), 0);
  pass("unmapped category retains the existing successful deletion behavior");

  const scopedCategory = (await request("POST", hotelB, "/menu-categories", { body: categoryBody(6, "SCOPED"), tokenHotel: hotelB, expected: 201 })).data.menu_category;
  await request("DELETE", hotelB, `/menu-categories/${scopedCategory.id}`, { tokenHotel: hotelA, expected: 403 });
  assert.ok(await prisma.menu_category.findUnique({ where: { id: scopedCategory.id } }));
  await request("DELETE", hotelA, `/menu-categories/${mappedCategory.id}`, { role: null, expected: 401 });
  await request("DELETE", hotelA, `/menu-categories/${mappedCategory.id}`, { role: "Reception", expected: 403 });
  const invalidId = await request("DELETE", hotelA, "/menu-categories/not-a-uuid", { expected: 400 });
  assert.equal(invalidId.error.code, "INVALID_MENU_CATEGORY_ID");
  pass("delete authentication, role authorization, hotel scope, and UUID validation remain enforced");

  const raceCategory = (await request("POST", hotelA, "/menu-categories", { body: categoryBody(7, "RACE"), expected: 201 })).data.menu_category;
  const raceDiscount = await prisma.discount.create({
    data: {
      id: randomUUID(), hotel_id: hotelA, name: `MC race discount ${randomUUID()}`,
      discount_type: "percentage", discount_value: "10.00", applicable_on: "categories",
      end_date: new Date("2099-12-31T00:00:00.000Z"), is_active: true,
    },
  });
  const connection = new Client({ connectionString: environment.databaseUrl });
  await connection.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("INSERT INTO discount_menu_category (discount_id, category_id) VALUES ($1, $2)", [raceDiscount.id, raceCategory.id]);
    const racingDelete = request("DELETE", hotelA, `/menu-categories/${raceCategory.id}`, { expected: 409 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await connection.query("COMMIT");
    const racingPayload = await racingDelete;
    assert.equal(racingPayload.error.code, "MENU_CATEGORY_HAS_DISCOUNTS");
  } finally {
    await connection.query("ROLLBACK").catch(() => {});
    await connection.end();
  }
  assert.ok(await prisma.menu_category.findUnique({ where: { id: raceCategory.id } }));
  assert.equal(await prisma.discount_menu_category.count({ where: { discount_id: raceDiscount.id, category_id: raceCategory.id } }), 1);
  pass("concurrent mapping creation cannot race past the category dependency guard");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixture.hotelIds.length) {
    await prisma.discount.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.menu_category.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.user_role.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  }
  if (fixture.userIds.length) await prisma.users.deleteMany({ where: { id: { in: fixture.userIds } } });
  await deleteHotelFixtures(fixture.hotelIds);
  assert.deepEqual(await counts(), before, "Temporary Menu Category fixtures were not completely removed");
  assert.deepEqual(await prisma.menu_category.findMany({ orderBy: { id: "asc" } }), existingCategories, "Existing Menu Category data changed");
  assert.deepEqual(await prisma.discount.findMany({ orderBy: { id: "asc" } }), existingDiscounts, "Existing Discount data changed");
  assert.deepEqual(await prisma.discount_menu_category.findMany({ orderBy: [{ discount_id: "asc" }, { category_id: "asc" }] }), existingCategoryMappings, "Existing Discount category mappings changed");
  await prisma.$disconnect();
}

console.log(`Menu Category integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
