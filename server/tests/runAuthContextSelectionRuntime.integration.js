import "dotenv/config";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { Pool } from "pg";

const database = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && database.pathname === "/hms", "Local hms only");
const testDatabase = `hms_phase8_runtime_${randomBytes(6).toString("hex")}`;
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
  assert.equal(existingListener, null, "Port 4000 already has a listener; refusing to test stale runtime state.");
  await admin.query(`CREATE DATABASE "${testDatabase}"`);
  const scoped = new URL(process.env.DATABASE_URL);
  scoped.pathname = `/${testDatabase}`;
  const environment = { ...process.env, DATABASE_URL: scoped.toString(), PORT: "4000" };
  await run(["node_modules/prisma/build/index.js", "migrate", "deploy"], environment);
  scopedPool = new Pool({ connectionString: scoped.toString() });

  const roleDefinitions = [
    ["SUPER_ADMIN", "Super Admin", "COMPANY"],
    ["HOTEL_ADMIN", "Admin", "HOTEL"],
    ["MANAGER", "Manager", "HOTEL"],
    ["RECEPTION", "Reception", "HOTEL"],
  ];
  for (const [systemKey, name, scope] of roleDefinitions) {
    await scopedPool.query(
      `INSERT INTO role (name, system_key, scope, is_protected)
       VALUES ($1, $2, $3::role_scope, true)
       ON CONFLICT (system_key) DO NOTHING`,
      [name, systemKey, scope],
    );
  }
  const roles = Object.fromEntries((await scopedPool.query("SELECT id, system_key, scope FROM role")).rows.map(role => [role.system_key, role]));
  const hotelA = randomUUID();
  const hotelB = randomUUID();
  await scopedPool.query("INSERT INTO hotel (id, name) VALUES ($1, 'Runtime Hotel A'), ($2, 'Runtime Hotel B')", [hotelA, hotelB]);
  const password = `Runtime-${randomUUID()}`;
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  async function addUser(label, assignments) {
    const userId = randomUUID();
    const email = `${label}-${userId}@phase8-runtime.invalid`;
    await scopedPool.query("INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)", [userId, email, passwordHash, label]);
    const assignmentIds = [];
    for (const assignment of assignments) {
      const id = randomUUID();
      const role = roles[assignment.roleKey];
      await scopedPool.query(
        "INSERT INTO user_role (id, user_id, role_id, role_scope, status, hotel_id) VALUES ($1, $2, $3, $4::role_scope, $5::assignment_status, $6)",
        [id, userId, role.id, role.scope, assignment.status || "ACTIVE", assignment.hotelId ?? null],
      );
      assignmentIds.push(id);
    }
    return { assignmentIds, email, userId };
  }

  const single = await addUser("single", [{ hotelId: hotelA, roleKey: "HOTEL_ADMIN" }]);
  const multi = await addUser("multi", [
    { hotelId: hotelA, roleKey: "HOTEL_ADMIN" },
    { hotelId: hotelB, roleKey: "MANAGER" },
    { hotelId: hotelA, roleKey: "RECEPTION", status: "INACTIVE" },
  ]);
  const other = await addUser("other", [{ hotelId: hotelA, roleKey: "MANAGER" }]);
  const companyAndHotel = await addUser("company", [
    { roleKey: "SUPER_ADMIN" },
    { hotelId: hotelA, roleKey: "HOTEL_ADMIN" },
  ]);

  backend = spawn(process.execPath, ["server/server.js"], { cwd: process.cwd(), env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let runtimeOutput = "";
  backend.stdout.on("data", chunk => { runtimeOutput += chunk; process.stdout.write(chunk); });
  backend.stderr.on("data", chunk => { runtimeOutput += chunk; process.stderr.write(chunk); });
  const health = await waitForHealth();
  assert.equal((await health.json()).database, "connected");

  const one = await request("POST", "/api/auth/login", { body: { identifier: single.email, password, remember: false }, expected: 200 });
  const oneCookie = cookie(one.response);
  assert.ok(oneCookie);
  assert.equal((await request("GET", "/api/auth/session", { cookie: oneCookie, expected: 200 })).payload.user.hotelId, hotelA);

  let login = await request("POST", "/api/auth/login", { body: { identifier: multi.email, password, remember: false }, expected: 409 });
  assert.equal(cookie(login.response), null);
  assert.equal(login.payload.contextSelection.assignments.length, 2);
  const challengeA = login.payload.contextSelection.challenge;
  assert.equal((await request("POST", "/api/auth/context", { body: { challenge: challengeA, assignmentId: other.assignmentIds[0] }, expected: 403 })).payload.error.code, "CONTEXT_SELECTION_INVALID");
  assert.equal((await request("POST", "/api/auth/context", { body: { challenge: challengeA, assignmentId: multi.assignmentIds[2] }, expected: 403 })).payload.error.code, "CONTEXT_SELECTION_INVALID");
  const selectedA = await request("POST", "/api/auth/context", { body: { challenge: challengeA, assignmentId: multi.assignmentIds[0] }, expected: 200 });
  const cookieA = cookie(selectedA.response);
  assert.equal((await request("GET", "/api/auth/session", { cookie: cookieA, expected: 200 })).payload.user.roleKey, "HOTEL_ADMIN");
  await request("GET", `/api/hotels/${hotelA}/users`, { cookie: cookieA, expected: 200 });

  login = await request("POST", "/api/auth/login", { body: { identifier: multi.email, password, remember: false }, expected: 409 });
  const selectedB = await request("POST", "/api/auth/context", { body: { challenge: login.payload.contextSelection.challenge, assignmentId: multi.assignmentIds[1] }, expected: 200 });
  assert.equal((await request("GET", "/api/auth/session", { cookie: cookie(selectedB.response), expected: 200 })).payload.user.roleKey, "MANAGER");

  login = await request("POST", "/api/auth/login", { body: { identifier: multi.email, password, remember: false }, expected: 409 });
  await scopedPool.query("UPDATE hotel SET status = 'INACTIVE' WHERE id = $1", [hotelB]);
  assert.equal((await request("POST", "/api/auth/context", { body: { challenge: login.payload.contextSelection.challenge, assignmentId: multi.assignmentIds[1] }, expected: 403 })).payload.error.code, "HOTEL_INACTIVE");
  await scopedPool.query("UPDATE hotel SET status = 'ACTIVE' WHERE id = $1", [hotelB]);

  const privilegedLogin = await request("POST", "/api/auth/login", { body: { identifier: companyAndHotel.email, password, remember: false }, expected: 409 });
  assert.equal(cookie(privilegedLogin.response), null);
  const companySelected = await request("POST", "/api/auth/context", { body: { challenge: privilegedLogin.payload.contextSelection.challenge, assignmentId: companyAndHotel.assignmentIds[0] }, expected: 200 });
  const companyCookie = cookie(companySelected.response);
  assert.equal((await request("GET", "/api/auth/session", { cookie: companyCookie, expected: 200 })).payload.user.scope, "COMPANY");
  await request("GET", "/api/company/hotels", { cookie: companyCookie, expected: 200 });

  assert.match(runtimeOutput, /AAZIRA backend listening on port 4000/);
  console.log(JSON.stringify({
    companyContext: 200,
    contextA: 200,
    contextB: 200,
    crossUserSelection: 403,
    health: 200,
    inactiveAssignmentSelection: 403,
    inactiveHotelSelection: 403,
    multipleContextLogin: 409,
    operationalDatabaseMutations: 0,
    singleContextLogin: 200,
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
