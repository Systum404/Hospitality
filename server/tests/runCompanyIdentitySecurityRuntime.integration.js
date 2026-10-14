import "dotenv/config";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { Pool } from "pg";

const database = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && database.pathname === "/hms", "Local hms only");
const testDatabase = `hms_phase11_runtime_${randomBytes(6).toString("hex")}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
let scopedPool;
let backend;

function run(args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(`${args.join(" ")} failed with exit code ${code}`)));
  });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch("http://127.0.0.1:4000/api/health").catch(() => null);
    if (response?.ok) return response;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Backend did not become healthy.");
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
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return { payload, response };
}

function cookie(response) {
  return (response.headers.get("set-cookie") || "").match(/aazira_auth=([^;]+)/)?.[0] || null;
}

try {
  assert.equal(await fetch("http://127.0.0.1:4000/api/health").catch(() => null), null, "Port 4000 already has a listener; refusing stale runtime state.");
  await admin.query(`CREATE DATABASE "${testDatabase}"`);
  const scoped = new URL(process.env.DATABASE_URL);
  scoped.pathname = `/${testDatabase}`;
  const environment = { ...process.env, DATABASE_URL: scoped.toString(), PORT: "4000" };
  await run(["node_modules/prisma/build/index.js", "migrate", "deploy"], environment);
  scopedPool = new Pool({ connectionString: scoped.toString() });

  const roles = [
    ["SUPER_ADMIN", "Super Admin", "COMPANY"],
    ["HOTEL_ADMIN", "Admin", "HOTEL"],
    ["MANAGER", "Manager", "HOTEL"],
  ];
  for (const [key, name, scope] of roles) {
    await scopedPool.query("INSERT INTO role (name, system_key, scope, is_protected) VALUES ($1, $2, $3::role_scope, true) ON CONFLICT DO NOTHING", [name, key, scope]);
  }
  const roleRows = Object.fromEntries((await scopedPool.query("SELECT id, system_key, scope FROM role")).rows.map(role => [role.system_key, role]));
  const hotelA = randomUUID();
  const hotelB = randomUUID();
  const hotelC = randomUUID();
  await scopedPool.query("INSERT INTO hotel (id, name) VALUES ($1, 'Runtime A'), ($2, 'Runtime B'), ($3, 'Runtime C')", [hotelA, hotelB, hotelC]);

  async function addUser(label, password, assignments) {
    const userId = randomUUID();
    const email = `${label}-${userId}@phase11-runtime.invalid`;
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await scopedPool.query("INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)", [userId, email, hash, label]);
    const assignmentIds = [];
    for (const assignment of assignments) {
      const id = randomUUID();
      const role = roleRows[assignment.roleKey];
      await scopedPool.query(
        "INSERT INTO user_role (id, user_id, role_id, role_scope, status, hotel_id) VALUES ($1, $2, $3, $4::role_scope, $5::assignment_status, $6)",
        [id, userId, role.id, role.scope, assignment.status || "ACTIVE", assignment.hotelId ?? null],
      );
      assignmentIds.push(id);
    }
    return { assignmentIds, email, password, userId };
  }

  const company = await addUser("company", `Company-${randomUUID()}`, [{ roleKey: "SUPER_ADMIN" }]);
  await addUser("second-super", `Second-${randomUUID()}`, [{ roleKey: "SUPER_ADMIN" }]);
  const target = await addUser("target", `Target-${randomUUID()}`, [
    { hotelId: hotelA, roleKey: "HOTEL_ADMIN" },
    { hotelId: hotelB, roleKey: "HOTEL_ADMIN" },
    { hotelId: hotelC, roleKey: "HOTEL_ADMIN", status: "INACTIVE" },
    { hotelId: hotelA, roleKey: "MANAGER" },
  ]);
  const manager = await addUser("manager", `Manager-${randomUUID()}`, [{ hotelId: hotelA, roleKey: "MANAGER" }]);

  backend = spawn(process.execPath, ["server/server.js"], { cwd: process.cwd(), env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let runtimeOutput = "";
  backend.stdout.on("data", chunk => { runtimeOutput += chunk; process.stdout.write(chunk); });
  backend.stderr.on("data", chunk => { runtimeOutput += chunk; process.stderr.write(chunk); });
  const health = await waitForHealth();
  assert.equal((await health.json()).database, "connected");

  const companyCookie = cookie((await request("POST", "/api/auth/login", {
    body: { identifier: company.email, password: company.password }, expected: 200,
  })).response);
  const managerCookie = cookie((await request("POST", "/api/auth/login", {
    body: { identifier: manager.email, password: manager.password }, expected: 200,
  })).response);
  assert.equal((await request("POST", `/api/company/users/${target.userId}/password-reset`, { body: {}, cookie: managerCookie, expected: 403 })).payload.error.code, "COMPANY_SCOPE_REQUIRED");

  const before = await request("POST", "/api/auth/login", { body: { identifier: target.email, password: target.password }, expected: 409 });
  const selected = await request("POST", "/api/auth/context", {
    body: { assignmentId: target.assignmentIds[0], challenge: before.payload.contextSelection.challenge }, expected: 200,
  });
  const oldCookie = cookie(selected.response);
  await request("POST", `/api/company/users/${target.userId}/deactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  const deactivatedAssignments = (await scopedPool.query(
    "SELECT id, status, restore_on_identity_reactivation FROM user_role WHERE user_id=$1 ORDER BY id", [target.userId],
  )).rows;
  assert.equal(deactivatedAssignments.filter(item => item.status === "INACTIVE" && item.restore_on_identity_reactivation).length, 2);
  assert.equal((await request("GET", "/api/auth/session", { cookie: oldCookie, expected: 401 })).payload.error.code, "UNAUTHENTICATED");
  await request("POST", `/api/company/users/${target.userId}/reactivate`, { body: {}, cookie: companyCookie, expected: 200 });
  assert.equal((await scopedPool.query(
    "SELECT COUNT(*)::integer count FROM user_role WHERE user_id=$1 AND status='ACTIVE' AND restore_on_identity_reactivation=false", [target.userId],
  )).rows[0].count, 3);
  assert.equal((await request("GET", "/api/auth/session", { cookie: oldCookie, expected: 401 })).payload.error.code, "UNAUTHENTICATED");

  const reset = await request("POST", `/api/company/users/${target.userId}/password-reset`, { body: {}, cookie: companyCookie, expected: 200 });
  const temporaryPassword = reset.payload.data.temporaryPassword;
  assert.equal((await request("POST", "/api/auth/login", { body: { identifier: target.email, password: target.password }, expected: 401 })).payload.error.code, "INVALID_CREDENTIALS");
  const forced = await request("POST", "/api/auth/login", { body: { identifier: target.email, password: temporaryPassword }, expected: 409 });
  assert.equal(forced.payload.error.code, "PASSWORD_CHANGE_REQUIRED");
  assert.equal(cookie(forced.response), null);
  const permanentPassword = `Permanent-${randomUUID()}`;
  await request("POST", "/api/auth/password-change", {
    body: { challenge: forced.payload.passwordChange.challenge, newPassword: permanentPassword }, expected: 200,
  });
  assert.equal((await request("POST", "/api/auth/login", { body: { identifier: target.email, password: temporaryPassword }, expected: 401 })).payload.error.code, "INVALID_CREDENTIALS");
  assert.equal((await request("POST", "/api/auth/login", { body: { identifier: target.email, password: permanentPassword }, expected: 409 })).payload.error.code, "ACCOUNT_CONTEXT_REQUIRED");

  const auditRows = (await scopedPool.query(
    "SELECT action, actor_user_id, actor_assignment_id, actor_scope, metadata FROM audit_event WHERE target_id=$1 ORDER BY occurred_at, id", [target.userId],
  )).rows;
  assert.deepEqual(auditRows.map(item => item.action), [
    "HOTEL_ADMIN_IDENTITY_DEACTIVATED",
    "HOTEL_ADMIN_IDENTITY_REACTIVATED",
    "USER_PASSWORD_RESET",
    "USER_PASSWORD_CHANGED",
  ]);
  assert.equal(JSON.stringify(auditRows).includes(temporaryPassword), false);
  assert.equal((await scopedPool.query("SELECT COUNT(*)::integer count FROM auth_context_challenge")).rows[0].count, 1);
  assert.equal((await scopedPool.query("SELECT COUNT(*)::integer count FROM password_change_challenge")).rows[0].count, 0);
  assert.match(runtimeOutput, /AAZIRA backend listening on port 4000/);
  console.log(JSON.stringify({
    assignmentRestoration: "2 active restored; 1 inactive preserved",
    authorization: { MANAGER: 403, SUPER_ADMIN: 200 },
    forcedPasswordChange: 200,
    health: 200,
    oldSessionAfterDeactivationAndReactivation: 401,
    passwordAudits: 2,
    temporaryCredentialAfterChange: 401,
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
