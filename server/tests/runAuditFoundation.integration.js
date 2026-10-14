// Runs the append-only audit suite in a disposable PostgreSQL schema.
import "dotenv/config";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";

const database = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && database.pathname === "/hms", "Local hms only");
const testDatabase = `hms_phase5_audit_${randomBytes(6).toString("hex")}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });

function run(command, args, environment) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", env: environment, stdio: "pipe" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
}

try {
  await admin.query(`CREATE DATABASE "${testDatabase}"`);
  const scoped = new URL(process.env.DATABASE_URL);
  scoped.pathname = `/${testDatabase}`;
  scoped.searchParams.delete("schema");
  scoped.searchParams.delete("options");
  const environment = { ...process.env, DATABASE_URL: scoped.toString() };
  run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], environment);
  run(process.execPath, ["server/tests/auditFoundation.isolated.js"], environment);
} finally {
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [testDatabase]);
  await admin.query(`DROP DATABASE IF EXISTS "${testDatabase}"`);
  await admin.end();
}
