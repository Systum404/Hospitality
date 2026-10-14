// Minimal production-like seed for disposable company-control-plane regressions.
import { randomUUID } from "node:crypto";
import { HOTEL_STATUSES } from "../config/hotelLifecycle.js";
import { HOTEL_PLANS } from "../config/hotelPlans.js";
import { ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { prisma } from "../db/prisma.js";

const definitions = [
  [ROLE_KEYS.HOTEL_ADMIN, "Hotel Admin", ROLE_SCOPES.HOTEL],
  [ROLE_KEYS.MANAGER, "Manager", ROLE_SCOPES.HOTEL],
  [ROLE_KEYS.RECEPTION, "Reception", ROLE_SCOPES.HOTEL],
  [ROLE_KEYS.CAPTAIN, "Captain", ROLE_SCOPES.HOTEL],
  [ROLE_KEYS.KITCHEN, "Kitchen", ROLE_SCOPES.HOTEL],
];
for (const [systemKey, name, scope] of definitions) {
  await prisma.role.upsert({ where: { system_key: systemKey }, update: {}, create: { name, system_key: systemKey, scope, is_protected: true } });
}
await prisma.hotel.create({
  data: {
    id: randomUUID(),
    name: "Control Plane Regression Baseline",
    type: "Hotel",
    address: "1 Baseline Road",
    city: "Pune",
    state_province: "Maharashtra",
    country: "India",
    postal_code: "411001",
    phone: "+91 90000 00000",
    email: "baseline@control-plane.invalid",
    timezone: "Asia/Kolkata",
    currency_code: "INR",
    plan: HOTEL_PLANS.PREMIUM,
    status: HOTEL_STATUSES.ACTIVE,
  },
});
await prisma.$disconnect();
