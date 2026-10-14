import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const vite = await createServer({ root: path.resolve("client"), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
try {
  const { BillReceipt } = await vite.ssrLoadModule("/src/features/reception/components/BillReceipt.jsx");
  const { billingDateTime } = await vite.ssrLoadModule("/src/features/billing/utils/billingLinePresentation.js");
  const bill = {
    id: "bill-test", invoice_number: "INV-TEST", source_reference: "BK-TEST", status: "PARTIALLY_PAID",
    created_at: "2026-09-01T18:30:00.000Z", subtotal: "6499.00", taxable_subtotal: "6499.00",
    discount_amount: "0.00", tax_amount: "649.90", total_amount: "7148.90", amount_paid: "7148.00", balance_due: "0.90",
    hotel_snapshot: { name: "AAZIRA Test Hotel", address: "Test address" },
    guest_snapshot: { name: "Test Guest", room_number: "102" },
    discount_snapshot: null, tax_snapshot: { name: "GST 10%" },
    items: [
      { id: "room", description: "Room 102", quantity: 3, unit_price: "2000.00", subtotal: "6000.00", tax_amount: "600.00", total_amount: "6600.00" },
      { id: "food", description: "Chicken biryani", quantity: 1, unit_price: "499.00", subtotal: "499.00", tax_amount: "49.90", total_amount: "548.90" },
    ],
    payments: [{ id: "payment", method: "Cash", amount: "7148.00", created_at: "2026-09-01T19:00:00.000Z", reference: null }],
  };
  const timezone = "Asia/Kolkata";
  const html = renderToStaticMarkup(React.createElement(BillReceipt, { bill, timezone }));
  const expectedBillTime = billingDateTime(bill.created_at, timezone);
  const expectedPaymentTime = billingDateTime(bill.payments[0].created_at, timezone);
  const checks = [
    [html.includes("<td>Room 102</td><td>3</td><td>₹2,000.00</td><td>₹6,000.00</td>"), "accommodation row renders its pre-tax line amount"],
    [html.includes("<td>Chicken biryani</td><td>1</td><td>₹499.00</td><td>₹499.00</td>"), "menu row renders its pre-tax line amount"],
    [!html.includes("₹548.90"), "tax-inclusive line total is not rendered"],
    [html.includes("₹6,499.00"), "subtotal renders"],
    [html.includes("GST 10%"), "selected GST renders"],
    [html.includes("₹649.90"), "GST amount renders"],
    [html.includes("₹7,148.90"), "total renders"],
    [html.includes("₹7,148.00"), "paid amount renders"],
    [html.includes("₹0.90"), "fractional balance renders"],
    [html.includes(expectedBillTime), "bill time uses hotel timezone"],
    [html.includes(expectedPaymentTime), "payment time uses hotel timezone"],
    [expectedBillTime !== billingDateTime(bill.created_at, "America/New_York"), "formatting is independent of the device timezone"],
  ];
  for (const [condition, message] of checks) assert.ok(condition, message);
  console.log(JSON.stringify({ checks: checks.length, printableReceipt: true, timezone, expectedBillTime, expectedPaymentTime }));
} finally {
  await vite.close();
}
