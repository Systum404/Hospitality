import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("assignment states use success and danger badge treatments", async () => {
  const page = await read("../src/features/super-admin/pages/SuperAdminHotelAdmins.jsx");

  assert.match(page, /const assignmentActive = admin\.status === "ACTIVE"/);
  assert.match(page, /<Badge variant=\{assignmentActive \? "success" : "danger"\}>\{admin\.status\.toLowerCase\(\)\}<\/Badge>/);
});

test("assignment and identity lifecycle actions use their resulting semantic colors", async () => {
  const [page, styles] = await Promise.all([
    read("../src/features/super-admin/pages/SuperAdminHotelAdmins.jsx"),
    read("../src/styles/components.css"),
  ]);

  assert.match(page, /aria-label=\{`\$\{assignmentActive \? "Deactivate" : "Reactivate"\} assignment for/);
  assert.match(page, /company-assignment-action--\$\{assignmentActive \? "deactivate" : "reactivate"\}/);
  assert.match(page, /aria-label=\{`\$\{identityActive \? "Deactivate" : "Reactivate"\} identity for/);
  assert.match(page, /company-assignment-action--\$\{identityActive \? "deactivate" : "reactivate"\}/);
  assert.match(page, /className="icon-button company-assignment-action--reset"/);
  assert.match(styles, /company-assignment-action--deactivate[^}]*var\(--icon-red\)/s);
  assert.match(styles, /company-assignment-action--reactivate[^}]*var\(--icon-green\)/s);
  assert.match(styles, /company-assignment-action--reset[^}]*var\(--icon-blue\)/s);
});

test("assignment and identity handlers preserve their existing lifecycle targets", async () => {
  const page = await read("../src/features/super-admin/pages/SuperAdminHotelAdmins.jsx");

  assert.match(page, /type: "assignment", admin, active: !assignmentActive/);
  assert.match(page, /type: "identity", admin, active: !identityActive/);
  assert.match(page, /onClick=\{\(\) => resetPassword\(admin\)\}/);
  assert.match(page, /setHotelAdminAssignmentActive\(hotelId, confirm\.admin\.assignment_id, confirm\.active\)/);
  assert.match(page, /setCompanyIdentityActive\(confirm\.admin\.user\.id, confirm\.active\)/);
});
