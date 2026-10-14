import { createRequire } from "node:module";
import PDFDocument from "pdfkit";

const require = createRequire(import.meta.url);

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT = 48;
const RIGHT = 48;
const TOP = 48;
const BOTTOM = 48;
const FOOTER_Y = PAGE_HEIGHT - 36;
const CONTENT_WIDTH = PAGE_WIDTH - LEFT - RIGHT;

const FONT_FILES = Object.freeze({
  "latin-regular": "noto-sans-devanagari-latin-400-normal.woff",
  "latin-bold": "noto-sans-devanagari-latin-700-normal.woff",
  "latin-ext-regular": "noto-sans-devanagari-latin-ext-400-normal.woff",
  "latin-ext-bold": "noto-sans-devanagari-latin-ext-700-normal.woff",
  "devanagari-regular": "noto-sans-devanagari-devanagari-400-normal.woff",
  "devanagari-bold": "noto-sans-devanagari-devanagari-700-normal.woff",
});

const FONT_PATHS = Object.fromEntries(Object.entries(FONT_FILES).map(([name, file]) => [
  name,
  require.resolve(`@fontsource/noto-sans-devanagari/files/${file}`),
]));

const graphemeSegmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
const money = value => `INR ${value}`;
const contextLabel = context => context.type === "room"
  ? `Room ${context.room_number || "-"}${context.booking_from && context.booking_to ? ` | ${context.booking_from} to ${context.booking_to}` : ""}`
  : `${context.dining_area || "Dining area"} | Table ${context.table_number || "-"}`;

export class UnsupportedReceiptCharacterError extends RangeError {
  constructor(codePoints) {
    super(`Receipt text contains characters unsupported by the embedded font: ${codePoints.join(", ")}`);
    this.name = "UnsupportedReceiptCharacterError";
    this.code = "UNSUPPORTED_RECEIPT_CHARACTER";
  }
}

function fontSubsetForCodePoint(codePoint) {
  if (
    (codePoint >= 0x0900 && codePoint <= 0x097f)
    || (codePoint >= 0x1cd0 && codePoint <= 0x1cf9)
    || codePoint === 0x200c
    || codePoint === 0x200d
    || codePoint === 0x20a8
    || codePoint === 0x20b9
    || codePoint === 0x20f0
    || codePoint === 0x25cc
    || (codePoint >= 0xa830 && codePoint <= 0xa839)
    || (codePoint >= 0xa8e0 && codePoint <= 0xa8ff)
    || (codePoint >= 0x11b00 && codePoint <= 0x11b09)
  ) return "devanagari";

  if (
    (codePoint >= 0x0100 && codePoint <= 0x02ba)
    || (codePoint >= 0x02bd && codePoint <= 0x02c5)
    || (codePoint >= 0x02c7 && codePoint <= 0x02cc)
    || (codePoint >= 0x02ce && codePoint <= 0x02d7)
    || (codePoint >= 0x02dd && codePoint <= 0x02ff)
    || codePoint === 0x0304
    || codePoint === 0x0308
    || codePoint === 0x0329
    || (codePoint >= 0x1d00 && codePoint <= 0x1dbf)
    || (codePoint >= 0x1e00 && codePoint <= 0x1e9f)
    || (codePoint >= 0x1ef2 && codePoint <= 0x1eff)
    || codePoint === 0x2020
    || (codePoint >= 0x20a0 && codePoint <= 0x20ab)
    || (codePoint >= 0x20ad && codePoint <= 0x20c0)
    || codePoint === 0x2113
    || (codePoint >= 0x2c60 && codePoint <= 0x2c7f)
    || (codePoint >= 0xa720 && codePoint <= 0xa7ff)
  ) return "latin-ext";

  if (
    codePoint <= 0x00ff
    || codePoint === 0x0131
    || codePoint === 0x0152
    || codePoint === 0x0153
    || (codePoint >= 0x02bb && codePoint <= 0x02bc)
    || codePoint === 0x02c6
    || codePoint === 0x02da
    || codePoint === 0x02dc
    || codePoint === 0x0304
    || codePoint === 0x0308
    || codePoint === 0x0329
    || (codePoint >= 0x2000 && codePoint <= 0x206f)
    || codePoint === 0x20ac
    || codePoint === 0x2122
    || codePoint === 0x2191
    || codePoint === 0x2193
    || codePoint === 0x2212
    || codePoint === 0x2215
    || codePoint === 0xfeff
    || codePoint === 0xfffd
  ) return "latin";

  return null;
}

