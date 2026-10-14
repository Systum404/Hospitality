import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const dashboard = await readFile(path.resolve("client/src/features/admin/pages/AdminDashboard.jsx"), "utf8");
const shell = await readFile(path.resolve("client/src/components/layout/AppShell.jsx"), "utf8");
const header = await readFile(path.resolve("client/src/components/layout/Header.jsx"), "utf8");
const styles = await readFile(path.resolve("client/src/styles/components.css"), "utf8");
const routes = await readFile(path.resolve("client/src/app/routes.jsx"), "utf8");
const navigation = await readFile(path.resolve("client/src/features/admin/adminConfig.js"), "utf8");

assert.ok(!dashboard.includes("hotelContext") && !dashboard.includes("dashboard.hotel"), "Admin Dashboard does not send hotel identity to the application header");
assert.ok(!shell.includes("hotelContext"), "AppShell has no hotel-label presentation plumbing");
assert.ok(!header.includes("HotelContextLabel") && !header.includes("header__hotel-context"), "shared Header renders no hotel name or code label");
assert.ok(header.includes('<div className="header__title">') && header.includes("<h1>{title}</h1>"), "existing application title structure is preserved");
assert.ok(header.includes("header__sidebar-toggle") && header.includes("Collapse sidebar"), "existing sidebar control is preserved");
assert.ok(header.includes("header-profile__logout") && header.includes("logout"), "existing logout control remains present");
assert.ok(!styles.includes("header__hotel-context") && !styles.includes("header__title--with-hotel"), "hotel-label-only responsive styling is removed");
assert.ok(navigation.includes('to: "/admin/dashboard"') && navigation.includes('to: "/admin/users"'), "Hotel Admin navigation remains available");
assert.ok(routes.includes('allowedRoleKeys={["SUPER_ADMIN"]}') && routes.includes('allowedScopes={["COMPANY"]}'), "company route protection remains unchanged");

console.log("Hotel Admin header cleanup tests passed: 9/9");
