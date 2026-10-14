import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = {
  acceptance: await readFile(new URL("../../client/src/features/admin-invitation/pages/AdminInvitationAcceptancePage.jsx", import.meta.url), "utf8"),
  acceptanceService: await readFile(new URL("../../client/src/features/admin-invitation/services/adminInvitationAcceptanceService.js", import.meta.url), "utf8"),
  adminUsers: await readFile(new URL("../../client/src/features/admin/pages/AdminUserAccountsPage.jsx", import.meta.url), "utf8"),
  hotelDetails: await readFile(new URL("../../client/src/features/super-admin/pages/SuperAdminHotelDetails.jsx", import.meta.url), "utf8"),
  hotels: await readFile(new URL("../../client/src/features/super-admin/pages/SuperAdminHotels.jsx", import.meta.url), "utf8"),
  service: await readFile(new URL("../../client/src/features/super-admin/services/companyControlPlaneService.js", import.meta.url), "utf8"),
};

const checks = [];
const check = (condition, message) => { assert.ok(condition, message); checks.push(message); };

check(files.hotels.includes("<th>Plan</th>"), "hotel list exposes the authoritative plan column");
check(files.hotels.includes("hotel.plan.toLowerCase()"), "hotel list renders UNASSIGNED, FREE, or PREMIUM from API data");
check(files.hotelDetails.includes("changeCompanyHotelPlan"), "hotel details uses the company plan API");
check(files.hotelDetails.includes('<option value="FREE">Free</option>') && files.hotelDetails.includes('<option value="PREMIUM">Premium</option>'), "company plan control exposes only Free and Premium choices");
check(files.hotelDetails.includes('usage.active') && files.hotelDetails.includes('usage.limit ?? "Unlimited"'), "hotel details renders active usage and Unlimited Premium limits");
check(files.hotelDetails.includes("usage.grandfathered"), "hotel details identifies grandfathered Free overage");
check(files.service.includes('method: "PATCH"') && files.service.includes('/plan`'), "company service changes plan through the protected PATCH endpoint");
check(files.adminUsers.includes("entitlement?.plan === \"UNASSIGNED\""), "Hotel Admin add-user UX is disabled while plan is UNASSIGNED");
check(files.adminUsers.includes("entitlement.usage"), "Hotel Admin user management renders server-provided usage");
check(files.acceptance.includes("1 Hotel Admin") && files.acceptance.includes("10 Captains"), "buyer page displays the approved Free limits");
check(files.acceptance.includes("Unlimited Hotel Admins") && files.acceptance.includes("Unlimited Captains"), "buyer page displays the approved Premium access");
check(files.acceptance.includes("Payment arrangements are handled separately") && !files.acceptance.match(/Stripe|Razorpay|checkout|credit card/i), "buyer page does not implement or imply in-app payment processing");
check(files.acceptance.includes('invitation.hotel.plan === "UNASSIGNED"'), "buyer activation remains blocked until a plan is selected");
check(files.acceptanceService.includes('request(token, "/plan"') && files.acceptanceService.includes('method: "POST"'), "buyer plan selection reuses the token-bound invitation endpoint");

console.log(`Hotel Entitlements frontend: ${checks.length}/${checks.length} passed`);
for (const result of checks) console.log(`PASS ${result}`);
