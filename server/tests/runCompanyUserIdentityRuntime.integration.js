import "dotenv/config";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { Pool } from "pg";

const operational = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(operational.hostname) && operational.pathname === "/hms", "Local hms only");
const testDatabase = `hms_phase10_runtime_${randomBytes(6).toString("hex")}`;
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
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:4000/api/health");
      if (response.ok) return response;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Current-source backend did not become healthy on port 4000.");
}

async function request(method, path, { body, cookie, expected } = {}) {
  const response = await fetch(`http://127.0.0.1:4000${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  if (expected !== undefined) assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return { payload, response, status: response.status };
}

function cookie(response) {
  return (response.headers.get("set-cookie") || "").match(/aazira_auth=([^;]+)/)?.[0] || null;
}

try {
  const existingListener = await fetch("http://127.0.0.1:4000/api/health").catch(() => null);
  assert.equal(existingListener, null, "Port 4000 already has a listener; refusing to trust stale runtime state.");
  await admin.query(`CREATE DATABASE "${testDatabase}"`);
  const scoped = new URL(process.env.DATABASE_URL);
  scoped.pathname = `/${testDatabase}`;
  const environment = { ...process.env, DATABASE_URL: scoped.toString(), PORT: "4000" };
  await run(["node_modules/prisma/build/index.js", "migrate", "deploy"], environment);
  scopedPool = new Pool({ connectionString: scoped.toString() });

  const definitions = [
    ["SUPER_ADMIN", "Super Admin", "COMPANY"],
    ["HOTEL_ADMIN", "Admin", "HOTEL"],
    ["MANAGER", "Manager", "HOTEL"],
    ["RECEPTION", "Reception", "HOTEL"],
    ["CAPTAIN", "Captain", "HOTEL"],
    ["KITCHEN", "Kitchen", "HOTEL"],
  ];
  for (const [key, name, scope] of definitions) {
    await scopedPool.query(
      "INSERT INTO role (name, system_key, scope, is_protected) VALUES ($1, $2, $3::role_scope, true) ON CONFLICT DO NOTHING",
      [name, key, scope],
    );
  }
  const roles = Object.fromEntries((await scopedPool.query("SELECT id, system_key, scope FROM role")).rows.map(role => [role.system_key, role]));
  const hotelA = randomUUID();
  const hotelB = randomUUID();
  await scopedPool.query("INSERT INTO hotel (id, name) VALUES ($1, 'Runtime Identity A'), ($2, 'Runtime Identity B')", [hotelA, hotelB]);
  const password = `Runtime-${randomUUID()}`;
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  async function addUser(label, assignments) {
    const userId = randomUUID();
    const email = `${label}-${userId}@phase10-runtime.invalid`;
    await scopedPool.query("INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)", [userId, email, passwordHash, label]);
    const assignmentIds = [];
    for (const input of assignments) {
      const id = randomUUID();
      const role = roles[input.roleKey];
      await scopedPool.query(
        "INSERT INTO user_role (id, user_id, role_id, role_scope, status, hotel_id) VALUES ($1, $2, $3, $4::role_scope, $5::assignment_status, $6)",
        [id, userId, role.id, role.scope, input.status || "ACTIVE", input.hotelId ?? null],
      );
      assignmentIds.push(id);
    }
    return { assignmentIds, email, userId };
  }

  const company = await addUser("company", [{ roleKey: "SUPER_ADMIN" }]);
  const secondSuper = await addUser("second-super", [{ roleKey: "SUPER_ADMIN" }]);
  const target = await addUser("target", [
    { hotelId: hotelA, roleKey: "HOTEL_ADMIN" },
    { hotelId: hotelB, roleKey: "MANAGER" },
    { hotelId: hotelB, roleKey: "HOTEL_ADMIN", status: "INACTIVE" },
  ]);
  const nonCompany = {};
  for (const roleKey of ["HOTEL_ADMIN", "MANAGER", "RECEPTION", "CAPTAIN", "KITCHEN"]) {
    nonCompany[roleKey] = await addUser(roleKey.toLowerCase(), [{ hotelId: hotelA, roleKey }]);
  }

  backend = spawn(process.execPath, ["server/server.js"], { cwd: process.cwd(), env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let runtimeOutput = "";
  backend.stdout.on("data", chunk => { runtimeOutput += chunk; process.stdout.write(chunk); });
  backend.stderr.on("data", chunk => { runtimeOutput += chunk; process.stderr.write(chunk); });
  const health = await waitForHealth();
  assert.equal((await health.json()).database, "connected");

  const companyLogin = await request("POST", "/api/auth/login", { body: { identifier: company.email, password, remember: false }, expected: 200 });
  const companyCookie = cookie(companyLogin.response);
  assert.ok(companyCookie);
  assert.equal((await request("POST", `/api/company/users/${target.userId}/deactivate`, { body: {}, expected: 401 })).payload.error.code, "UNAUTHENTICATED");
  const authorization = { SUPER_ADMIN: 200, unauthenticated: 401 };
  for (const roleKey of ["HOTEL_ADMIN", "MANAGER", "RECEPTION", "CAPTAIN", "KITCHEN"]) {
    const login = await request("POST", "/api/auth/login", { body: { identifier: nonCompany[roleKey].email, password, remember: false }, expected: 200 });
    const denied = await request("POST", `/api/company/users/${target.userId}/deactivate`, { body: {}, cookie: cookie(login.response), expected: 403 });
    assert.equal(denied.payload.error.code, "COMPANY_SCOPE_REQUIRED");
    authorization[roleKey] = 403;
  }

  let targetLogin = await request("POST", "/api/auth/login", { body: { identifier: target.email, password, remember: false }, expected: 409 });
  const staleChallenge = targetLogin.payload.contextSelection.challenge;
  const selectedTarget = await request("POST", "/api/auth/context", { body: { assignmentId: target.assignmentIds[0], challenge: staleChallenge }, expected: 200 });
  const targetCookie = cookie(selectedTarget.response);
  targetLogin = await request("POST", "/api/auth/login", { body: { identifier: target.email, password, remember: false }, expected: 409 });
  const outstandingChallenge = targetLogin.payload.contextSelection.challenge;
  const assignmentsBefore = (await scopedPool.query("SELECT id, hotel_id, role_id, role_scope, status, restore_on_identity_reactivation FROM user_role WHERE user_id = $1 ORDER BY id", [target.userId])).rows;

  const deactivated = await request("POST", `/api/company/users/${target.userId}/deactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  assert.equal(deactivated.payload.data.changed, true);
  assert.equal((await scopedPool.query("SELECT is_active FROM users WHERE id = $1", [target.userId])).rows[0].is_active, false);
  const assignmentsAfterDeactivation = (await scopedPool.query("SELECT id, hotel_id, role_id, role_scope, status, restore_on_identity_reactivation FROM user_role WHERE user_id = $1 ORDER BY id", [target.userId])).rows;
  assert.equal(assignmentsAfterDeactivation.find(item => item.id === target.assignmentIds[0]).status, "INACTIVE");
  assert.equal(assignmentsAfterDeactivation.find(item => item.id === target.assignmentIds[0]).restore_on_identity_reactivation, true);
  assert.equal(assignmentsAfterDeactivation.find(item => item.id === target.assignmentIds[1]).status, "ACTIVE");
  assert.equal((await request("GET", "/api/auth/session", { cookie: targetCookie, expected: 401 })).payload.error.code, "UNAUTHENTICATED");
  assert.equal((await request("POST", "/api/auth/login", { body: { identifier: target.email, password, remember: false }, expected: 401 })).payload.error.code, "INVALID_CREDENTIALS");
  assert.equal((await request("POST", "/api/auth/context", { body: { assignmentId: target.assignmentIds[0], challenge: outstandingChallenge }, expected: 403 })).payload.error.code, "CONTEXT_SELECTION_INVALID");

  const reactivated = await request("POST", `/api/company/users/${target.userId}/reactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  assert.equal(reactivated.payload.data.changed, true);
  assert.equal((await scopedPool.query("SELECT is_active FROM users WHERE id = $1", [target.userId])).rows[0].is_active, true);
  assert.deepEqual((await scopedPool.query("SELECT id, hotel_id, role_id, role_scope, status, restore_on_identity_reactivation FROM user_role WHERE user_id = $1 ORDER BY id", [target.userId])).rows, assignmentsBefore);
  const restoredLogin = await request("POST", "/api/auth/login", { body: { identifier: target.email, password, remember: false }, expected: 409 });
  assert.deepEqual(restoredLogin.payload.contextSelection.assignments.map(item => item.assignmentId).sort(), target.assignmentIds.slice(0, 2).sort());

  await request("POST", `/api/company/users/${secondSuper.userId}/deactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  const finalSuper = await request("POST", `/api/company/users/${company.userId}/deactivate`, { body: {}, cookie: companyCookie, expected: 409 });
  assert.equal(finalSuper.payload.error.code, "FINAL_ACTIVE_SUPER_ADMIN_REQUIRED");
  await request("POST", `/api/company/users/${secondSuper.userId}/reactivate`, { body: {}, cookie: companyCookie, expected: 200 });

  const audits = (await scopedPool.query(
    "SELECT action, actor_user_id, actor_assignment_id, actor_scope, hotel_id, target_id, target_type, metadata FROM audit_event ORDER BY occurred_at, id",
  )).rows;
  const targetAudits = audits.filter(item => item.target_id === target.userId);
  assert.deepEqual(targetAudits.map(item => item.action), ["HOTEL_ADMIN_IDENTITY_DEACTIVATED", "HOTEL_ADMIN_IDENTITY_REACTIVATED"]);
  assert.ok(targetAudits.every(item => item.actor_user_id === company.userId
    && item.actor_assignment_id === company.assignmentIds[0]
    && item.actor_scope === "COMPANY"
    && item.hotel_id === null
    && item.target_type === "USER_IDENTITY"));
  assert.match(runtimeOutput, /AAZIRA backend listening on port 4000/);
  console.log(JSON.stringify({
    assignmentsPreserved: true,
    audits: targetAudits.length,
    authorization,
    contextChallengeAfterDeactivation: 403,
    contextSelectionAfterReactivation: 409,
    deactivatedSession: 401,
    finalSuperAdminProtection: 409,
    freshLoginWhileInactive: 401,
    health: 200,
    operationalDatabaseMutations: 0,
    reactivated: 200,
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
