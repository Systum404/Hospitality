import assert from "node:assert/strict";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const vite = await createServer({ root: path.resolve("client"), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
try {
  const { IDENTIFIER_FEEDBACK_DURATION, IdentifierButton, compactIdentifier, copyFullIdentifier, scheduleIdentifierFeedbackClear } = await vite.ssrLoadModule("/src/components/ui/CopyableIdentifier.jsx");
  const booking = "BK-b28bf60a-9b98-4219-8451-80e1095d11e0";
  const order = "ORD-42f67755-11a2-4bb2-9292-c66ca0611ef7";
  const invoice = "INV-00000000-0000-0000-0000-000000000751";
  assert.equal(compactIdentifier(booking), "BK-b28bf60a…5d11e0");
  assert.equal(compactIdentifier(order), "ORD-42f67755…611ef7");
  assert.equal(compactIdentifier(invoice), "INV-00000000…000751");
  assert.equal(compactIdentifier("INV-000000000751"), "INV-000000000751");
  assert.equal(booking, "BK-b28bf60a-9b98-4219-8451-80e1095d11e0", "source remains unchanged");

  let copied = "";
  await copyFullIdentifier(booking, { writeText: async value => { copied = value; } });
  assert.equal(copied, booking, "copy uses the complete source identifier");
  await assert.rejects(copyFullIdentifier(order, { writeText: async () => { throw new Error("denied"); } }), /denied/);

  const idle = renderToStaticMarkup(React.createElement(IdentifierButton, { label: "booking ID", onCopy: () => {}, value: booking }));
  const copiedMarkup = renderToStaticMarkup(React.createElement(IdentifierButton, { feedback: "Copied", label: "booking ID", onCopy: () => {}, value: booking }));
  const failureMarkup = renderToStaticMarkup(React.createElement(IdentifierButton, { feedback: "Copy unavailable", label: "booking ID", onCopy: () => {}, value: booking }));
  assert.ok(idle.includes("title=\"Click to copy full ID\"") && idle.includes("aria-label=\"Copy full booking ID:"));
  assert.ok(idle.includes('<span class="copyable-identifier__value">BK-b28bf60a…5d11e0</span>'));
  assert.ok(copiedMarkup.includes("role=\"status\"") && copiedMarkup.includes("Copied"));
  assert.ok(failureMarkup.includes("Copy unavailable"), "clipboard failure feedback renders safely");

  let cleared = false;
  const timer = scheduleIdentifierFeedbackClear(() => { cleared = true; }, (callback, delay) => { assert.equal(delay, IDENTIFIER_FEEDBACK_DURATION); callback(); return 1; });
  assert.equal(timer, 1); assert.equal(cleared, true, "temporary feedback clears on schedule");
  console.log(JSON.stringify({ checks: 14, booking: compactIdentifier(booking), order: compactIdentifier(order), invoice: compactIdentifier(invoice), copiedFullValue: copied === booking }));
} finally {
  await vite.close();
}
