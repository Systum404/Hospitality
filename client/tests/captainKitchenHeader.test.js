import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const vite = await createServer({ root: path.resolve("client"), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
try {
  globalThis.window = { location: { protocol: "http:", hostname: "localhost" } };
  const source = await readFile(path.resolve("client/src/components/layout/Header.jsx"), "utf8");
  const appShellSource = await readFile(path.resolve("client/src/components/layout/AppShell.jsx"), "utf8");
  const providerSource = await readFile(path.resolve("client/src/features/notifications/NotificationRefreshProvider.jsx"), "utf8");
  const serviceSource = await readFile(path.resolve("client/src/features/notifications/services/notificationService.js"), "utf8");
  const { SUPPORTED_STAFF_NOTIFICATION_ROLES } = await vite.ssrLoadModule("/src/features/notifications/services/notificationService.js");
  assert.deepEqual(SUPPORTED_STAFF_NOTIFICATION_ROLES, ["Admin", "Manager", "Reception", "Captain", "Kitchen"], "all staff roles use the shared persisted path");
  assert.ok(source.includes("useNotificationRefresh") && source.includes("const { busy: notificationBusy, data: notificationData") && source.includes("markAllRead") && source.includes("markRead"), "Header consumes notification state and actions through the shared provider hook");
  assert.ok(appShellSource.includes("<NotificationRefreshProvider>") && appShellSource.includes("<Header "), "AppShell renders Header inside NotificationRefreshProvider");
  assert.ok(providerSource.includes('from "./services/notificationService.js"') && providerSource.includes("createNotificationPoller") && providerSource.includes("NotificationRefreshContext.Provider"), "provider owns the persisted service, polling, and shared context");
  assert.ok(!source.includes("managerMockData") && !source.includes("localStorage"), "Header contains no Manager mock or localStorage notification truth");
  assert.ok(!source.includes("captainDashboardMockData"), "Header no longer imports Captain mock data");
  assert.ok(!source.includes("ORD-001"), "Header contains no embedded fake order identifiers");
  assert.ok(serviceSource.includes("/notifications") && !serviceSource.includes("/reception/notifications"), "shared client service uses the role-neutral API");
  console.log("Shared Staff Header notification tests passed: 8/8");
} finally {
  delete globalThis.window;
  await vite.close();
}
