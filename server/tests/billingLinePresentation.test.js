import assert from "node:assert/strict";
import { billingLineAmount } from "../../client/src/features/billing/utils/billingLinePresentation.js";

const room = { quantity: 3, unit_price: "2000.00", subtotal: "6000.00", tax_amount: "600.00", total_amount: "6600.00" };
const biryani = { quantity: 1, unit_price: "499.00", subtotal: "499.00", tax_amount: "49.90", total_amount: "548.90" };
const discounted = { quantity: 1, unit_price: "500.00", subtotal: "500.00", discount_amount: "100.00", tax_amount: "40.00", total_amount: "440.00" };

assert.equal(billingLineAmount(room), "6000.00", "Accommodation amount must be the pre-tax line subtotal");
assert.equal(billingLineAmount(biryani), "499.00", "Menu-item amount must not include allocated tax");
assert.equal(billingLineAmount(discounted), "500.00", "Discount allocation must not change the pre-adjustment Amount column");
assert.equal(Number(billingLineAmount(room)) + Number(billingLineAmount(biryani)), 6499, "Displayed line amounts must reconcile to the bill subtotal");

console.log(JSON.stringify({ checks: 4, roomAmount: billingLineAmount(room), menuItemAmount: billingLineAmount(biryani), subtotal: "6499.00", tax: "649.90", total: "7148.90" }));
