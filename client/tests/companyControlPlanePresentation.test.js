import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("company navigation uses distinct shared semantic icon tones", async () => {
  const [config, sidebar] = await Promise.all([
    read("../src/features/super-admin/superAdminConfig.js"),
    read("../src/components/layout/Sidebar.jsx"),
  ]);

  assert.match(config, /label: "Overview", tone: "blue"/);
  assert.match(config, /label: "Hotels", tone: "purple"/);
  assert.match(config, /label: "Hotel Admins", tone: "green"/);
  assert.match(sidebar, /SemanticIcon icon=\{Icon\} semantic=\{label\} size="nav" tone=\{tone\}/);
});

test("company badges stay compact without changing semantic variants", async () => {
  const [styles, hotels, hotelAdmins] = await Promise.all([
    read("../src/styles/components.css"),
    read("../src/features/super-admin/pages/SuperAdminHotels.jsx"),
    read("../src/features/super-admin/pages/SuperAdminHotelAdmins.jsx"),
  ]);

  assert.match(styles, /\.company-page \.badge \{[^}]*width: fit-content;[^}]*padding: 2px var\(--space-2\);/s);
  assert.match(hotels, /hotel\.status === "ACTIVE" \? "success" : "neutral"/);
  assert.match(hotelAdmins, /invitation\.status === "PENDING" \? "warning" : invitation\.status === "ACCEPTED" \? "success" : "neutral"/);
});

test("company row action icons have restrained semantic colors", async () => {
  const styles = await read("../src/styles/components.css");

  assert.match(styles, /\.company-row-actions \.icon-button \{[^}]*width: 32px;[^}]*color: var\(--icon-blue\);/s);
  assert.match(styles, /aria-label\^="Activate"[^}]*var\(--icon-green\)/s);
  assert.match(styles, /aria-label\^="Deactivate"[^}]*var\(--icon-red\)/s);
  assert.match(styles, /aria-label\^="Revoke"[^}]*var\(--icon-red\)/s);
});

test("hotel picker lifecycle status is compact, aligned, and responsive", async () => {
  const [styles, hotelAdmins] = await Promise.all([
    read("../src/styles/components.css"),
    read("../src/features/super-admin/pages/SuperAdminHotelAdmins.jsx"),
  ]);

  assert.match(hotelAdmins, /selectedHotel \? <Badge variant=\{selectedHotel\.status === "ACTIVE" \? "success" : "neutral"\}>\{selectedHotel\.status\.toLowerCase\(\)\}<\/Badge>/);
  assert.match(styles, /\.company-hotel-picker \{[^}]*gap: var\(--space-2\);/s);
  assert.match(styles, /\.company-hotel-picker > \.badge \{[^}]*align-self: flex-end;[^}]*min-height: 24px;[^}]*margin-bottom: 10px;/s);
  assert.match(styles, /@media \(max-width: 700px\)[^{]*\{.*?\.company-hotel-picker > \.badge \{[^}]*align-self: flex-start;[^}]*margin-bottom: 0;/s);
});
