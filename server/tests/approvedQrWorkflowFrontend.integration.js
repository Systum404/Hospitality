import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const requireFromClient = createRequire(new URL("../../client/package.json", import.meta.url));
const { createServer } = await import(pathToFileURL(requireFromClient.resolve("vite")).href);
const clientRoot = path.resolve("client");
const read = file => readFile(path.join(clientRoot, file), "utf8");
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };

const [guestCheckIn, captainManage, captainDashboard, kitchenDashboard, appRoutes] = await Promise.all([
  read("src/features/reception/pages/GuestCheckIn.jsx"),
  read("src/features/captain/pages/CaptainManageOrders.jsx"),
  read("src/features/captain/pages/CaptainDashboard.jsx"),
  read("src/features/kitchen/pages/KitchenDashboard.jsx"),
  read("src/app/routes.jsx"),
]);

check(guestCheckIn.includes('booking.status === "checked-in"') && guestCheckIn.includes("Issue room access"), "Reception exposes issuance only from the checked-in booking result");
check(guestCheckIn.includes("Reissue access") && guestCheckIn.includes("invalidates the previous code"), "Reception one-time handoff explains secure reissue behavior");
check(guestCheckIn.includes("navigator.clipboard.writeText(issuedCapability.capability)"), "Reception copies the complete raw capability only from the issuance response");
check(!guestCheckIn.includes("localStorage") && !guestCheckIn.includes("sessionStorage"), "Reception does not persist the raw capability in browser storage");
check(captainManage.includes("Table QR") && captainDashboard.includes("Table QR"), "Captain list and dashboard identify customer Table QR orders");
check(captainManage.includes("Send to Kitchen") && captainManage.includes("handoffTableQrOrder"), "Captain has an explicit Table QR handoff action");
check(kitchenDashboard.includes("createKitchenOrderPoller") && kitchenDashboard.includes("getKitchenOrders"), "Kitchen keeps the established single refresh mechanism");
check(appRoutes.includes('path: "qr/:token"'), "the established public customer QR route remains registered");

const vite = await createServer({ root: clientRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
const savedWindow = globalThis.window;
const savedFetch = globalThis.fetch;
globalThis.window = { location: { protocol: "http:", hostname: "localhost" } };
try {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return { ok: true, async json() { return { data: { room_capability: { capability: "raw-room-capability", created_at: "2026-10-01T00:00:00.000Z" }, order: { id: "order-id" } } }; } };
  };
  const reception = await vite.ssrLoadModule("/src/features/reception/services/receptionService.js");
  const captain = await vite.ssrLoadModule("/src/features/captain/services/captainService.js");
  const issued = await reception.issueReceptionRoomCapability("hotel id", "booking id");
  await captain.handoffTableQrOrder("hotel id", "order id");
  check(issued.capability === "raw-room-capability", "Reception service returns the one-time capability response without transformation");
  check(new URL(calls[0].url).pathname.endsWith("/api/hotels/hotel%20id/qr-codes/room-bookings/booking%20id/capability") && calls[0].options.method === "POST" && calls[0].options.credentials === "include", "Reception uses the existing authenticated capability endpoint");
  check(new URL(calls[1].url).pathname.endsWith("/api/hotels/hotel%20id/captain/orders/order%20id/kitchen-handoff") && calls[1].options.method === "POST" && calls[1].options.credentials === "include", "Captain uses the authenticated narrow Kitchen-handoff endpoint");
} finally {
  globalThis.fetch = savedFetch;
  if (savedWindow === undefined) delete globalThis.window;
  else globalThis.window = savedWindow;
  await vite.close();
}

console.log(`Approved QR workflow frontend: ${checks}/${checks} passed`);
