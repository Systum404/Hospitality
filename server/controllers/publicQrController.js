import { AppError } from "../middleware/errorHandler.js";
import { getPublicMenu, resolvePublicQr, verifyRoomCapability } from "../services/qrService.js";
import { createPublicQrOrder } from "../services/publicQrOrderService.js";

const TOKEN = /^[A-Za-z0-9_-]{32,100}$/;
const fail = (message, code, statusCode = 400) => { throw new AppError(message, { code, statusCode }); };
const qrToken = value => { if (!TOKEN.test(value || "")) fail("QR code is unavailable.", "QR_NOT_AVAILABLE", 404); return value; };
const capability = value => { if (typeof value !== "string" || !TOKEN.test(value)) fail("Room ordering authorization failed.", "INVALID_ROOM_CAPABILITY", 403); return value; };

export async function resolve(req, res, next) { try { res.json({ status: "success", data: await resolvePublicQr(qrToken(req.params.token)) }); } catch (error) { next(error); } }
export async function verify(req, res, next) { try {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length !== 1) fail("A room capability is required.", "INVALID_ROOM_CAPABILITY", 403);
  res.json({ status: "success", data: await verifyRoomCapability(qrToken(req.params.token), capability(req.body.capability)) });
} catch (error) { next(error); } }
export async function menu(req, res, next) { try {
  const token = qrToken(req.params.token);
  const supplied = req.get("x-room-capability");
  res.json({ status: "success", data: await getPublicMenu(token, supplied === undefined ? undefined : capability(supplied)) });
} catch (error) { next(error); } }
export async function order(req, res, next) { try {
  const token = qrToken(req.params.token);
  res.status(201).json({ status: "success", data: { order: await createPublicQrOrder(token, req.get("x-room-capability"), req.get("x-order-tracking-capability"), req.body) } });
} catch (error) { next(error); } }
