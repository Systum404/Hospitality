import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const requireFromClient = createRequire(new URL("../../client/package.json", import.meta.url));
const { createServer } = await import(pathToFileURL(requireFromClient.resolve("vite")).href);
const sourcePath = new URL("../../client/src/features/admin/pages/AdminReportsPage.jsx", import.meta.url);
const servicePath = new URL("../../client/src/features/admin/services/adminReportsService.js", import.meta.url);
const source = await readFile(sourcePath, "utf8");
const serviceSource = await readFile(servicePath, "utf8");
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

check(!source.includes("reportsMockData") && !source.includes("reportsByPeriod"), "Admin Reports production page no longer imports mock report data");
for (const label of ["Collections", "Orders", "Average Bill", "Outstanding", "Category Distribution", "Top Items"]) check(source.includes(label), `${label} uses the approved Manager Reports terminology`);
check(source.includes("Order Lifecycle &amp; Billing Breakdown"), "Order Lifecycle and Billing Breakdown use the approved Manager Reports terminology");
for (const oldLabel of ["Total Revenue", "Average Order Value", "Tables Served", "Recent Bills", "Sales bar chart"]) check(!source.includes(oldLabel), `${oldLabel} mock terminology is absent`);
check(source.includes("Loading Hotel Admin reports"), "page has an explicit loading state");
check(source.includes("Unable to load report data"), "page has an explicit API error state");
check(source.includes("No report activity"), "page has an explicit empty state");
check(source.includes("Object.entries(adminReportRangeLabels)"), "page renders the established date-range controls");
check(serviceSource.includes("credentials: \"include\"") && serviceSource.includes("/admin/reports"), "frontend service uses the authenticated Hotel Admin report endpoint");

const report = {
  meta: { range: "today", from: "2026-09-27", to: "2026-09-27", timezone: "Asia/Kolkata", generatedAt: "2026-09-27T10:00:00.000Z", categoryCoverage: { categorizedQuantity: 3, unresolvedQuantity: 1 } },
  summary: { collections: "100.90", orders: 3, averageBill: "150.00", outstanding: "200.10", activeOrders: 1, completedOrders: 2, comparisons: { collections: 10, orders: 20, averageBill: null } },
  orderBreakdown: { roomService: 1, restaurant: 2, captain: 1, diningTableQr: 1 },
  billingBreakdown: { room: { count: 1, total: "200.00", outstanding: "120.00" }, restaurant: { count: 1, total: "100.00", outstanding: "80.10" } },
  trend: [{ key: "2026-09-27 10", label: "10:00", collections: "100.90", orders: 3 }],
  topItems: [{ name: "Persisted Item", quantity: 3, subtotal: "150.00" }],
  categories: [{ name: "Persisted Category", quantity: 3, subtotal: "150.00", percentage: 100 }],
};

const vite = await createServer({ root: path.resolve("client"), server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
const savedWindow = globalThis.window;
globalThis.window = { location: { protocol: "http:", hostname: "localhost" } };
try {
  const pageModule = await vite.ssrLoadModule("/src/features/admin/pages/AdminReportsPage.jsx");
  const serviceModule = await vite.ssrLoadModule("/src/features/admin/services/adminReportsService.js");
  const csv = pageModule.buildAdminReportCsv(report);
  check(csv.startsWith("\uFEFF") && csv.includes('"Collections","100.90","10"'), "CSV exports authoritative collections without client recalculation");
  check(csv.includes('"Room","1","200.00","120.00"') && csv.includes('"Restaurant","1","100.00","80.10"'), "CSV exports the real billing breakdown");
  check(csv.includes('"10:00","100.90","3"') && csv.includes('"Persisted Item","3","150.00"'), "CSV exports real trend and top-item values");
  check(csv.includes('"Persisted Category","3","150.00","100"') && csv.includes('"Unresolved historical item quantity","1"'), "CSV exports category distribution and disclosed historical coverage");
  check(!csv.includes("B-1052") && !csv.includes("Butter Chicken"), "CSV contains no former mock report values");

  const link = { clicked: false, removed: false, click() { this.clicked = true; }, remove() { this.removed = true; } };
  const documentObject = { body: { appendChild(value) { assert.equal(value, link); } }, createElement(value) { assert.equal(value, "a"); return link; } };
  const urlObject = { created: null, revoked: null, createObjectURL(value) { this.created = value; return "blob:report"; }, revokeObjectURL(value) { this.revoked = value; } };
  pageModule.downloadAdminReportCsv(report, documentObject, urlObject);
  check(link.clicked && link.removed && urlObject.revoked === "blob:report", "export downloads and revokes the generated object URL");
  check(link.download === "hotel-admin-report-today-2026-09-27-2026-09-27.csv", "export filename identifies the authoritative range");

  const previousFetch = globalThis.fetch;
  let observed;
  globalThis.fetch = async (url, options) => { observed = { url: String(url), options }; return { ok: true, async json() { return { status: "success", report }; } }; };
  try {
    const returned = await serviceModule.getAdminReport("hotel-id", "month");
    check(returned === report && observed.url.endsWith("/api/hotels/hotel-id/admin/reports?range=month"), "service returns the report from the selected real API range");
    check(observed.options.credentials === "include", "service sends the existing authenticated cookie context");
    globalThis.fetch = async () => ({ ok: false, status: 403, async json() { return { error: { code: "FORBIDDEN", message: "Forbidden" } }; } });
    await assert.rejects(serviceModule.getAdminReport("hotel-id", "today"), error => error.status === 403 && error.code === "FORBIDDEN");
    checks += 1;
  } finally {
    globalThis.fetch = previousFetch;
  }
} finally {
  if (savedWindow === undefined) delete globalThis.window;
  else globalThis.window = savedWindow;
  await vite.close();
}

console.log(`Hotel Admin Reports frontend integration tests passed: ${checks}/${checks}`);
