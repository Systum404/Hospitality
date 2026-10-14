import "dotenv/config";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";

const database = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && database.pathname === "/hms", "Local hms only");
const testDatabase = `hms_super_admin_bootstrap_${randomBytes(6).toString("hex")}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
let scopedPool;

function run(args, environment, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: environment, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
    }
    child.once("error", reject);
    child.once("close", code => resolve({ code, stderr, stdout }));
  });
}

try {
  await admin.query(`CREATE DATABASE "${testDatabase}"`);
  const scoped = new URL(process.env.DATABASE_URL);
  scoped.pathname = `/${testDatabase}`;
  const password = `Bootstrap-${randomUUID()}`;
  const email = "superadmin-bootstrap@development.invalid";
  const environment = {
    ...process.env,
    DATABASE_URL: scoped.toString(),
    DEV_SUPER_ADMIN_EMAIL: email,
    DEV_SUPER_ADMIN_PASSWORD: password,
    NODE_ENV: "test",
  };

  const migration = await run(["node_modules/prisma/build/index.js", "migrate", "deploy"], environment);
  assert.equal(migration.code, 0);
  scopedPool = new Pool({ connectionString: scoped.toString() });

  const production = await run(["server/scripts/bootstrapDevelopmentSuperAdmin.js"], { ...environment, NODE_ENV: "production" }, { capture: true });
  assert.notEqual(production.code, 0);
  assert.match(`${production.stdout}${production.stderr}`, /development or test/);
  assert.equal(`${production.stdout}${production.stderr}`.includes(password), false);

  const first = await run(["server/scripts/bootstrapDevelopmentSuperAdmin.js"], environment, { capture: true });
  assert.equal(first.code, 0, first.stderr);
  const firstOutput = `${first.stdout}${first.stderr}`;
  assert.match(firstOutput, /Development Super Admin bootstrap completed/);
  assert.match(firstOutput, new RegExp(email));
  assert.equal(firstOutput.includes(password), false);
  assert.doesNotMatch(firstOutput, /\$argon2id\$/);

  const firstCounts = await scopedPool.query(`
    SELECT
      (SELECT count(*)::int FROM users WHERE email = $1) AS users,
      (SELECT count(*)::int FROM user_role ur JOIN users u ON u.id = ur.user_id WHERE u.email = $1) AS assignments
  `, [email]);
  assert.deepEqual(firstCounts.rows[0], { assignments: 1, users: 1 });

  const second = await run(["server/scripts/bootstrapDevelopmentSuperAdmin.js"], environment, { capture: true });
  assert.equal(second.code, 0, second.stderr);
  const secondCounts = await scopedPool.query(`
    SELECT
      (SELECT count(*)::int FROM users WHERE email = $1) AS users,
      (SELECT count(*)::int FROM user_role ur JOIN users u ON u.id = ur.user_id WHERE u.email = $1) AS assignments
  `, [email]);
  assert.deepEqual(secondCounts.rows[0], firstCounts.rows[0]);

  const isolated = await run(["server/tests/developmentSuperAdminBootstrap.isolated.js"], environment);
  assert.equal(isolated.code, 0);
  console.log("Development Super Admin bootstrap runner: 6/6 passed");
  console.log("PASS production execution refused");
  console.log("PASS first CLI execution completed safely");
  console.log("PASS command output contains no plaintext password");
  console.log("PASS command output contains no Argon2 hash");
  console.log("PASS first execution created one identity and assignment");
  console.log("PASS second CLI execution remained idempotent");
} finally {
  if (scopedPool) await scopedPool.end();
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [testDatabase]);
  await admin.query(`DROP DATABASE IF EXISTS "${testDatabase}"`);
  await admin.end();
}
