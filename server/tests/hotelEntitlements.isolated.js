import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { app } from "../app.js";
import { AUDIT_ACTIONS, AUDIT_OUTCOMES } from "../config/audit.js";
import { HOTEL_PLANS } from "../config/hotelPlans.js";
import { ASSIGNMENT_STATUSES, ROLE_KEYS, ROLE_SCOPES } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { createAdminInvitation, acceptAdminInvitation, revokeAdminInvitation, selectAdminInvitationPlan, validateAdminInvitation } from "../services/adminInvitationService.js";
import { authenticateCredentials } from "../services/authService.js";
import { deactivateCompanyUserIdentity, reactivateCompanyUserIdentity } from "../services/companyUserIdentityService.js";
import { reactivateHotelAdmin } from "../services/hotelAdminAssignmentService.js";
import { getHotelEntitlementUsage } from "../services/hotelEntitlementService.js";
import { setCompanyHotelPlan } from "../services/hotelPlanService.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { createUserForHotel, updateUserForHotel, updateUserStatusForHotel } from "../services/userAccountService.js";

const results = [];
const pass = name => results.push(name);
const password = `Entitlement-${randomUUID()}`;
const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
const requestContext = () => ({ ipAddress: "127.0.0.1", requestId: randomUUID(), userAgent: "entitlement-integration" });
let server;

function tokenFromDelivery(delivery) {
  return new URL(`http://localhost${delivery.invitation_url}`).searchParams.get("token");
}

async function expectCode(operation, code) {
  await assert.rejects(operation, error => error?.code === code);
}

async function request(origin, method, path, { body, cookie, expected } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  if (expected !== undefined) assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return { payload, status: response.status };
}

async function createHotel(name, plan = HOTEL_PLANS.UNASSIGNED) {
  return prisma.hotel.create({ data: { id: randomUUID(), name, plan } });
}

