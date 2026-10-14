import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pagePath = new URL("../src/features/super-admin/pages/SuperAdminHotelAdmins.jsx", import.meta.url);

test("global identity cards contain only company-wide identity information", async () => {
  const source = await readFile(pagePath, "utf8");
  const globalSection = source.slice(source.indexOf("<CardTitle>Global identities</CardTitle>"), source.indexOf("<CardTitle>Hotel Admin assignments</CardTitle>"));

  assert.match(globalSection, /Company-wide user accounts\. Hotel access is managed through assignments below\./);
  assert.match(globalSection, /identity\.user\.name/);
  assert.match(globalSection, /identity\.user\.email/);
  assert.match(globalSection, /label="user ID" value=\{identity\.user\.id\}/);
  assert.match(globalSection, /identity active/);
  assert.match(globalSection, /Deactivate Identity/);
  assert.match(globalSection, /Reactivate Identity/);
  assert.match(globalSection, /Reset Password/);
  assert.doesNotMatch(globalSection, /hotel_name|hotel\.code|assignment_id|identity\.assignments/);
});

test("hotel-specific assignments remain selected-hotel scoped", async () => {
  const source = await readFile(pagePath, "utf8");

  assert.match(source, /listHotelAdmins\(hotelId\)/);
  assert.match(source, /setAdmins\(adminData\.admins\)/);
  assert.match(source, /<CardTitle>Hotel Admin assignments<\/CardTitle>/);
  assert.match(source, /admin\.assignment_id/);
  assert.match(source, /setHotelAdminAssignmentActive\(hotelId, confirm\.admin\.assignment_id, confirm\.active\)/);
});
