import { AppError } from "../middleware/errorHandler.js";
import { getManagerRestaurantOrders } from "../services/managerRestaurantOrderService.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateManagerRestaurantOrderHotelId(req, _res, next) {
  if (!UUID.test(req.params.hotelId || "")) {
    return next(new AppError("hotelId must be a valid UUID.", {
      code: "INVALID_HOTEL_ID",
      statusCode: 400,
    }));
  }
  return next();
}

export async function listManagerRestaurantOrders(req, res, next) {
  try {
    const orders = await getManagerRestaurantOrders(req.params.hotelId);
    res.json({ status: "success", data: { restaurant_orders: orders } });
  } catch (error) {
    next(error);
  }
}
