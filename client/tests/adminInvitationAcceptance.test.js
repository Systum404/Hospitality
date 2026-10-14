import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

globalThis.window = { location: { hostname: "localhost", protocol: "http:" } };
const vite = await createServer({ root: path.resolve("client"), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
try {
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ options, url: String(url) });
    return new Response(JSON.stringify({ status: "success", data: options.method === "POST" ? { requires_login: true } : { invitation: { email: "admin@example.invalid", hotel: { code: "HTL-000595", name: "AAZIRA Test Hotel" }, role: "HOTEL_ADMIN" } } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const token = "A".repeat(43);
  const service = await vite.ssrLoadModule("/src/features/admin-invitation/services/adminInvitationAcceptanceService.js");
  const inspection = await service.inspectAdminInvitation(token);
  assert.equal(inspection.invitation.hotel.code, "HTL-000595");
  assert.equal(requests[0].url, `http://localhost:4000/api/public/admin-invitations/${token}`);
  assert.equal(requests[0].options.credentials, "omit");
  assert.equal(requests[0].options.method, undefined, "opening the page performs inspection only");

  await service.acceptAdminInvitation(token, { full_name: "Hotel Admin", mobile_number: "+91 90000 00000", password: "StrongPassword" });
  assert.equal(requests[1].url, `http://localhost:4000/api/public/admin-invitations/${token}/accept`);
  assert.equal(requests[1].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[1].options.body), { full_name: "Hotel Admin", mobile_number: "+91 90000 00000", password: "StrongPassword" });

  const { InvitationAcceptanceForm } = await vite.ssrLoadModule("/src/features/admin-invitation/pages/AdminInvitationAcceptancePage.jsx");
  const markup = renderToStaticMarkup(React.createElement(InvitationAcceptanceForm, { invitation: inspection.invitation }));
  assert.ok(markup.includes("AAZIRA Test Hotel") && markup.includes("HTL-000595"));
  assert.ok(markup.includes("admin@example.invalid") && markup.includes("Hotel Admin"));
  assert.ok(markup.includes("invitation-full-name") && markup.includes("invitation-mobile-number") && markup.includes("invitation-password") && markup.includes("invitation-confirm-password"));
  assert.ok(markup.includes("Activate Hotel Admin Account"), "acceptance form exposes the existing activation action");

  const routes = await readFile(path.resolve("client/src/app/routes.jsx"), "utf8");
  const delivery = await readFile(path.resolve("server/services/adminInvitationDelivery.js"), "utf8");
  const page = await readFile(path.resolve("client/src/features/admin-invitation/pages/AdminInvitationAcceptancePage.jsx"), "utf8");
  assert.ok(routes.includes('path: "accept-admin-invitation", element: <AdminInvitationAcceptancePage />'), "generated path has a public frontend route");
  assert.ok(delivery.includes("/accept-admin-invitation?token="), "delivery path matches the frontend route");
  assert.ok(!page.includes("localStorage") && !page.includes("sessionStorage") && !page.includes("console."), "acceptance page does not persist or log the token");

  console.log("Admin invitation acceptance frontend tests passed: 14/14");
} finally {
  await vite.close();
}
