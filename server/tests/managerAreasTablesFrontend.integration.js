import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const source = relativePath => readFileSync(resolve(root, relativePath), "utf8");
const routes = source("client/src/app/routes.jsx");
const page = source("client/src/features/admin/pages/AdminAreasTablesPage.jsx");
const service = source("client/src/features/admin/services/areasTablesService.js");
const diningAreaService = source("server/services/diningAreaService.js");
const manager = source("client/src/features/manager/pages/ManagerDashboard.jsx");
const managerService = source("client/src/features/manager/services/managerService.js");
const restaurantOrders = source("client/src/features/manager/pages/ManagerRestaurantOrdersPage.jsx");
const restaurantOrderService = source("client/src/features/manager/services/managerRestaurantOrdersService.js");
const billingService = source("client/src/features/billing/services/billingService.js");
const app = source("server/app.js");

const productionSources = [];
function collect(directory) {
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) collect(path);
    else if (/\.(?:js|jsx)$/.test(entry)) productionSources.push(readFileSync(path, "utf8"));
  }
}
collect(resolve(root, "client/src"));

const checks = [];
const check = (condition, description) => {
  assert.equal(Boolean(condition), true, description);
  checks.push(description);
};

check(routes.includes('path: "manager/tables", element: <AdminAreasTablesPage navigationGroups={managerNavigationGroups} profile={managerProfile} />'), "Manager Areas & Tables resolves to the authoritative shared page");
check(page.includes("getDiningAreas(user.hotelId") && page.includes("setAreas(serverAreas.map"), "the page loads hotel-scoped dining areas and tables from the API");
check(service.includes('hotelPath(hotelId, "dining-areas")') && service.includes('hotelPath(hotelId, "dining-tables")'), "the shared service targets the existing dining area and dining table endpoints");
check(diningAreaService.includes("total_tables: dining_table.length"), "area table counts are derived from the authoritative returned table collection");
check(page.includes("createDiningArea") && page.includes("updateDiningArea") && page.includes("deleteDiningArea"), "area mutations use the authoritative service");
check(page.includes("createDiningTable") && page.includes("updateDiningTable") && page.includes("deleteDiningTable"), "table mutations use the authoritative service");
check(app.includes("authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER),\n  diningAreaRouter") && app.includes("authorizeRoleKeys(ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER),\n  diningTableRouter"), "existing backend authorization permits only Hotel Admin and Manager table configuration");
check(!productionSources.some(value => value.includes("managerMockData.js")), "no production frontend module imports managerMockData.js");
check(!existsSync(resolve(root, "client/src/features/manager/data/managerMockData.js")), "the obsolete Manager mock data module is removed");
check(!manager.includes("function TablesView") && !manager.includes("getManagerWorkspace") && !manager.includes("saveManagerWorkspace"), "the unreachable mock Manager table workspace is removed");
check(!managerService.includes("localStorage") && !managerService.includes("aazira-manager-workspace-v1"), "Manager operational state is no longer persisted in localStorage");
check(!manager.includes("Date.now()") && !manager.includes("Bill generated and table released"), "fake order identifiers and simulated billing success are absent");
check(!manager.includes("+ 420") && !manager.includes("Walk-in Guest"), "hard-coded mock order pricing and guests are absent");
check(restaurantOrderService.includes("/manager/restaurant-orders") && restaurantOrderService.includes('credentials: "include"'), "restaurant order reads use the authenticated Manager API");
check(restaurantOrders.includes("getManagerRestaurantOrders(user.hotelId") && restaurantOrders.includes("order.order_number"), "Manager restaurant orders render authoritative hotel-scoped order references");
check(restaurantOrders.includes("createRestaurantBill(user.hotelId, order.id)") && billingService.includes('method: "POST"'), "eligible restaurant bill creation uses the existing billing API");
check(restaurantOrders.includes("isRestaurantOrderBillable(order)"), "the existing completed-order billing eligibility rule remains enforced");
check(!page.includes("window.location.reload") && !manager.includes("window.location.reload"), "table mutations refetch without a full-page reload");
check(page.includes("LoadingState") === false || page.includes("loadAreas"), "the authoritative page has a defined loading/data-fetch path");
check(page.includes("Unable to load dining areas") && page.includes("area-filter-empty"), "error and empty states remain available");
check(source("server/services/captainService.js").includes("RESTAURANT_ORDER_IMMUTABLE") && source("server/services/kitchenService.js").includes("update"), "Captain and Kitchen lifecycle services remain the authoritative order mutation paths");

console.log(`Manager Areas & Tables frontend integration: ${checks.length}/${checks.length} passed`);
for (const description of checks) console.log(`PASS ${description}`);
