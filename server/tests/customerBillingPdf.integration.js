import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import {
  buildCustomerReceiptLayout,
  createCustomerReceiptPdf,
  UnsupportedReceiptCharacterError,
} from "../services/customerBillingPdfService.js";

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };

const baseBilling = overrides => ({
  available: true,
  document_type: "receipt",
  status: "PAID",
  invoice_number: "INV-000000000777",
  issued_at: "2026-09-27T06:30:00.000Z",
  hotel: {
    name: "आज़ीरा होटल Café",
    address: "१२ समुद्र मार्ग, मुंबई — señor über",
    timezone: "Asia/Kolkata",
  },
  context: {
    type: "room",
    room_number: "१०२",
    booking_from: "2026-09-27",
    booking_to: "2026-09-30",
  },
  items: [{
    description: "चिकन बिरयानी très délicieuse ₹ विशेष",
    quantity: 1,
    unit_price: "499.00",
    subtotal: "499.00",
  }],
  subtotal: "6499.00",
  discount_amount: "0.00",
  taxable_subtotal: "6499.00",
  tax_amount: "649.90",
  total_amount: "7148.90",
  amount_paid: "7148.00",
  balance_due: "0.90",
  payment_status: "PAID",
  payments: [{ amount: "7148.00", method: "UPI", status: "RECORDED", recorded_at: "2026-09-27T07:00:00.000Z" }],
  ...overrides,
});

function inflateStreams(pdf) {
  const streams = [];
  const marker = Buffer.from("stream\n");
  const endMarker = Buffer.from("\nendstream");
  let position = 0;
  while ((position = pdf.indexOf(marker, position)) >= 0) {
    const start = position + marker.length;
    const end = pdf.indexOf(endMarker, start);
    if (end < 0) break;
    const raw = pdf.subarray(start, end);
    try { streams.push(inflateSync(raw)); } catch { streams.push(raw); }
    position = end + endMarker.length;
  }
  return streams;
}

function unicodeMaps(pdf) {
  return inflateStreams(pdf)
    .map(stream => stream.toString("latin1"))
    .filter(stream => stream.includes("begincmap"))
    .join("\n")
    .toUpperCase();
}

function actualTexts(pdf) {
  const values = [];
  const escapes = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
  for (const stream of inflateStreams(pdf)) {
    const text = stream.toString("latin1");
    for (const match of text.matchAll(/\/ActualText \(((?:\\.|[^\\)])*)\)/gs)) {
      const literal = match[1].replace(/\\(.)/gs, (_, character) => escapes[character] ?? character);
      const bytes = Buffer.from(literal, "latin1");
      if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        const littleEndian = Buffer.from(bytes.subarray(2));
        for (let index = 0; index < littleEndian.length; index += 2) [littleEndian[index], littleEndian[index + 1]] = [littleEndian[index + 1], littleEndian[index]];
        values.push(littleEndian.toString("utf16le"));
      } else values.push(literal);
    }
  }
  return values;
}

function lineText(layout) {
  return layout.pages.flat().map(line => line.text).join("\n");
}

const unicodeBilling = baseBilling();
const unicodeLayout = buildCustomerReceiptLayout(unicodeBilling);
const unicodePdf = await createCustomerReceiptPdf(unicodeBilling);
check(unicodePdf.subarray(0, 5).toString() === "%PDF-", "Unicode receipt is a PDF");
check(unicodePdf.toString("latin1").includes("/MediaBox [0 0 595 842]"), "receipt remains A4-sized");
check(lineText(unicodeLayout).includes("आज़ीरा होटल") && lineText(unicodeLayout).includes("मुंबई") && lineText(unicodeLayout).includes("चिकन बिरयानी"), "Devanagari survives layout without substitution");
check(lineText(unicodeLayout).includes("Café") && lineText(unicodeLayout).includes("señor über") && lineText(unicodeLayout).includes("très délicieuse"), "accented Latin survives layout without substitution");
const maps = unicodeMaps(unicodePdf);
const unicodeStreams = inflateStreams(unicodePdf);
check(unicodeStreams.some(stream => stream.toString("latin1").includes("/ActualText")), "rendered lines retain logical Unicode text metadata for capable extractors");
const logicalText = actualTexts(unicodePdf);
check(logicalText.includes("आज़ीरा होटल Café".normalize("NFC")), "Devanagari and accented Latin logical text survives PDF generation exactly");
check(logicalText.includes("चिकन बिरयानी très délicieuse ₹ विशेष".normalize("NFC")), "mixed-script item description survives PDF generation exactly");
for (const codePoint of ["0906", "091C", "0930", "0939", "092E", "0941", "0902", "00E9", "00FC", "00F1", "20B9"]) {
  check(maps.includes(codePoint), `embedded ToUnicode map preserves U+${codePoint}`);
}
check(!maps.includes("<003F>"), "Unicode maps do not substitute tested text with question marks");