function selectFont(cluster, bold) {
  const subsets = new Set();
  const unsupported = [];
  for (const character of cluster) {
    const codePoint = character.codePointAt(0);
    const subset = fontSubsetForCodePoint(codePoint);
    if (!subset) unsupported.push(`U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`);
    else subsets.add(subset);
  }
  if (unsupported.length) throw new UnsupportedReceiptCharacterError(unsupported);
  const subset = subsets.has("devanagari") ? "devanagari" : subsets.has("latin-ext") ? "latin-ext" : "latin";
  return `${subset}-${bold ? "bold" : "regular"}`;
}

function registerFonts(document) {
  for (const [name, path] of Object.entries(FONT_PATHS)) document.registerFont(name, path);
}

function normalizeText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").normalize("NFC");
}

function runsForText(text, bold) {
  const runs = [];
  for (const { segment } of graphemeSegmenter.segment(text)) {
    const font = selectFont(segment, bold);
    const last = runs.at(-1);
    if (last?.font === font) last.text += segment;
    else runs.push({ font, text: segment });
  }
  return runs;
}

function measureRuns(document, runs, size) {
  return runs.reduce((total, run) => total + document.font(run.font).fontSize(size).widthOfString(run.text), 0);
}

function lineFromText(document, text, { bold, size }) {
  const runs = runsForText(text, bold);
  let x = LEFT;
  const positionedRuns = runs.map(run => {
    const width = document.font(run.font).fontSize(size).widthOfString(run.text);
    const positioned = { ...run, x, width };
    x += width;
    return positioned;
  });
  return { runs: positionedRuns, text, width: x - LEFT };
}

function splitLongToken(document, token, style, width) {
  const pieces = [];
  let current = "";
  for (const { segment } of graphemeSegmenter.segment(token)) {
    const candidate = `${current}${segment}`;
    if (current && measureRuns(document, runsForText(candidate, style.bold), style.size) > width) {
      pieces.push(current);
      current = segment;
    } else current = candidate;
  }
  if (current) pieces.push(current);
  return pieces;
}

function wrapParagraph(document, paragraph, style, width) {
  if (!paragraph) return [""];
  const tokens = paragraph.split(/(\s+)/u).filter(Boolean);
  const lines = [];
  let current = "";

  const pushCurrent = () => {
    if (current) lines.push(current.trimEnd());
    current = "";
  };

  for (const token of tokens) {
    if (/^\s+$/u.test(token) && !current) continue;
    const candidate = `${current}${token}`;
    if (measureRuns(document, runsForText(candidate, style.bold), style.size) <= width) {
      current = candidate;
      continue;
    }
    pushCurrent();
    if (/^\s+$/u.test(token)) continue;
    const tokenWidth = measureRuns(document, runsForText(token, style.bold), style.size);
    if (tokenWidth <= width) current = token;
    else {
      const pieces = splitLongToken(document, token, style, width);
      lines.push(...pieces.slice(0, -1));
      current = pieces.at(-1) || "";
    }
  }
  pushCurrent();
  return lines.length ? lines : [""];
}

function wrapText(document, text, style, width = CONTENT_WIDTH) {
  return normalizeText(text).split("\n").flatMap(paragraph => wrapParagraph(document, paragraph, style, width));
}

