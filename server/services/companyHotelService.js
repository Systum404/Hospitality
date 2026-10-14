import { randomUUID } from "node:crypto";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "../config/audit.js";
import { INITIAL_HOTEL_BILLING_SETTINGS } from "../config/hotelBillingSettings.js";
import { HOTEL_STATUSES } from "../config/hotelLifecycle.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { createAuditEvent } from "./auditService.js";
import { getHotelEntitlementUsage } from "./hotelEntitlementService.js";

const hotelProjection = {
  id: true,
  code: true,
  name: true,
  type: true,
  address: true,
  city: true,
  state_province: true,
  country: true,
  postal_code: true,
  phone: true,
  email: true,
  timezone: true,
  currency_code: true,
  status: true,
  plan: true,
  logo_url: true,
  website: true,
  tax_registration_number: true,
  description: true,
  check_in_time: true,
  check_out_time: true,
  created_at: true,
  updated_at: true,
  _count: { select: { room: true } },
};

function serialize(hotel) {
  const { _count, address, email, ...safe } = hotel;
  return {
    ...safe,
    address_line: address,
    official_email: email,
    room_count: _count.room,
  };
}

function notFound() {
  return new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
}

function translate(error) {
  if (error?.code === "P2002") {
    return new AppError("A generated hotel code conflict occurred.", {
      code: "HOTEL_CODE_CONFLICT",
      statusCode: 409,
    });
  }
  return error;
}

export async function listCompanyHotels({ page, pageSize }) {
  const where = {};
  const [total, hotels] = await prisma.$transaction([
    prisma.hotel.count({ where }),
    prisma.hotel.findMany({
      where,
      orderBy: [{ created_at: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: hotelProjection,
    }),
  ]);
  return { items: hotels.map(serialize), page, pageSize, total };
}

export async function getCompanyHotel(hotelId) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: hotelProjection });
  if (!hotel) throw notFound();
  return { ...serialize(hotel), entitlement: await getHotelEntitlementUsage(prisma, hotelId) };
}

export async function createCompanyHotel(input, audit) {
  try {
    return await prisma.$transaction(async transaction => {
      const hotel = await transaction.hotel.create({
        data: {
          ...input,
          id: randomUUID(),
          status: HOTEL_STATUSES.ACTIVE,
          billing_settings: { create: { ...INITIAL_HOTEL_BILLING_SETTINGS } },
        },
        select: hotelProjection,
      });
      await createAuditEvent(transaction, {
        ...audit,
        action: AUDIT_ACTIONS.HOTEL_CREATED,
        hotelId: hotel.id,
        metadata: { hotel_code: hotel.code },
        targetId: hotel.id,
        targetType: AUDIT_TARGET_TYPES.HOTEL,
      });
      return serialize(hotel);
    });
  } catch (error) {
    throw translate(error);
  }
}

export async function updateCompanyHotel(hotelId, input, audit) {
  try {
    return await prisma.$transaction(async transaction => {
      const existing = await transaction.hotel.findUnique({ where: { id: hotelId }, select: { id: true } });
      if (!existing) throw notFound();
      const hotel = await transaction.hotel.update({
        where: { id: hotelId },
        data: { ...input, updated_at: new Date() },
        select: hotelProjection,
      });
      await createAuditEvent(transaction, {
        ...audit,
        action: AUDIT_ACTIONS.HOTEL_METADATA_UPDATED,
        hotelId: hotel.id,
        metadata: { changed_fields: Object.keys(input) },
        targetId: hotel.id,
        targetType: AUDIT_TARGET_TYPES.HOTEL,
      });
      return serialize(hotel);
    });
  } catch (error) {
    throw translate(error);
  }
}
