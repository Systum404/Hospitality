import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { app } from "../app.js";
import { environment } from "../config/environment.js";

const checks = [];
const pass = name => checks.push(name);

function environmentProbe(overrides) {
  const probe = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    "import('./server/config/environment.js')",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://deployment-check.invalid/aazira",
      AUTH_SECRET: "x".repeat(32),
      CORS_ORIGIN: "https://aazira.example.invalid",
      TRUST_PROXY: "",
      ...overrides,
    },
  });
  return { ok: probe.status === 0, diagnostic: `${probe.stderr || ""}${probe.stdout || ""}` };
}

function expectConfigurationFailure(overrides, expectedText, name) {
  const result = environmentProbe(overrides);
  assert.equal(result.ok, false, name);
  assert.match(result.diagnostic, expectedText, name);
  pass(name);
}

function productionCookieProbe() {
  return spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `import { app } from './server/app.js';
     import { prisma } from './server/db/prisma.js';
     const server = app.listen(0, '127.0.0.1');
     await new Promise(resolve => server.once('listening', resolve));
     const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/auth/logout', { method: 'POST', headers: { Origin: process.env.CORS_ORIGIN } });
     const cookie = response.headers.get('set-cookie') || '';
     if (response.status !== 200 || !/HttpOnly/i.test(cookie) || !/Secure/i.test(cookie) || !/SameSite=Strict/i.test(cookie)) process.exitCode = 1;
     await new Promise(resolve => server.close(resolve));
     await prisma.$disconnect();`,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://deployment-check.invalid/aazira",
      AUTH_SECRET: "x".repeat(32),
      CORS_ORIGIN: "https://aazira.example.invalid",
      TRUST_PROXY: "",
    },
  });
}

const validConfiguration = environmentProbe({
  CORS_ORIGIN: "https://aazira.example.invalid,https://staff.example.invalid",
  TRUST_PROXY: "127.0.0.1,10.0.0.0/8,2001:db8::/32",
});
assert.equal(validConfiguration.ok, true, validConfiguration.diagnostic);
pass("explicit HTTPS origins and IP/CIDR proxy ranges are accepted");

expectConfigurationFailure({ CORS_ORIGIN: "" }, /Missing required environment variable: CORS_ORIGIN/, "missing production CORS origin fails startup");
expectConfigurationFailure({ CORS_ORIGIN: "not-an-origin" }, /valid HTTP\(S\) origins/, "malformed CORS origin fails startup");
expectConfigurationFailure({ CORS_ORIGIN: "http://aazira.example.invalid" }, /only HTTPS origins in production/, "non-HTTPS production CORS origin fails startup");
expectConfigurationFailure({ CORS_ORIGIN: "https://aazira.example.invalid/path" }, /without paths or wildcards/, "CORS origin path fails startup");
expectConfigurationFailure({ CORS_ORIGIN: "*" }, /valid HTTP\(S\) origins|without paths or wildcards/, "wildcard CORS origin fails startup");
expectConfigurationFailure({ TRUST_PROXY: "true" }, /explicit IP addresses or CIDR ranges/, "blanket proxy trust fails startup");
expectConfigurationFailure({ TRUST_PROXY: "10.0.0.0/99" }, /explicit IP addresses or CIDR ranges/, "malformed proxy range fails startup");
expectConfigurationFailure({ DATABASE_URL: "" }, /Missing required environment variable: DATABASE_URL/, "missing database URL fails startup");
expectConfigurationFailure({ AUTH_SECRET: "too-short" }, /at least 32 characters/, "short authentication secret fails startup");

const cookieProbe = productionCookieProbe();
assert.equal(cookieProbe.status, 0, `${cookieProbe.stderr || ""}${cookieProbe.stdout || ""}`);
pass("production authentication cookie is Secure, HttpOnly, and SameSite=Strict");

const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const allowedOrigin = environment.corsOrigins[0];

