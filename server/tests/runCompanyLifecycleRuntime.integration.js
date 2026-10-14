import "dotenv/config";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { ROLE_KEYS } from "../config/roles.js";
import { createAuthenticationToken } from "../services/tokenService.js";

const database = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && database.pathname === "/hms", "Local hms only");
const testDatabase = `hms_phase6_runtime_${randomBytes(6).toString("hex")}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
let backend;
let scopedPool;

function run(args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(`${args.join(" ")} failed with exit code ${code}`)));
  });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:4000/api/health");
      if (response.ok) return response;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Current-source backend did not become healthy on port 4000.");
}

async function request(method, path, { cookie, expected = 200 } = {}) {
  const response = await fetch(`http://127.0.0.1:4000${path}`, {
    method,
    headers: cookie ? { Cookie: cookie } : {},
  });
  const payload = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return { payload, requestId: response.headers.get("x-request-id"), status: response.status };
}

try {
  await admin.query(`CREATE DATABASE "${testDatabase}"`);
  const scoped = new URL(process.env.DATABASE_URL);
  scoped.pathname = `/${testDatabase}`;
  const environment = { ...process.env, DATABASE_URL: scoped.toString(), PORT: "4000" };
  await run(["node_modules/prisma/build/index.js", "migrate", "deploy"], environment);
  await run(["server/tests/seedControlPlaneRegression.isolated.js"], environment);
  scopedPool = new Pool({ connectionString: scoped.toString() });

  const hotel = (await scopedPool.query("SELECT id, status FROM hotel ORDER BY created_at ASC LIMIT 1")).rows[0];
  const roles = Object.fromEntries((await scopedPool.query("SELECT id, system_key, scope FROM role")).rows.map(role => [role.system_key, role]));
  const cookies = {};
  for (const roleKey of Object.values(ROLE_KEYS)) {
    const userId = randomUUID();
    const userRoleId = randomUUID();
    const role = roles[roleKey];
    const hotelId = roleKey === ROLE_KEYS.SUPER_ADMIN ? null : hotel.id;
    await scopedPool.query(
      "INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)",
      [userId, `${userId}@phase6-runtime.invalid`, "runtime-verification-only", roleKey],
    );
    await scopedPool.query(
      "INSERT INTO user_role (id, user_id, role_id, role_scope, status, hotel_id) VALUES ($1, $2, $3, $4::role_scope, 'ACTIVE', $5)",
      [userRoleId, userId, role.id, role.scope, hotelId],
    );
    cookies[roleKey] = `aazira_auth=${await createAuthenticationToken({ userId, userRoleId }, 900)}`;
  }

  backend = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let runtimeOutput = "";
  backend.stdout.on("data", chunk => { runtimeOutput += chunk; process.stdout.write(chunk); });
  backend.stderr.on("data", chunk => { runtimeOutput += chunk; process.stderr.write(chunk); });
  const health = await waitForHealth();
  assert.equal(health.status, 200);
  const healthPayload = await health.json();
  assert.equal(healthPayload.status, "ok");
  assert.equal(healthPayload.server, "running");
  assert.equal(healthPayload.database, "connected");

  assert.equal((await request("GET", "/api/company/hotels", { expected: 401 })).payload.error.code, "UNAUTHENTICATED");
  assert.equal((await request("GET", "/api/company/hotels", { cookie: cookies[ROLE_KEYS.SUPER_ADMIN] })).status, 200);
  for (const roleKey of [ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION, ROLE_KEYS.CAPTAIN, ROLE_KEYS.KITCHEN]) {
    assert.equal((await request("GET", "/api/company/hotels", { cookie: cookies[roleKey], expected: 403 })).payload.error.code, "COMPANY_SCOPE_REQUIRED");
  }

  const deactivated = await request("POST", `/api/company/hotels/${hotel.id}/deactivate`, { cookie: cookies[ROLE_KEYS.SUPER_ADMIN] });
  assert.equal(deactivated.payload.data.changed, true);
  assert.equal(deactivated.payload.data.hotel.status, "INACTIVE");
  const deactivationAudit = (await scopedPool.query(
    "SELECT action, hotel_id, request_id, metadata FROM audit_event WHERE action = 'HOTEL_DEACTIVATED'",
  )).rows;
  assert.equal(deactivationAudit.length, 1);
  assert.equal(deactivationAudit[0].hotel_id, hotel.id);
  assert.equal(deactivationAudit[0].request_id, deactivated.requestId);
  assert.deepEqual(deactivationAudit[0].metadata, { current_status: "INACTIVE", previous_status: "ACTIVE" });

  const activated = await request("POST", `/api/company/hotels/${hotel.id}/activate`, { cookie: cookies[ROLE_KEYS.SUPER_ADMIN] });
  assert.equal(activated.payload.data.changed, true);
  assert.equal(activated.payload.data.hotel.status, "ACTIVE");
  const activationAudit = (await scopedPool.query(
    "SELECT action, hotel_id, request_id, metadata FROM audit_event WHERE action = 'HOTEL_ACTIVATED'",
  )).rows;
  assert.equal(activationAudit.length, 1);
  assert.equal(activationAudit[0].hotel_id, hotel.id);
  assert.equal(activationAudit[0].request_id, activated.requestId);
  assert.deepEqual(activationAudit[0].metadata, { current_status: "ACTIVE", previous_status: "INACTIVE" });
  assert.match(runtimeOutput, /AAZIRA backend listening on port 4000/);
  console.log(JSON.stringify({
    activation: activated.status,
    auditEvents: 2,
    companyAccess: 200,
    deactivation: deactivated.status,
    health: 200,
    hotelRoleRejections: 5,
    operationalDatabaseMutations: 0,
  }));
} finally {
  if (backend && backend.exitCode === null) {
    backend.kill("SIGTERM");
    await new Promise(resolve => backend.once("close", resolve));
  }
  if (scopedPool) await scopedPool.end();
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [testDatabase]);
  await admin.query(`DROP DATABASE IF EXISTS "${testDatabase}"`);
  await admin.end();
}
