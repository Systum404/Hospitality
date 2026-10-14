import { AppError } from "../middleware/errorHandler.js";
import {
  deactivateHotelAdmin,
  listHotelAdmins,
  reactivateHotelAdmin,
} from "../services/hotelAdminAssignmentService.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalid(message, code) {
  throw new AppError(message, { code, statusCode: 400 });
}

function validateUuid(value, label, code) {
  if (!UUID_PATTERN.test(value || "")) invalid(`${label} must be a valid UUID.`, code);
}

function validateActionBody(body) {
  if (body === undefined) return;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    invalid("Request body must be an empty JSON object.", "INVALID_REQUEST_BODY");
  }
  const field = Object.keys(body)[0];
  if (field) {
    invalid(`Unsupported Hotel Admin assignment field: ${field}.`, "UNSUPPORTED_HOTEL_ADMIN_ASSIGNMENT_FIELD");
  }
}

function validateTarget(req) {
  validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID");
  validateUuid(req.params.assignmentId, "assignmentId", "INVALID_ASSIGNMENT_ID");
  validateActionBody(req.body);
}

export async function listHotelAdminAssignments(req, res, next) {
  try {
    validateUuid(req.params.hotelId, "hotelId", "INVALID_HOTEL_ID");
    res.status(200).json({ status: "success", data: { admins: await listHotelAdmins(req.params.hotelId) } });
  } catch (error) { next(error); }
}

async function transition(req, res, next, operation) {
  try {
    validateTarget(req);
    const data = await operation(req.params.hotelId, req.params.assignmentId, {
      actor: req.auth,
      requestContext: req.auditContext,
    });
    res.status(200).json({ status: "success", data });
  } catch (error) { next(error); }
}

export async function deactivateHotelAdminAssignment(req, res, next) {
  return transition(req, res, next, deactivateHotelAdmin);
}

export async function reactivateHotelAdminAssignment(req, res, next) {
  return transition(req, res, next, reactivateHotelAdmin);
}
