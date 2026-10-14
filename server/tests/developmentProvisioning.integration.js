import "dotenv/config";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { app } from "../app.js";
import { INITIAL_HOTEL_BILLING_SETTINGS } from "../config/hotelBillingSettings.js";
import { HOTEL_PLANS } from "../config/hotelPlans.js";
import { ROLE_KEYS } from "../config/roles.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";

const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Disposable local hms only");

const development = {
  email: "admin@local.aazira.test",
  hotelEmail: "hotel@local.aazira.test",
  password: process.env.DEV_ADMIN_PASSWORD,
};
assert.ok(development.password, "DEV_ADMIN_PASSWORD is required");

const provisionEnvironment = {
  ...process.env,
  DEV_ADMIN_PASSWORD: process.env.DEV_ADMIN_PASSWORD,
  DEV_MANAGER_PASSWORD: process.env.DEV_MANAGER_PASSWORD,
  DEV_RECEPTION_PASSWORD: process.env.DEV_RECEPTION_PASSWORD,
  DEV_CAPTAIN_PASSWORD: process.env.DEV_CAPTAIN_PASSWORD,
  DEV_KITCHEN_PASSWORD: process.env.DEV_KITCHEN_PASSWORD,
  NODE_ENV: "test",
};
const checks = [];
const pass = name => checks.push(name);
let server;

function runProvisioner() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["server/scripts/provisionDevelopmentAccount.js"], {
      cwd: process.cwd(),
      env: provisionEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve(output) : reject(new Error(output)));
  });
}

async function request(origin, method, path, { body, cookie, expected } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return { payload, response };
}

try {
  await runProvisioner();
  const hotel = await prisma.hotel.findFirstOrThrow({ where: { email: development.hotelEmail } });
  assert.equal(hotel.plan, HOTEL_PLANS.FREE);
  assert.equal(hotel.status, "ACTIVE");
  pass("official provisioner creates an active FREE development hotel");

  const settings = await prisma.hotel_billing_settings.findUniqueOrThrow({ where: { hotel_id: hotel.id } });
  assert.equal(settings.service_charge_enabled, INITIAL_HOTEL_BILLING_SETTINGS.service_charge_enabled);
  assert.equal(settings.service_charge_rate.toFixed(2), INITIAL_HOTEL_BILLING_SETTINGS.service_charge_rate);
  assert.equal(settings.default_tax_slab_id, null);
  pass("official provisioner creates canonical hotel billing settings");

  const admin = await prisma.users.findUniqueOrThrow({
    where: { email: development.email },
    include: { user_role: { include: { role: true } } },
  });
  const assignment = admin.user_role.find(item => item.hotel_id === hotel.id && item.role.system_key === ROLE_KEYS.HOTEL_ADMIN);
  assert.ok(admin.is_active && assignment?.status === "ACTIVE");
  pass("development Hotel Admin identity and assignment are active");

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const login = await request(origin, "POST", "/api/auth/login", {
    body: { identifier: development.email, password: development.password, remember: false },
    expected: 200,
  });
  const cookie = (login.response.headers.get("set-cookie") || "").match(/aazira_auth=[^;]+/)?.[0];
  assert.ok(cookie);
  pass("provisioned Hotel Admin authenticates normally");

  const response = await request(origin, "GET", `/api/hotels/${hotel.id}/settings`, { cookie, expected: 200 });
  assert.equal(response.payload.data.hotel.id, hotel.id);
  assert.equal(response.payload.data.billing.service_charge_enabled, false);
  assert.equal(response.payload.data.billing.service_charge_rate, "0.00");
  assert.equal(response.payload.data.billing.default_tax_slab_id, null);
  pass("Hotel Admin settings API returns canonical initialized settings");

  const beforeRepeat = {
    hotels: await prisma.hotel.count(),
    settings: await prisma.hotel_billing_settings.count(),
    users: await prisma.users.count(),
    assignments: await prisma.user_role.count(),
  };
  await runProvisioner();
  const afterRepeat = {
    hotels: await prisma.hotel.count(),
    settings: await prisma.hotel_billing_settings.count(),
    users: await prisma.users.count(),
    assignments: await prisma.user_role.count(),
  };
  assert.deepEqual(afterRepeat, beforeRepeat);
  pass("repeated provisioning remains idempotent without duplicate records");

  assert.equal(checks.length, 6);
  console.log(`Development provisioning integration: ${checks.length}/${checks.length} passed`);
  checks.forEach(name => console.log(`PASS ${name}`));
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
}
