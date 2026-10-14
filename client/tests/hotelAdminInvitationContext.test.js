import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const vite = await createServer({ root: path.resolve("client"), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
try {
  globalThis.window = { location: { hostname: "localhost", protocol: "http:" } };
  const { InvitationHotelContext } = await vite.ssrLoadModule("/src/features/super-admin/pages/SuperAdminHotelAdmins.jsx");
  const firstHotel = { id: "hotel-one", name: "AAZIRA Central", code: "AZ-CENTRAL" };
  const secondHotel = { id: "hotel-two", name: "AAZIRA Riverside", code: "AZ-RIVER" };

  const firstMarkup = renderToStaticMarkup(React.createElement(InvitationHotelContext, { hotel: firstHotel }));
  const secondMarkup = renderToStaticMarkup(React.createElement(InvitationHotelContext, { hotel: secondHotel }));

  assert.ok(firstMarkup.includes('aria-label="Invitation hotel"'));
  assert.ok(firstMarkup.includes("AAZIRA Central"));
  assert.ok(firstMarkup.includes("AZ-CENTRAL"));
  assert.ok(firstMarkup.includes("will be created for this hotel"));
  assert.ok(!firstMarkup.includes("input") && !firstMarkup.includes("select"), "hotel context is informational, not editable");
  assert.ok(secondMarkup.includes("AAZIRA Riverside") && secondMarkup.includes("AZ-RIVER"), "changing the selected hotel changes the rendered context");
  assert.equal(renderToStaticMarkup(React.createElement(InvitationHotelContext, { hotel: null })), "", "missing hotel uses existing page-level handling without a fallback value");

  const pageSource = await readFile(path.resolve("client/src/features/super-admin/pages/SuperAdminHotelAdmins.jsx"), "utf8");
  assert.ok(pageSource.includes("<InvitationHotelContext hotel={selectedHotel} />"), "modal context remains bound to the page-selected hotel");
  assert.ok(pageSource.includes("createAdminInvitation(hotelId, {"), "invitation submission keeps the selected hotel in the existing route argument");
  assert.match(pageSource, /full_name: invite\.full_name\.trim\(\), email: invite\.email\.trim\(\)\.toLowerCase\(\), mobile_number: invite\.mobile_number\.trim\(\)/, "invitation payload semantics remain unchanged");

  console.log("Hotel Admin invitation context tests passed: 10/10");
} finally {
  await vite.close();
}
