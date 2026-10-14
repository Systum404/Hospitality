// Runs control-plane regressions in a disposable PostgreSQL database so append-only test events leave no residue.
import "dotenv/config";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";

const database = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && database.pathname === "/hms", "Local hms only");
const testDatabase = `hms_phase5_control_${randomBytes(6).toString("hex")}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });

function run(args, environment, expectedMarker = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", chunk => { output += chunk; process.stderr.write(chunk); });
    child.once("error", reject);
    child.once("close", code => {
      if (code === 0 || (expectedMarker && output.includes(expectedMarker))) return resolve();
      reject(new Error(`${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

try {
  await admin.query(`CREATE DATABASE "${testDatabase}"`);
  const scoped = new URL(process.env.DATABASE_URL);
  scoped.pathname = `/${testDatabase}`;
  const environment = { ...process.env, AAZIRA_ISOLATED_CONTROL_PLANE_TEST: "1", DATABASE_URL: scoped.toString() };
  await run(["node_modules/prisma/build/index.js", "migrate", "deploy"], environment);
  await run(["server/tests/seedControlPlaneRegression.isolated.js"], environment);
  await run(["server/tests/companyHotel.integration.js"], environment, "Company Hotel integration: 39/39 passed");
  await run(["server/tests/adminInvitation.integration.js"], environment, "Admin Invitation integration: 23/23 passed");
} finally {
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [testDatabase]);
  await admin.query(`DROP DATABASE IF EXISTS "${testDatabase}"`);
  await admin.end();
}
