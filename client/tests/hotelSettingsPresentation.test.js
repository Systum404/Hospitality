import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("Hotel Admin settings use authoritative APIs without browser-local financial preferences", async () => {
  const [page, service] = await Promise.all([
    read("../src/features/admin/pages/AdminSettingsPage.jsx"),
    read("../src/features/settings/services/hotelSettingsService.js"),
  ]);
  assert.match(page, /getHotelSettings\(user\.hotelId/);
  assert.match(page, /updateHotelMetadata\(user\.hotelId/);
  assert.match(page, /updateHotelBillingSettings\(user\.hotelId/);
  assert.doesNotMatch(page, /localStorage|Auto Print|Round Off|Currency/);
  assert.match(service, /base\(hotelId\)\}\/billing/);
  assert.match(service, /base\(hotelId\)\}\/hotel/);
});

test("Manager navigation no longer exposes Settings", async () => {
  const config = await read("../src/features/manager/managerConfig.js");
  assert.doesNotMatch(config, /label: "Settings"|\/manager\/settings|\bSettings\b/);
});

test("Manager old Settings view is no longer rendered", async () => {
  const [page, breadcrumb] = await Promise.all([
    read("../src/features/manager/pages/ManagerDashboard.jsx"),
    read("../src/components/navigation/Breadcrumb.jsx"),
  ]);
  assert.doesNotMatch(page, /ManagerSettingsView|Read-only hotel billing configuration|getHotelSettings|view === "settings"/);
  assert.doesNotMatch(breadcrumb, /\/manager\/settings/);
  assert.match(page, /title="Page not found"/);
});

test("Hotel Admin navigation and route retain Settings", async () => {
  const [config, routes] = await Promise.all([
    read("../src/features/admin/adminConfig.js"),
    read("../src/app/routes.jsx"),
  ]);
  assert.match(config, /label: "Settings", to: "\/admin\/settings"/);
  assert.match(routes, /path: "admin\/settings", element: <AdminSettingsPage \/>/);
});

test("bill presentation exposes service charge separately without tax registration", async () => {
  const [summary, receipt, customer] = await Promise.all([
    read("../src/features/billing/components/BillingAdjustments.jsx"),
    read("../src/features/reception/components/BillReceipt.jsx"),
    read("../src/features/public-ordering/components/CustomerBillingDocument.jsx"),
  ]);
  for (const source of [summary, receipt, customer]) assert.match(source, /Service [Cc]harge|service charge/);
  assert.doesNotMatch(customer, /tax_registration|GST Number/);
});

test("new bill selection preserves backend default-tax preselection semantics", async () => {
  const source = await read("../src/features/billing/components/BillingAdjustments.jsx");
  assert.match(source, /emptyBillingSelection = \{ tax_slab_id: undefined/);
  assert.match(source, /tax_slab_id: event\.target\.value \|\| null/);
});