const edge = http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) {
    const upstream = http.request({
      hostname: "127.0.0.1",
      port: server.address().port,
      path: req.url,
      method: req.method,
      headers: req.headers,
    }, response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on("error", error => { res.writeHead(502); res.end(error.message); });
    req.pipe(upstream);
    return;
  }

  const requestedAsset = /^\/assets\/[A-Za-z0-9._-]+$/.test(req.url)
    ? path.join(process.cwd(), "client", "dist", req.url)
    : null;
  try {
    const body = await readFile(requestedAsset || path.join(process.cwd(), "client", "dist", "index.html"));
    res.setHeader("Content-Type", requestedAsset?.endsWith(".js") ? "text/javascript" : requestedAsset?.endsWith(".css") ? "text/css" : "text/html");
    res.setHeader("Cache-Control", requestedAsset ? "public, max-age=31536000, immutable" : "no-cache");
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
edge.listen(0, "127.0.0.1");
await new Promise(resolve => edge.once("listening", resolve));
const edgeOrigin = `http://127.0.0.1:${edge.address().port}`;

try {
  const api404 = await fetch(`${origin}/api/edge-verification/not-found`, {
    headers: { Origin: allowedOrigin },
  });
  assert.equal(api404.status, 404);
  assert.match(api404.headers.get("content-type") || "", /application\/json/);
  assert.equal((await api404.json()).error.code, "ROUTE_NOT_FOUND");
  assert.equal(api404.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.equal(api404.headers.get("access-control-allow-credentials"), "true");
  pass("API 404 remains JSON with exact-origin credentialed CORS");

  const disallowedGet = await fetch(`${origin}/api/edge-verification/not-found`, {
    headers: { Origin: "https://untrusted.example.invalid" },
  });
  assert.equal(disallowedGet.headers.get("access-control-allow-origin"), null);
  pass("disallowed read origin receives no CORS grant");

  const disallowedWrite = await fetch(`${origin}/api/edge-verification/not-found`, {
    method: "POST",
    headers: { Origin: "https://untrusted.example.invalid" },
  });
  assert.equal(disallowedWrite.status, 403);
  assert.equal((await disallowedWrite.json()).error.code, "UNTRUSTED_ORIGIN");
  pass("disallowed write origin is rejected");

  const originlessWrite = await fetch(`${origin}/api/edge-verification/not-found`, { method: "POST" });
  assert.equal(originlessWrite.status, 404);
  assert.equal((await originlessWrite.json()).error.code, "ROUTE_NOT_FOUND");
  pass("originless non-browser API request remains routable");

  const publicResponse = await fetch(`${origin}/api/public/qr/invalid`);
  assert.equal(publicResponse.status, 404);
  assert.match(publicResponse.headers.get("cache-control") || "", /no-store/);
  assert.equal(publicResponse.headers.get("pragma"), "no-cache");
  pass("public QR responses prohibit caching even on errors");

  assert.match(api404.headers.get("strict-transport-security") || "", /max-age=/);
  assert.equal(api404.headers.get("x-content-type-options"), "nosniff");
  assert.equal(api404.headers.get("x-powered-by"), null);
  pass("API responses retain Helmet security headers and suppress framework disclosure");

  if (environment.trustedProxies.length === 0) {
    assert.equal(app.get("trust proxy"), false);
    pass("proxy trust remains disabled when no proxy range is configured");

    let rateLimited = false;
    for (let index = 0; index < 121 && !rateLimited; index += 1) {
      const response = await fetch(`${origin}/api/public/qr/invalid`, {
        headers: { "X-Forwarded-For": `198.51.100.${(index % 250) + 1}` },
      });
      rateLimited = response.status === 429;
    }
    assert.equal(rateLimited, true);
    pass("spoofed forwarded client addresses cannot bypass direct-request IP limiting");
  }

  const edgeApi404 = await fetch(`${edgeOrigin}/api/edge-verification/not-found`);
  assert.equal(edgeApi404.status, 404);
  assert.match(edgeApi404.headers.get("content-type") || "", /application\/json/);
  assert.equal((await edgeApi404.json()).error.code, "ROUTE_NOT_FOUND");
  pass("local production-like edge forwards API paths without SPA fallback");

  const directQr = await fetch(`${edgeOrigin}/qr/example-token`);
  assert.equal(directQr.status, 200);
  assert.match(directQr.headers.get("content-type") || "", /text\/html/);
  assert.match(directQr.headers.get("cache-control") || "", /no-cache/);
  assert.match(await directQr.text(), /<div id="root"><\/div>/);
  pass("local production-like edge serves SPA entry for direct QR navigation");

  const builtIndex = await readFile(path.join(process.cwd(), "client", "dist", "index.html"), "utf8");
  const assetPath = builtIndex.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
  assert.ok(assetPath);
  const asset = await fetch(`${edgeOrigin}${assetPath}`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("cache-control") || "", /immutable/);
  pass("local production-like edge can cache content-hashed assets independently");
} finally {
  await Promise.all([
    new Promise(resolve => edge.close(resolve)),
    new Promise(resolve => server.close(resolve)),
  ]);
}

console.log(`Production edge integration: ${checks.length}/${checks.length} checks passed.`);
