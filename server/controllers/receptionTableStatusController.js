import { getReceptionTableStatus } from "../services/receptionTableStatusService.js";

export async function list(req, res, next) {
  try {
    res.json({ status: "success", data: { tables: await getReceptionTableStatus(req.hotelId) } });
  } catch (error) {
    next(error);
  }
}