function receiptBlocks(billing) {
  const issued = billing.issued_at
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: billing.hotel.timezone }).format(new Date(billing.issued_at))
    : "-";
  return [
    { text: billing.hotel.name || "Hotel", size: 18, bold: true, blockKey: "hotel-name" },
    ...(billing.hotel.address ? [{ text: billing.hotel.address, size: 10, blockKey: "hotel-address" }] : []),
    { text: `RECEIPT | ${billing.invoice_number}`, size: 14, bold: true, gap: 8, blockKey: "receipt-reference" },
    { text: `Issued: ${issued}`, size: 10, blockKey: "issued-at" },
    { text: contextLabel(billing.context), size: 10, gap: 8, blockKey: "context" },
    { text: "ITEMS", size: 11, bold: true, blockKey: "items-heading" },
    ...billing.items.flatMap((item, index) => [
      { text: item.description, size: 10, bold: true, blockKey: `item-${index}-description` },
      { text: `${item.quantity} x ${money(item.unit_price)} | Subtotal ${money(item.subtotal)}`, size: 9, blockKey: `item-${index}-amount` },
    ]),
    { text: `Subtotal: ${money(billing.subtotal)}`, size: 10, gap: 8, financialKey: "subtotal" },
    { text: `Discount: ${money(billing.discount_amount)}`, size: 10, financialKey: "discount" },
    ...(billing.service_charge_amount !== "0.00" ? [{ text: `Service charge: ${money(billing.service_charge_amount)}`, size: 10, financialKey: "service-charge" }] : []),
    { text: `Taxable amount: ${money(billing.taxable_subtotal)}`, size: 10, financialKey: "taxable" },
    { text: `Tax: ${money(billing.tax_amount)}`, size: 10, financialKey: "tax" },
    { text: `Total: ${money(billing.total_amount)}`, size: 12, bold: true, financialKey: "total" },
    { text: `Amount paid: ${money(billing.amount_paid)}`, size: 10, financialKey: "paid" },
    { text: `Balance due: ${money(billing.balance_due)}`, size: 10, financialKey: "balance" },
    { text: `Status: ${billing.payment_status}`, size: 10, gap: 8, blockKey: "status" },
    { text: "RECORDED PAYMENTS", size: 11, bold: true, blockKey: "payments-heading" },
    ...billing.payments.map((payment, index) => ({
      text: `${payment.method} | ${money(payment.amount)} | ${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: billing.hotel.timezone }).format(new Date(payment.recorded_at))}`,
      size: 9,
      blockKey: `payment-${index}`,
    })),
    { text: "Payment execution is handled separately by the company.", size: 8, gap: 10, blockKey: "footer-note" },
  ];
}

export function buildCustomerReceiptLayout(billing) {
  if (billing.document_type !== "receipt" || billing.status !== "PAID") throw new TypeError("A paid customer receipt is required.");
  const metrics = new PDFDocument({ autoFirstPage: false });
  registerFonts(metrics);
  const pages = [[]];
  let y = TOP;

  for (const block of receiptBlocks(billing)) {
    y += block.gap || 0;
    const style = { bold: Boolean(block.bold), size: block.size || 10 };
    const lineHeight = Math.max(13, style.size * 1.35);
    for (const text of wrapText(metrics, block.text, style)) {
      if (y + lineHeight > PAGE_HEIGHT - BOTTOM) {
        pages.push([]);
        y = TOP;
      }
      const line = lineFromText(metrics, text, style);
      pages.at(-1).push({ ...line, y, lineHeight, size: style.size, bold: style.bold, blockKey: block.blockKey || block.financialKey || null, financialKey: block.financialKey || null });
      y += lineHeight;
    }
  }
  metrics.end();
  return { pageHeight: PAGE_HEIGHT, pageWidth: PAGE_WIDTH, contentWidth: CONTENT_WIDTH, left: LEFT, right: RIGHT, top: TOP, bottom: BOTTOM, pages };
}

function renderLine(document, line) {
  document.markContent("Span", { actual: line.text });
  for (const run of line.runs) {
    document.font(run.font).fontSize(line.size).text(run.text, run.x, line.y, { lineBreak: false });
  }
  document.endMarkedContent();
}

export async function createCustomerReceiptPdf(billing) {
  const layout = buildCustomerReceiptLayout(billing);
  const document = new PDFDocument({ autoFirstPage: false, bufferPages: true, compress: true, margin: 0, size: [PAGE_WIDTH, PAGE_HEIGHT] });
  registerFonts(document);
  const chunks = [];
  document.on("data", chunk => chunks.push(chunk));
  const completed = new Promise((resolve, reject) => {
    document.once("end", () => resolve(Buffer.concat(chunks)));
    document.once("error", reject);
  });

  for (const page of layout.pages) {
    document.addPage({ margin: 0, size: [PAGE_WIDTH, PAGE_HEIGHT] });
    for (const line of page) renderLine(document, line);
  }
  const { count } = document.bufferedPageRange();
  for (let index = 0; index < count; index++) {
    document.switchToPage(index);
    document.font("latin-regular").fontSize(8).text(`Page ${index + 1} of ${count}`, PAGE_WIDTH - 96, FOOTER_Y, { lineBreak: false });
  }
  document.end();
  return completed;
}
