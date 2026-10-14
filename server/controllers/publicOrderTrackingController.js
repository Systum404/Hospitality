import { getPublicOrderTracking } from "../services/orderTrackingService.js";

export async function get(req, res, next) {
  try {
    const order = await getPublicOrderTracking(req.get("x-order-tracking-capability"));
    res.json({ status: "success", data: { order } });
  } catch (error) {
    next(error);
  }
}
