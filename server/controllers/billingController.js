import { AppError } from "../middleware/errorHandler.js";
import * as billing from "../services/billingService.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (message) => { throw new AppError(message, { code: "INVALID_BILLING_REQUEST", statusCode: 400 }); };
export function validateBillingIds(req, _res, next) {
  for (const [key, value] of Object.entries(req.params)) if (!uuid.test(value)) invalid(`${key} must be a UUID.`);
  next();
}
function body(req, allowed) {
  const input = req.body ?? {};
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("Expected a JSON object.");
  if (Object.keys(input).some(key => !allowed.includes(key))) invalid("Unsupported billing fields. Financial totals are calculated by the server.");
  return input;
}
function selectionBody(req) {
  const input = body(req, ["tax_slab_id", "discount_id", "service_charge_rate"]);
  for (const key of ["tax_slab_id", "discount_id"]) {
    if (Object.hasOwn(input, key) && input[key] !== null && (typeof input[key] !== "string" || !uuid.test(input[key]))) {
      invalid(`${key} must be a UUID or null.`);
    }
  }
  if (Object.hasOwn(input, "service_charge_rate")) {
    const value = input.service_charge_rate;
    if (!["string", "number"].includes(typeof value) || !/^\+?\d{1,3}(?:\.\d{1,2})?$/.test(String(value).trim())) invalid("service_charge_rate must be a decimal with at most two places.");
    const number = Number(value);
    if (number < 0 || number > 100) invalid("service_charge_rate must be between 0 and 100.");
    input.service_charge_rate = number.toFixed(2);
  }
  return input;
}
const send = (res, bill, status = 200) => res.status(status).json({ status: "success", data: { bill } });
export async function list(req, res) {
  const [bills, timezone] = await Promise.all([billing.listBills(req.auth), billing.getBillingTimezone(req.auth)]);
  res.json({ status: "success", data: { bills, summary: billing.summarizeBills(bills), timezone } });
}
export async function options(req, res) { res.json({ status: "success", data: await billing.listBillingOptions(req.auth) }); }
export async function detail(req, res) { send(res, await billing.getBill(req.auth, req.params.billId)); }
export async function createRoom(req, res) { send(res, await billing.createBill(req.auth, "ROOM", req.params.bookingId, selectionBody(req)), 201); }
export async function createCaptain(req, res) { send(res, await billing.createBill(req.auth, "CAPTAIN", req.params.orderId, selectionBody(req)), 201); }
export async function recalculate(req, res) { send(res, await billing.refreshBill(req.auth, req.params.billId, selectionBody(req))); }
export async function finalize(req, res) { send(res, await billing.refreshBill(req.auth, req.params.billId, selectionBody(req), true)); }
export async function voidBill(req, res) { body(req, []); send(res, await billing.voidBill(req.auth, req.params.billId)); }
export async function payments(req, res) {
  const bill = await billing.getBill(req.auth, req.params.billId);
  res.json({ status: "success", data: { payments: bill.payments } });
}
export async function pay(req, res) {
  const input = body(req, ["amount", "method", "reference", "notes", "idempotency_key"]);
  if (!["string", "number"].includes(typeof input.amount) || !/^\d{1,10}(?:\.\d{1,2})?$/.test(String(input.amount)) || billing.minor(input.amount) <= 0n) invalid("Payment must be positive, with at most two decimal places.");
  if (!["Cash", "UPI", "Card"].includes(input.method)) invalid("Payment method must be Cash, UPI, or Card.");
  if (typeof input.idempotency_key !== "string" || !uuid.test(input.idempotency_key)) invalid("A UUID idempotency_key is required for safe payment retries.");
  for (const [key, max] of [["reference", 255], ["notes", 2000]]) {
    if (input[key] != null && (typeof input[key] !== "string" || input[key].length > max)) invalid(`Invalid ${key}.`);
  }
  send(res, await billing.recordPayment(req.auth, req.params.billId, { ...input, amount: billing.money(billing.minor(input.amount)), reference: input.reference ?? null, notes: input.notes ?? null }), 201);
}
