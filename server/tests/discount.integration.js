// Explicit local-only integration test. Fixtures are isolated and removed in finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";
import { deleteHotelFixtures } from "./helpers/hotelFixtureCleanup.js";

const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Local hms only");

const models = ["hotel", "users", "user_role", "menu_category", "discount", "discount_menu_category", "discount_menu_item"];
const counts = async () => Object.fromEntries(await Promise.all(models.map(async (name) => [name, await prisma[name].count()])));
const before = await counts();
const existingDiscounts = await prisma.discount.findMany({ orderBy: { id: "asc" } });
const existingCategoryMappings = await prisma.discount_menu_category.findMany({ orderBy: [{ discount_id: "asc" }, { category_id: "asc" }] });
const existingItemMappings = await prisma.discount_menu_item.findMany({ orderBy: [{ discount_id: "asc" }, { menu_item_id: "asc" }] });
const fixture = { hotelIds: [], userIds: [] };
const results = [];
const pass = (name) => results.push(name);
let server;

try {
  const hotelA = randomUUID();
  const hotelB = randomUUID();
  fixture.hotelIds.push(hotelA, hotelB);
  await prisma.hotel.createMany({ data: [
    { id: hotelA, name: `Discount test A ${hotelA}`, status: "ACTIVE" },
    { id: hotelB, name: `Discount test B ${hotelB}`, status: "ACTIVE" },
  ].map(entitledHotelFixture) });

  const categoryA = randomUUID();
  const categoryB = randomUUID();
  await prisma.menu_category.createMany({ data: [
    { id: categoryA, hotel_id: hotelA, name: `Discount category A ${categoryA}` },
    { id: categoryB, hotel_id: hotelA, name: `Discount category B ${categoryB}` },
  ] });

  const roles = Object.fromEntries(await Promise.all(["Admin", "Manager", "Reception"].map(async (name) => [name, await prisma.role.findUniqueOrThrow({ where: { name } })])));
  const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
  const tokens = {};
  const addActor = async (role, hotelId) => {
    const userId = randomUUID();
    const userRoleId = randomUUID();
    fixture.userIds.push(userId);
    await prisma.users.create({ data: { id: userId, name: `${role} discount test`, email: `${userId}@discount-test.invalid`, password_hash: passwordHash } });
    await prisma.user_role.create({ data: { id: userRoleId, user_id: userId, role_id: roles[role].id, hotel_id: hotelId } });
    tokens[`${role}:${hotelId}`] = await createAuthenticationToken({ userId, userRoleId }, 600);
  };
  await addActor("Admin", hotelA);
  await addActor("Manager", hotelA);
  await addActor("Admin", hotelB);
  await addActor("Reception", hotelA);

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, hotelId, path, { body, role = "Admin", tokenHotel = hotelId, expected = 200 } = {}) => {
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
  const body = (type, value, label, extra = {}) => ({
    name: `Discount ${label} ${randomUUID()}`,
    discount_type: type,
    discount_value: value,
    applicable_on: "all",
    end_date: "2099-12-31",
    is_active: true,
    ...extra,
  });

  const percentage = (await request("POST", hotelA, "/discounts", {
    body: body("percentage", "10.00", "percentage", { applicable_on: "categories", category_ids: [categoryA] }),
    expected: 201,
  })).data.discount;

  const rejectedValue = await request("PATCH", hotelA, `/discounts/${percentage.id}`, { body: { discount_value: "101.00" }, expected: 400 });
  assert.equal(rejectedValue.error.code, "INVALID_DECIMAL");
  assert.equal((await prisma.discount.findUniqueOrThrow({ where: { id: percentage.id } })).discount_value.toFixed(2), "10.00");
  pass("percentage PATCH above 100 returns INVALID_DECIMAL and preserves its value");

  const maximum = await request("PATCH", hotelA, `/discounts/${percentage.id}`, { body: { discount_value: "100.00" } });
  assert.equal(maximum.data.discount.discount_value, "100.00");
  pass("percentage PATCH at 100 succeeds when discount_type is omitted");

  const fixed = (await request("POST", hotelA, "/discounts", { body: body("fixed_amount", "150.00", "fixed"), expected: 201 })).data.discount;
  const fixedUpdate = await request("PATCH", hotelA, `/discounts/${fixed.id}`, { body: { discount_value: "175.00" } });
  assert.equal(fixedUpdate.data.discount.discount_value, "175.00");
  pass("fixed-amount PATCH values above 100 remain accepted");

  const typeOnly = await request("PATCH", hotelA, `/discounts/${fixed.id}`, { body: { discount_type: "percentage" }, expected: 400 });
  assert.equal(typeOnly.error.code, "INVALID_DECIMAL");
  const afterTypeOnly = await prisma.discount.findUniqueOrThrow({ where: { id: fixed.id } });
  assert.equal(afterTypeOnly.discount_type, "fixed_amount");
  assert.equal(afterTypeOnly.discount_value.toFixed(2), "175.00");
  pass("changing an above-100 fixed discount to percentage is rejected without mutation");

  const combined = await request("PATCH", hotelA, `/discounts/${fixed.id}`, { body: { discount_type: "percentage", discount_value: "101.00" }, expected: 400 });
  assert.equal(combined.error.code, "INVALID_DECIMAL");
  const afterCombined = await prisma.discount.findUniqueOrThrow({ where: { id: fixed.id } });
  assert.equal(afterCombined.discount_type, "fixed_amount");
  assert.equal(afterCombined.discount_value.toFixed(2), "175.00");
  pass("combined invalid percentage type/value PATCH preserves both scalar fields");

  const validOmittedType = await request("PATCH", hotelA, `/discounts/${percentage.id}`, { body: { discount_value: "75.00" }, role: "Manager" });
  assert.equal(validOmittedType.data.discount.discount_value, "75.00");
  pass("valid percentage PATCH succeeds without repeating discount_type");

  const unrelated = await request("PATCH", hotelA, `/discounts/${percentage.id}`, { body: { description: "Valid percentage remains unchanged" } });
  assert.equal(unrelated.data.discount.discount_value, "75.00");
  assert.equal(unrelated.data.discount.description, "Valid percentage remains unchanged");
  pass("unrelated scalar PATCH retains a valid percentage value");

  const beforeRejectedCreate = await prisma.discount.count({ where: { hotel_id: hotelA } });
  const rejectedCreate = await request("POST", hotelA, "/discounts", { body: body("percentage", "101.00", "invalid-create"), expected: 400 });
  assert.equal(rejectedCreate.error.code, "INVALID_DECIMAL");
  assert.equal(await prisma.discount.count({ where: { hotel_id: hotelA } }), beforeRejectedCreate);
  pass("CREATE percentage ceiling remains enforced");

  for (const value of ["0", "-1.00", "1.234", 10]) {
    const payload = await request("PATCH", hotelA, `/discounts/${percentage.id}`, { body: { discount_value: value }, expected: 400 });
    assert.equal(payload.error.code, "INVALID_DECIMAL");
  }
  pass("existing zero, negative, scale, and non-string decimal validation remains unchanged");

  const rejectedMapping = await request("PATCH", hotelA, `/discounts/${percentage.id}`, {
    body: { discount_value: "101.00", applicable_on: "categories", category_ids: [categoryB] },
    expected: 400,
  });
  assert.equal(rejectedMapping.error.code, "INVALID_DECIMAL");
  const preserved = await request("GET", hotelA, "/discounts");
  const preservedPercentage = preserved.data.discounts.find(({ id }) => id === percentage.id);
  assert.equal(preservedPercentage.discount_value, "75.00");
  assert.equal(preservedPercentage.applicable_on, "categories");
  assert.deepEqual(preservedPercentage.category_ids, [categoryA]);
  pass("rejected effective-state validation preserves applicability mappings and scalar fields");

  await request("POST", hotelA, "/discounts", { body: body("percentage", "10.00", "unauthenticated"), role: null, expected: 401 });
  await request("POST", hotelA, "/discounts", { body: body("percentage", "10.00", "forbidden"), role: "Reception", expected: 403 });
  await request("POST", hotelB, "/discounts", { body: body("percentage", "10.00", "scope"), tokenHotel: hotelA, expected: 403 });
  pass("authentication, Admin/Manager authorization, and hotel scope remain enforced");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixture.hotelIds.length) {
    await prisma.discount.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.menu_category.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
    await prisma.user_role.deleteMany({ where: { hotel_id: { in: fixture.hotelIds } } });
  }
  if (fixture.userIds.length) await prisma.users.deleteMany({ where: { id: { in: fixture.userIds } } });
  await deleteHotelFixtures(fixture.hotelIds);
  assert.deepEqual(await counts(), before, "Temporary Discount fixtures were not completely removed");
  assert.deepEqual(await prisma.discount.findMany({ orderBy: { id: "asc" } }), existingDiscounts, "Existing Discount data changed");
  assert.deepEqual(await prisma.discount_menu_category.findMany({ orderBy: [{ discount_id: "asc" }, { category_id: "asc" }] }), existingCategoryMappings, "Existing Discount category mappings changed");
  assert.deepEqual(await prisma.discount_menu_item.findMany({ orderBy: [{ discount_id: "asc" }, { menu_item_id: "asc" }] }), existingItemMappings, "Existing Discount item mappings changed");
  await prisma.$disconnect();
}

console.log(`Discount integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