const longToken = "SUPERCALIFRAGILISTICEXPIALIDOCIOUS".repeat(8);
const longUnicode = "दीर्घविवरण".repeat(28);
const longBilling = baseBilling({
  hotel: {
    ...unicodeBilling.hotel,
    name: `AAZIRA ${longToken}`,
    address: `Long customer-facing address ${longToken} ${longUnicode}`,
  },
  context: { ...unicodeBilling.context, room_number: longToken },
  items: Array.from({ length: 45 }, (_, index) => ({
    description: `${index === 0 ? longToken : "Menu item"} ${longUnicode} ${index + 1}`,
    quantity: 1,
    unit_price: "499.00",
    subtotal: "499.00",
  })),
});
const longLayout = buildCustomerReceiptLayout(longBilling);
check(longLayout.pages.length > 1, "long receipt paginates instead of clipping vertically");
check(longLayout.pages.flat().filter(line => line.blockKey === "hotel-name").length > 1, "long hotel name wraps");
check(longLayout.pages.flat().filter(line => line.blockKey === "hotel-address").length > 1, "long address wraps");
check(longLayout.pages.flat().filter(line => line.blockKey === "item-0-description").length > 1, "long mixed Unicode item description wraps");
for (const line of longLayout.pages.flat()) {
  check(line.width <= longLayout.contentWidth + 0.001, `line ${line.blockKey || "unknown"} remains within content width`);
  check(line.runs.every(run => run.x >= longLayout.left && run.x + run.width <= longLayout.pageWidth - longLayout.right + 0.001), `line ${line.blockKey || "unknown"} has no horizontal overflow`);
  check(line.y >= longLayout.top && line.y + line.lineHeight <= longLayout.pageHeight - longLayout.bottom + 0.001, `line ${line.blockKey || "unknown"} has no vertical clipping`);
}
const longPdf = await createCustomerReceiptPdf(longBilling);
check(longPdf.subarray(0, 5).toString() === "%PDF-", "long Unicode multi-page receipt generation succeeds");
const flattenedLongLines = longLayout.pages.flatMap((page, pageIndex) => page.map(line => ({ ...line, pageIndex })));
const finalDescription = flattenedLongLines.filter(line => line.blockKey === `item-${longBilling.items.length - 1}-description`).at(-1);
const subtotalLine = flattenedLongLines.find(line => line.financialKey === "subtotal");
check(
  subtotalLine.pageIndex > finalDescription.pageIndex || (subtotalLine.pageIndex === finalDescription.pageIndex && subtotalLine.y > finalDescription.y),
  "wrapped item rows preserve separation before the financial summary",
);

const financialText = lineText(unicodeLayout);
for (const expected of [
  "Subtotal: INR 6499.00",
  "Discount: INR 0.00",
  "Taxable amount: INR 6499.00",
  "Tax: INR 649.90",
  "Total: INR 7148.90",
  "Amount paid: INR 7148.00",
  "Balance due: INR 0.90",
]) check(financialText.includes(expected), `authoritative financial value preserved: ${expected}`);

assert.throws(() => buildCustomerReceiptLayout(baseBilling({ document_type: "invoice", status: "FINALIZED" })), TypeError);
checks++;
await assert.rejects(() => createCustomerReceiptPdf(baseBilling({ status: "VOID" })), TypeError);
checks++;
assert.throws(
  () => buildCustomerReceiptLayout(baseBilling({ hotel: { ...unicodeBilling.hotel, name: "Unsupported emoji 😀" } })),
  error => error instanceof UnsupportedReceiptCharacterError && error.code === "UNSUPPORTED_RECEIPT_CHARACTER",
);
checks++;

console.log(`Customer billing PDF integration: ${checks}/${checks} passed`);
