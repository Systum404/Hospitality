import { AppError } from "../middleware/errorHandler.js";
import { getKitchenOrders, updateKitchenOrderStatus, validateKitchenStatus } from "../services/kitchenService.js";
const uuid = (value, field, code) => { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new AppError(`${field} must be a valid UUID.`, { code, statusCode: 400 }); };
export const validateKitchenHotelId = (req, _res, next) => { try { uuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID"); next(); } catch (error) { next(error); } };
export async function listKitchenOrders(req, res, next) { try { res.json({ status: "success", data: { orders: await getKitchenOrders(req.params.hotelId) } }); } catch (error) { next(error); } }
export async function patchKitchenOrderStatus(req, res, next) { try { uuid(req.params.orderId, "orderId", "INVALID_KITCHEN_ORDER_ID"); res.json({ status: "success", data: { order: await updateKitchenOrderStatus(req.params.hotelId, req.params.orderId, validateKitchenStatus(req.body)) } }); } catch (error) { next(error); } }
