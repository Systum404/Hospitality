import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("hotel row informational actions use the company blue action treatment", async () => {
  const [page, styles] = await Promise.all([
    read("../src/features/super-admin/pages/SuperAdminHotels.jsx"),
    read("../src/styles/components.css"),
  ]);

  assert.match(page, /aria-label=\{`View \$\{hotel\.name\}`\} className="icon-button"/);
  assert.match(page, /aria-label=\{`Edit \$\{hotel\.name\}`\} className="icon-button"/);
  assert.match(styles, /\.company-row-actions \.icon-button \{[^}]*color: var\(--icon-blue\);/s);
});

test("hotel lifecycle action uses red for deactivate and green for activate", async () => {
  const [page, styles] = await Promise.all([
    read("../src/features/super-admin/pages/SuperAdminHotels.jsx"),
    read("../src/styles/components.css"),
  ]);

  assert.match(page, /aria-label=\{`\$\{hotel\.status === "ACTIVE" \? "Deactivate" : "Activate"\} \$\{hotel\.name\}`\}/);
  assert.match(page, /title=\{hotel\.status === "ACTIVE" \? "Deactivate hotel" : "Activate hotel"\}/);
  assert.match(page, /onClick=\{\(\) => setPendingTransition\(hotel\)\}/);
  assert.match(styles, /aria-label\^="Activate"[^}]*var\(--icon-green\)/s);
  assert.match(styles, /aria-label\^="Deactivate"[^}]*var\(--icon-red\)/s);
  assert.doesNotMatch(styles, /aria-label\^="Deactivate"[^}]*var\(--icon-amber\)/s);
});
