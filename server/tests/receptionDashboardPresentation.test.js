import assert from "node:assert/strict";
import {
  formatReceptionDashboardMoney,
  getReceptionDashboardNotificationPreview,
} from "../../client/src/features/reception/receptionDashboardPresentation.js";

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

check(formatReceptionDashboardMoney("0.90") === "₹0.90", "paise are preserved");
check(formatReceptionDashboardMoney("13987.00") === "₹13,987.00", "whole-rupee totals retain two decimals");

const notifications = Array.from({ length: 6 }, (_, index) => ({ id: String(index + 1), title: `Notification ${index + 1}` }));
const preview = getReceptionDashboardNotificationPreview({ notifications });
check(preview.length === 5 && preview[0] === notifications[0] && preview[4] === notifications[4], "latest API ordering is preserved and preview is limited to five");
check(getReceptionDashboardNotificationPreview({ notifications: [] }).length === 0, "empty notification data remains a truthful empty state");
check(getReceptionDashboardNotificationPreview(null).length === 0, "unavailable notification data does not fabricate alerts");

console.log(JSON.stringify({ checks, result: "Reception Dashboard presentation checks passed." }));