async function createIdentity(label, assignments = [], { active = true } = {}) {
  const id = randomUUID();
  const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id}@entitlement.invalid`;
  await prisma.users.create({ data: { email, id, is_active: active, name: label, password_hash: passwordHash } });
  const created = [];
  for (const assignment of assignments) {
    created.push(await prisma.user_role.create({
      data: {
        hotel_id: assignment.hotelId ?? null,
        id: randomUUID(),
        restore_on_identity_reactivation: assignment.restore ?? false,
        role_id: assignment.role.id,
        role_scope: assignment.role.scope,
        status: assignment.status ?? ASSIGNMENT_STATUSES.ACTIVE,
        user_id: id,
      },
    }));
  }
  return { assignments: created, email, id };
}

async function cookieFor(user, assignment) {
  const token = await createAuthenticationToken({ userId: user.id, userRoleId: assignment.id }, 1800);
  return `aazira_auth=${token}`;
}

async function createStaff(hotelId, role, label, active = true) {
  return createUserForHotel(hotelId, {
    email: `${label}-${randomUUID()}@entitlement.invalid`,
    is_active: active,
    name: label,
    password,
    role_id: role.id,
  });
}

function auditFor(actor) {
  return { actor, requestContext: requestContext() };
}

try {
  const definitions = [
    [ROLE_KEYS.SUPER_ADMIN, "Super Admin", ROLE_SCOPES.COMPANY],
    [ROLE_KEYS.HOTEL_ADMIN, "Admin", ROLE_SCOPES.HOTEL],
    [ROLE_KEYS.MANAGER, "Manager", ROLE_SCOPES.HOTEL],
    [ROLE_KEYS.RECEPTION, "Reception", ROLE_SCOPES.HOTEL],
    [ROLE_KEYS.CAPTAIN, "Captain", ROLE_SCOPES.HOTEL],
    [ROLE_KEYS.KITCHEN, "Kitchen", ROLE_SCOPES.HOTEL],
  ];
  const roles = {};
  for (const [key, name, scope] of definitions) {
    roles[key] = await prisma.role.upsert({
      where: { system_key: key },
      update: {},
      create: { is_protected: true, name, scope, system_key: key },
    });
  }
  const company = await createIdentity("Company Actor", [{ role: roles[ROLE_KEYS.SUPER_ADMIN] }]);
  const companyActor = { hotelId: null, roleKey: ROLE_KEYS.SUPER_ADMIN, scope: ROLE_SCOPES.COMPANY, userId: company.id, userRoleId: company.assignments[0].id };

  const unassigned = await createHotel("Unassigned Hotel");
  assert.equal(unassigned.plan, HOTEL_PLANS.UNASSIGNED);
  pass("new hotels default to UNASSIGNED");
  await expectCode(() => createStaff(unassigned.id, roles[ROLE_KEYS.MANAGER], "Blocked Manager"), "PLAN_NOT_SELECTED");
  assert.equal(await prisma.user_role.count({ where: { hotel_id: unassigned.id } }), 0);
  pass("UNASSIGNED blocks direct staff creation without residue");

  const directUnassigned = await createIdentity("Direct Unassigned Staff", [{ hotelId: unassigned.id, role: roles[ROLE_KEYS.MANAGER] }]);
  await expectCode(() => authenticateCredentials(directUnassigned.email, password), "ACCOUNT_CONTEXT_UNAVAILABLE");
  pass("UNASSIGNED blocks normal staff credential login even for a legacy active assignment");

  const free = await createHotel("Free Limits", HOTEL_PLANS.FREE);
  const createdByRole = {};
  for (const roleKey of [ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION, ROLE_KEYS.KITCHEN]) {
    createdByRole[roleKey] = await createStaff(free.id, roles[roleKey], `Free ${roleKey}`);
    pass(`FREE permits the first ${roleKey}`);
    await expectCode(() => createStaff(free.id, roles[roleKey], `Blocked ${roleKey}`), "PLAN_LIMIT_REACHED");
    pass(`FREE rejects a second ${roleKey}`);
  }
  for (let index = 1; index <= 10; index += 1) await createStaff(free.id, roles[ROLE_KEYS.CAPTAIN], `Captain ${index}`);
  assert.equal(await prisma.user_role.count({ where: { hotel_id: free.id, role_id: roles[ROLE_KEYS.CAPTAIN].id, status: ASSIGNMENT_STATUSES.ACTIVE } }), 10);
  pass("FREE permits Captains 1 through 10");
  await expectCode(() => createStaff(free.id, roles[ROLE_KEYS.CAPTAIN], "Captain 11"), "PLAN_LIMIT_REACHED");
  pass("FREE rejects Captain 11");
  const freeUsage = await getHotelEntitlementUsage(prisma, free.id);
  assert.equal(freeUsage.usage.CAPTAIN.active, 10);
  assert.equal(freeUsage.usage.CAPTAIN.limit, 10);
  pass("usage is derived from active hotel-scoped assignments");

  const pendingUser = await createIdentity("Pending Excluded", [{ hotelId: free.id, role: roles[ROLE_KEYS.CAPTAIN], status: ASSIGNMENT_STATUSES.PENDING }], { active: false });
  const inactiveUser = await createIdentity("Inactive Excluded", [{ hotelId: free.id, role: roles[ROLE_KEYS.CAPTAIN], status: ASSIGNMENT_STATUSES.INACTIVE }], { active: false });
  assert.equal((await getHotelEntitlementUsage(prisma, free.id)).usage.CAPTAIN.active, 10);
  assert.ok(pendingUser.id && inactiveUser.id);
  pass("PENDING and INACTIVE assignments do not consume capacity");

  const premium = await createHotel("Premium Unlimited", HOTEL_PLANS.PREMIUM);
  for (const roleKey of [ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION, ROLE_KEYS.KITCHEN]) {
    await createStaff(premium.id, roles[roleKey], `Premium ${roleKey} A`);
    await createStaff(premium.id, roles[roleKey], `Premium ${roleKey} B`);
    assert.equal(await prisma.user_role.count({ where: { hotel_id: premium.id, role_id: roles[roleKey].id, status: ASSIGNMENT_STATUSES.ACTIVE } }), 2);
    pass(`PREMIUM permits multiple ${roleKey} assignments`);
  }
  for (let index = 1; index <= 11; index += 1) await createStaff(premium.id, roles[ROLE_KEYS.CAPTAIN], `Premium Captain ${index}`);
  assert.equal((await getHotelEntitlementUsage(prisma, premium.id)).usage.CAPTAIN.limit, null);
  pass("PREMIUM permits more than ten Captains and reports Unlimited");

  const captainRace = await createHotel("Captain Race", HOTEL_PLANS.FREE);
  for (let index = 1; index <= 9; index += 1) await createStaff(captainRace.id, roles[ROLE_KEYS.CAPTAIN], `Race Captain ${index}`);
  const captainRaceResults = await Promise.allSettled([
    createStaff(captainRace.id, roles[ROLE_KEYS.CAPTAIN], "Race Captain A"),
    createStaff(captainRace.id, roles[ROLE_KEYS.CAPTAIN], "Race Captain B"),
  ]);
  assert.deepEqual(captainRaceResults.map(result => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(await prisma.user_role.count({ where: { hotel_id: captainRace.id, role_id: roles[ROLE_KEYS.CAPTAIN].id, status: ASSIGNMENT_STATUSES.ACTIVE } }), 10);
  pass("concurrent requests serialize on the final Captain seat");

  const adminRace = await createHotel("Admin Race", HOTEL_PLANS.FREE);
  const adminRaceResults = await Promise.allSettled([
    createStaff(adminRace.id, roles[ROLE_KEYS.HOTEL_ADMIN], "Race Admin A"),
    createStaff(adminRace.id, roles[ROLE_KEYS.HOTEL_ADMIN], "Race Admin B"),
  ]);
  assert.deepEqual(adminRaceResults.map(result => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(await prisma.user_role.count({ where: { hotel_id: adminRace.id, role_id: roles[ROLE_KEYS.HOTEL_ADMIN].id, status: ASSIGNMENT_STATUSES.ACTIVE } }), 1);
  pass("concurrent requests serialize on the final Hotel Admin seat");

  const invitationRaceHotel = await createHotel("Invitation Race", HOTEL_PLANS.FREE);
  const invite = await createAdminInvitation({
    actor: companyActor,
    hotelId: invitationRaceHotel.id,
    input: { email: `invite-race-${randomUUID()}@entitlement.invalid`, fullName: "Invitation Race", mobileNumber: "+919999990001" },
    requestContext: requestContext(),
  });
  const inviteToken = tokenFromDelivery(invite.delivery);
  const invitationRace = await Promise.allSettled([
    acceptAdminInvitation(inviteToken, { fullName: "Invitation Race", mobileNumber: "+919999990001", password }, requestContext()),
    createStaff(invitationRaceHotel.id, roles[ROLE_KEYS.HOTEL_ADMIN], "Direct Race Admin"),
  ]);
  assert.deepEqual(invitationRace.map(result => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(await prisma.user_role.count({ where: { hotel_id: invitationRaceHotel.id, role_id: roles[ROLE_KEYS.HOTEL_ADMIN].id, status: ASSIGNMENT_STATUSES.ACTIVE } }), 1);
  pass("invitation acceptance racing direct creation cannot exceed the Hotel Admin cap");

  const reactivationRaceHotel = await createHotel("Reactivation Race", HOTEL_PLANS.FREE);
  const inactiveAdmin = await createIdentity("Inactive Race Admin", [{ hotelId: reactivationRaceHotel.id, role: roles[ROLE_KEYS.HOTEL_ADMIN], status: ASSIGNMENT_STATUSES.INACTIVE }]);
  const reactivationRace = await Promise.allSettled([
    reactivateHotelAdmin(reactivationRaceHotel.id, inactiveAdmin.assignments[0].id, auditFor(companyActor)),
    createStaff(reactivationRaceHotel.id, roles[ROLE_KEYS.HOTEL_ADMIN], "Created Race Admin"),
  ]);
  assert.deepEqual(reactivationRace.map(result => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(await prisma.user_role.count({ where: { hotel_id: reactivationRaceHotel.id, role_id: roles[ROLE_KEYS.HOTEL_ADMIN].id, status: ASSIGNMENT_STATUSES.ACTIVE } }), 1);
  pass("reactivation racing creation cannot exceed the Hotel Admin cap");

  const roleRaceHotel = await createHotel("Role Race", HOTEL_PLANS.FREE);
  for (let index = 1; index <= 9; index += 1) await createStaff(roleRaceHotel.id, roles[ROLE_KEYS.CAPTAIN], `Role Race Captain ${index}`);
  const receptionToCaptain = await createStaff(roleRaceHotel.id, roles[ROLE_KEYS.RECEPTION], "Reception To Captain");
  const roleRace = await Promise.allSettled([
    updateUserForHotel(roleRaceHotel.id, receptionToCaptain.id, { role_id: roles[ROLE_KEYS.CAPTAIN].id }),
    createStaff(roleRaceHotel.id, roles[ROLE_KEYS.CAPTAIN], "Created Final Captain"),
  ]);
  assert.deepEqual(roleRace.map(result => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(await prisma.user_role.count({ where: { hotel_id: roleRaceHotel.id, role_id: roles[ROLE_KEYS.CAPTAIN].id, status: ASSIGNMENT_STATUSES.ACTIVE } }), 10);
  pass("role change racing creation cannot exceed the Captain cap");

  const downgradeRaceHotel = await createHotel("Downgrade Race", HOTEL_PLANS.PREMIUM);
  await createStaff(downgradeRaceHotel.id, roles[ROLE_KEYS.MANAGER], "Existing Manager");
  const downgradeRace = await Promise.allSettled([
    setCompanyHotelPlan(downgradeRaceHotel.id, HOTEL_PLANS.FREE, auditFor(companyActor)),
    createStaff(downgradeRaceHotel.id, roles[ROLE_KEYS.MANAGER], "Concurrent Manager"),
  ]);
  assert.equal(downgradeRace[0].status, "fulfilled");
  const downgradeManagerCount = await prisma.user_role.count({ where: { hotel_id: downgradeRaceHotel.id, role_id: roles[ROLE_KEYS.MANAGER].id, status: ASSIGNMENT_STATUSES.ACTIVE } });
  assert.ok([1, 2].includes(downgradeManagerCount));
  assert.equal((await prisma.hotel.findUniqueOrThrow({ where: { id: downgradeRaceHotel.id } })).plan, HOTEL_PLANS.FREE);
  pass("plan downgrade racing creation produces either a rejected increase or grandfathered committed access");

  const grandfather = await createHotel("Grandfather Hotel", HOTEL_PLANS.PREMIUM);
  const grandfatherManagers = [];
  for (let index = 1; index <= 3; index += 1) grandfatherManagers.push(await createStaff(grandfather.id, roles[ROLE_KEYS.MANAGER], `Grandfather Manager ${index}`));
  for (let index = 1; index <= 12; index += 1) await createStaff(grandfather.id, roles[ROLE_KEYS.CAPTAIN], `Grandfather Captain ${index}`);
  await setCompanyHotelPlan(grandfather.id, HOTEL_PLANS.FREE, auditFor(companyActor));
  assert.equal(await prisma.user_role.count({ where: { hotel_id: grandfather.id, status: ASSIGNMENT_STATUSES.ACTIVE } }), 15);
  pass("Premium to Free preserves all existing active assignments");
  const grandfatherUsage = await getHotelEntitlementUsage(prisma, grandfather.id);
  assert.equal(grandfatherUsage.usage.MANAGER.grandfathered, 2);
  assert.equal(grandfatherUsage.usage.CAPTAIN.grandfathered, 2);
  pass("Free usage explicitly reports grandfathered overage");
  await expectCode(() => createStaff(grandfather.id, roles[ROLE_KEYS.MANAGER], "Blocked Grandfather Manager"), "PLAN_LIMIT_REACHED");
  pass("new access beyond a grandfathered Free cap is rejected");
  await updateUserStatusForHotel(grandfather.id, grandfatherManagers[0].id, false);
  await expectCode(() => updateUserStatusForHotel(grandfather.id, grandfatherManagers[0].id, true), "PLAN_LIMIT_REACHED");
  assert.equal((await prisma.user_role.findFirstOrThrow({ where: { hotel_id: grandfather.id, user_id: grandfatherManagers[0].id } })).status, ASSIGNMENT_STATUSES.INACTIVE);
  pass("a deactivated grandfathered assignment must obey the current Free cap on reactivation");

  const identityHotelA = await createHotel("Identity Hotel A", HOTEL_PLANS.FREE);
  const identityHotelB = await createHotel("Identity Hotel B", HOTEL_PLANS.FREE);
  const multiIdentity = await createIdentity("Multi Hotel Manager", [
    { hotelId: identityHotelA.id, role: roles[ROLE_KEYS.MANAGER] },
    { hotelId: identityHotelB.id, role: roles[ROLE_KEYS.MANAGER] },
  ]);
  await deactivateCompanyUserIdentity(multiIdentity.id, auditFor(companyActor));
  assert.equal(await prisma.user_role.count({ where: { user_id: multiIdentity.id, status: ASSIGNMENT_STATUSES.INACTIVE, restore_on_identity_reactivation: true } }), 2);
  pass("global identity deactivation releases all hotel seats and preserves restoration intent");
  await createStaff(identityHotelB.id, roles[ROLE_KEYS.MANAGER], "Replacement Manager");
  await expectCode(() => reactivateCompanyUserIdentity(multiIdentity.id, auditFor(companyActor)), "PLAN_LIMIT_REACHED");
  assert.equal((await prisma.users.findUniqueOrThrow({ where: { id: multiIdentity.id } })).is_active, false);
  assert.equal(await prisma.user_role.count({ where: { user_id: multiIdentity.id, status: ASSIGNMENT_STATUSES.INACTIVE } }), 2);
  pass("multi-hotel identity restoration is all-or-nothing when one hotel is full");

  const restorationHotel = await createHotel("Restoration Hotel", HOTEL_PLANS.FREE);
  const restorable = await createIdentity("Restorable Manager", [{ hotelId: restorationHotel.id, role: roles[ROLE_KEYS.MANAGER] }]);
  await deactivateCompanyUserIdentity(restorable.id, auditFor(companyActor));
  await reactivateCompanyUserIdentity(restorable.id, auditFor(companyActor));
  assert.equal((await prisma.users.findUniqueOrThrow({ where: { id: restorable.id } })).is_active, true);
  assert.equal((await prisma.user_role.findFirstOrThrow({ where: { user_id: restorable.id } })).status, ASSIGNMENT_STATUSES.ACTIVE);
  pass("identity reactivation succeeds when every affected hotel has capacity");

  const buyerHotel = await createHotel("Buyer Hotel");
  const buyerInvite = await createAdminInvitation({
    actor: companyActor,
    hotelId: buyerHotel.id,
    input: { email: `buyer-${randomUUID()}@entitlement.invalid`, fullName: "Buyer", mobileNumber: "+919999990002" },
    requestContext: requestContext(),
  });
  const buyerToken = tokenFromDelivery(buyerInvite.delivery);
  const storedBuyerInvite = await prisma.admin_invitation.findUniqueOrThrow({ where: { id: buyerInvite.invitation.id } });
  assert.notEqual(storedBuyerInvite.token_hash, buyerToken);
  assert.equal(storedBuyerInvite.token_hash, createHash("sha256").update(buyerToken).digest("hex"));
  assert.equal(storedBuyerInvite.token_hash.length, 64);
  pass("buyer setup stores only the SHA-256 token hash");
  const expiryHours = (storedBuyerInvite.expires_at - storedBuyerInvite.created_at) / 3600000;
  assert.equal(expiryHours, 48);
  pass("buyer setup link expires after exactly 48 hours");
  assert.equal((await validateAdminInvitation(buyerToken)).hotel.plan, HOTEL_PLANS.UNASSIGNED);
  await selectAdminInvitationPlan(buyerToken, HOTEL_PLANS.FREE, requestContext());
  await selectAdminInvitationPlan(buyerToken, HOTEL_PLANS.PREMIUM, requestContext());
  assert.equal((await validateAdminInvitation(buyerToken)).hotel.plan, HOTEL_PLANS.PREMIUM);
  pass("buyer can select and change plan before onboarding completion");
  await acceptAdminInvitation(buyerToken, { fullName: "Buyer", mobileNumber: "+919999990002", password }, requestContext());
  await expectCode(() => selectAdminInvitationPlan(buyerToken, HOTEL_PLANS.FREE, requestContext()), "ADMIN_INVITATION_INVALID");
  pass("accepted invitation is the authoritative onboarding completion signal and cannot change plan afterward");
  await expectCode(() => validateAdminInvitation(buyerToken), "ADMIN_INVITATION_INVALID");
  pass("accepted buyer setup link is single-use");

  const expiredHotel = await createHotel("Expired Buyer Hotel");
  const expiredInvite = await createAdminInvitation({ actor: companyActor, hotelId: expiredHotel.id, input: { email: `expired-${randomUUID()}@entitlement.invalid`, fullName: "Expired", mobileNumber: "+919999990003" }, requestContext: requestContext() });
  const expiredToken = tokenFromDelivery(expiredInvite.delivery);
  await prisma.admin_invitation.update({
    where: { id: expiredInvite.invitation.id },
    data: { created_at: new Date(Date.now() - 49 * 3600000), expires_at: new Date(Date.now() - 3600000) },
  });
  await expectCode(() => selectAdminInvitationPlan(expiredToken, HOTEL_PLANS.FREE, requestContext()), "ADMIN_INVITATION_INVALID");
  pass("expired buyer setup link is rejected generically");

  const revokedHotel = await createHotel("Revoked Buyer Hotel");
  const revokedInvite = await createAdminInvitation({ actor: companyActor, hotelId: revokedHotel.id, input: { email: `revoked-${randomUUID()}@entitlement.invalid`, fullName: "Revoked", mobileNumber: "+919999990004" }, requestContext: requestContext() });
  const revokedToken = tokenFromDelivery(revokedInvite.delivery);
  await revokeAdminInvitation({ actor: companyActor, invitationId: revokedInvite.invitation.id, requestContext: requestContext() });
  await expectCode(() => selectAdminInvitationPlan(revokedToken, HOTEL_PLANS.FREE, requestContext()), "ADMIN_INVITATION_INVALID");
  pass("revoked buyer setup link is rejected generically");

  const blockedInviteHotel = await createHotel("Unassigned Acceptance");
  const blockedInvite = await createAdminInvitation({ actor: companyActor, hotelId: blockedInviteHotel.id, input: { email: `blocked-${randomUUID()}@entitlement.invalid`, fullName: "Blocked", mobileNumber: "+919999990005" }, requestContext: requestContext() });
  const blockedToken = tokenFromDelivery(blockedInvite.delivery);
  await expectCode(() => acceptAdminInvitation(blockedToken, { fullName: "Blocked", mobileNumber: "+919999990005", password }, requestContext()), "PLAN_NOT_SELECTED");
  assert.equal((await prisma.admin_invitation.findUniqueOrThrow({ where: { id: blockedInvite.invitation.id } })).status, "PENDING");
  pass("UNASSIGNED blocks invitation acceptance and preserves the pending invitation");

  const selectedAudit = await prisma.audit_event.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.HOTEL_PLAN_SELECTED, hotel_id: buyerHotel.id } });
  const changedAudits = await prisma.audit_event.findMany({ where: { action: AUDIT_ACTIONS.HOTEL_PLAN_CHANGED, hotel_id: buyerHotel.id } });
  assert.deepEqual(selectedAudit.metadata, { current_plan: HOTEL_PLANS.FREE, previous_plan: HOTEL_PLANS.UNASSIGNED });
  assert.ok(changedAudits.some(event => event.metadata.current_plan === HOTEL_PLANS.PREMIUM));
  pass("plan selection and change produce append-only sanitized audit events");

  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const companyCookie = await cookieFor(company, company.assignments[0]);
  const hotelActors = {};
  for (const roleKey of [ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION, ROLE_KEYS.CAPTAIN, ROLE_KEYS.KITCHEN]) {
    const hotel = await createHotel(`Auth ${roleKey}`, HOTEL_PLANS.PREMIUM);
    const identity = await createIdentity(`Auth ${roleKey}`, [{ hotelId: hotel.id, role: roles[roleKey] }]);
    hotelActors[roleKey] = { cookie: await cookieFor(identity, identity.assignments[0]), hotel, identity };
  }
  const apiHotel = await createHotel("API Plan Hotel");
  assert.equal((await request(origin, "PATCH", `/api/company/hotels/${apiHotel.id}/plan`, { body: { plan: HOTEL_PLANS.FREE }, cookie: companyCookie, expected: 200 })).payload.data.plan, HOTEL_PLANS.FREE);
  pass("COMPANY-scoped SUPER_ADMIN can select a plan");
  assert.equal((await request(origin, "PATCH", `/api/company/hotels/${apiHotel.id}/plan`, { body: { plan: HOTEL_PLANS.PREMIUM }, cookie: companyCookie, expected: 200 })).payload.data.plan, HOTEL_PLANS.PREMIUM);
  pass("COMPANY-scoped SUPER_ADMIN can change a plan after onboarding selection");
  assert.equal((await request(origin, "PATCH", `/api/company/hotels/${apiHotel.id}/plan`, { body: { plan: HOTEL_PLANS.FREE }, expected: 401 })).payload.error.code, "UNAUTHENTICATED");
  pass("unauthenticated plan mutation is rejected");
  for (const roleKey of [ROLE_KEYS.HOTEL_ADMIN, ROLE_KEYS.MANAGER, ROLE_KEYS.RECEPTION, ROLE_KEYS.CAPTAIN, ROLE_KEYS.KITCHEN]) {
    const response = await request(origin, "PATCH", `/api/company/hotels/${apiHotel.id}/plan`, { body: { plan: HOTEL_PLANS.FREE }, cookie: hotelActors[roleKey].cookie, expected: 403 });
    assert.equal(response.payload.error.code, "COMPANY_SCOPE_REQUIRED");
    pass(`${roleKey} cannot change hotel plans`);
  }

  const auditHotel = await createHotel("Limit Audit Hotel", HOTEL_PLANS.FREE);
  const auditAdmin = await createIdentity("Limit Audit Admin", [{ hotelId: auditHotel.id, role: roles[ROLE_KEYS.HOTEL_ADMIN] }]);
  const auditManager = await createIdentity("Limit Audit Manager", [{ hotelId: auditHotel.id, role: roles[ROLE_KEYS.MANAGER] }]);
  const auditCookie = await cookieFor(auditAdmin, auditAdmin.assignments[0]);
  const rejectedEmail = `rejected-${randomUUID()}@entitlement.invalid`;
  const rejected = await request(origin, "POST", `/api/hotels/${auditHotel.id}/users`, {
    body: { email: rejectedEmail, is_active: true, name: "Rejected Manager", password, role_id: roles[ROLE_KEYS.MANAGER].id },
    cookie: auditCookie,
    expected: 409,
  });
  assert.equal(rejected.payload.error.code, "PLAN_LIMIT_REACHED");
  assert.equal(await prisma.users.count({ where: { email: rejectedEmail } }), 0);
  const rejectionAudit = await prisma.audit_event.findFirstOrThrow({ where: { action: AUDIT_ACTIONS.HOTEL_ASSIGNMENT_LIMIT_REACHED, hotel_id: auditHotel.id } });
  assert.equal(rejectionAudit.outcome, AUDIT_OUTCOMES.FAILURE);
  assert.deepEqual(Object.keys(rejectionAudit.metadata).sort(), ["current_count", "limit", "plan", "role"]);
  assert.equal(/password|token|cookie|authorization|secret/i.test(JSON.stringify(rejectionAudit.metadata)), false);
  assert.ok(auditManager.id);
  pass("limit rejection returns 409, leaves no user, and persists a sanitized failure audit outside the rolled-back mutation");

  const unassignedSessionUser = await createIdentity("Unassigned Session", [{ hotelId: unassigned.id, role: roles[ROLE_KEYS.RECEPTION] }]);
  const unassignedCookie = await cookieFor(unassignedSessionUser, unassignedSessionUser.assignments[0]);
  assert.equal((await request(origin, "GET", "/api/auth/session", { cookie: unassignedCookie, expected: 401 })).payload.error.code, "UNAUTHENTICATED");
  pass("existing JWT session is invalidated immediately by authoritative UNASSIGNED plan state");

  const companySession = await request(origin, "GET", "/api/auth/session", { cookie: companyCookie, expected: 200 });
  assert.equal(companySession.payload.user.roleKey, ROLE_KEYS.SUPER_ADMIN);
  pass("SUPER_ADMIN company context is excluded from hotel plan enforcement");

  const planAuditPayload = JSON.stringify(await prisma.audit_event.findMany({ where: { action: { in: [AUDIT_ACTIONS.HOTEL_PLAN_SELECTED, AUDIT_ACTIONS.HOTEL_PLAN_CHANGED, AUDIT_ACTIONS.HOTEL_ASSIGNMENT_LIMIT_REACHED] } }, select: { metadata: true } }));
  assert.equal(/password|token|cookie|authorization|secret|jwt/i.test(planAuditPayload), false);
  pass("all entitlement audit metadata remains secret-free");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
}

assert.ok(results.length >= 45);
console.log(`Hotel Entitlements integration: ${results.length}/${results.length} passed`);
for (const result of results) console.log(`PASS ${result}`);
