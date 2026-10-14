import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("hotel editor modal reserves header space while retaining shared scrolling", async () => {
  const [page, styles, modal] = await Promise.all([
    read("../src/features/super-admin/pages/SuperAdminHotels.jsx"),
    read("../src/styles/components.css"),
    read("../src/components/ui/Modal.jsx"),
  ]);

  assert.match(page, /className="company-hotel-editor-modal"/);
  assert.match(styles, /\.header \{[^}]*min-height: 66px;/s);
  assert.match(styles, /\.company-hotel-editor-modal \{[^}]*padding-top: calc\(66px \+ var\(--space-5\)\);/s);
  assert.match(styles, /\.company-hotel-editor-modal \.modal \{[^}]*max-height: calc\(100dvh - 66px - \(var\(--space-5\) \* 2\)\);/s);
  assert.match(styles, /\.modal \{[^}]*display: flex;[^}]*flex-direction: column;/s);
  assert.match(styles, /\.modal__content \{[^}]*overflow-y: auto;/s);
  assert.match(modal, /className=\{`modal-backdrop \$\{className\}`\.trim\(\)\}/);
});

test("create and edit hotel behavior remains on the same editor modal", async () => {
  const page = await read("../src/features/super-admin/pages/SuperAdminHotels.jsx");

  assert.match(page, /setEditor\(\{ mode: "create" \}\)/);
  assert.match(page, /setEditor\(\{ mode: "edit", hotel \}\)/);
  assert.match(page, /onClick=\{save\}/);
  assert.match(page, /onClick=\{\(\) => setEditor\(null\)\}/);
  assert.match(page, /editor\?\.mode === "create" \? "Create Hotel" : "Save Changes"/);
  assert.match(page, /<HotelForm draft=\{draft\} errors=\{errors\} onChange=\{updateDraft\} \/>/);
});
