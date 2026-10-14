import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "../config/audit.js";
import { ROLE_KEYS } from "../config/roles.js";
import { createAuditEvent } from "./auditService.js";
import { notifyActiveHotelRoleUsers } from "./operationalNotificationService.js";

const taxSlabFields = {
  id: true,
  name: true,
  rate: true,
  applicable_on: true,
  is_active: true,
  created_at: true,
  updated_at: true,
};

function serializeTaxSlab({ rate, ...taxSlab }) {
  return { ...taxSlab, rate: rate.toFixed(2) };
}

async function requireHotel(hotelId) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { id: true } });
  if (!hotel) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
}
async function lockHotel(client, hotelId) {
  const rows = await client.$queryRaw`SELECT id FROM hotel WHERE id = ${hotelId}::uuid FOR UPDATE`;
  if (!rows.length) throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
}

async function requireHotelTaxSlab(hotelId, taxSlabId, client = prisma) {
  const taxSlab = await client.tax_slab.findFirst({
    where: { id: taxSlabId, hotel_id: hotelId },
    select: taxSlabFields,
  });
  if (!taxSlab) throw new AppError("Tax slab not found for this hotel.", { code: "TAX_SLAB_NOT_FOUND", statusCode: 404 });
  return taxSlab;
}

export async function getTaxSlabsForHotel(hotelId) {
  await requireHotel(hotelId);
  const taxSlabs = await prisma.tax_slab.findMany({
    where: { hotel_id: hotelId },
    orderBy: { name: "asc" },
    select: taxSlabFields,
  });
  return taxSlabs.map(serializeTaxSlab);
}

export async function createTaxSlab(hotelId, input) {
  return prisma.$transaction(async (transaction) => {
    await lockHotel(transaction, hotelId);
    return serializeTaxSlab(await transaction.tax_slab.create({ data: { id: randomUUID(), hotel_id: hotelId, ...input }, select: taxSlabFields }));
  });
}

async function clearDefaultTax(transaction, hotelId, taxSlabId, audit) {
  const settings = await transaction.hotel_billing_settings.findUnique({ where: { hotel_id: hotelId }, select: { default_tax_slab_id: true } });
  if (settings?.default_tax_slab_id !== taxSlabId) return false;
  await transaction.hotel_billing_settings.update({ where: { hotel_id: hotelId }, data: { default_tax_slab_id: null, updated_at: new Date() } });
  if (audit) {
    const common = { ...audit, hotelId, targetId: hotelId, targetType: AUDIT_TARGET_TYPES.HOTEL_BILLING_SETTINGS, metadata: { changed_fields: ["default_tax_slab_id"] } };
    await createAuditEvent(transaction, { ...common, action: AUDIT_ACTIONS.HOTEL_BILLING_SETTINGS_UPDATED });
    await createAuditEvent(transaction, { ...common, action: AUDIT_ACTIONS.HOTEL_DEFAULT_TAX_UPDATED });
  }
  await notifyActiveHotelRoleUsers(transaction, hotelId, ROLE_KEYS.HOTEL_ADMIN, {
    eventKey: `default-tax-cleared:${taxSlabId}`,
    type: "billing_settings",
    title: "Default Tax Selection Required",
    message: "The configured default tax became unavailable. Select another active tax in Settings.",
  });
  return true;
}

export async function updateTaxSlab(hotelId, taxSlabId, input, audit = null) {
  return prisma.$transaction(async (transaction) => {
    await lockHotel(transaction, hotelId);
    await requireHotelTaxSlab(hotelId, taxSlabId, transaction);
    if (input.is_active === false) await clearDefaultTax(transaction, hotelId, taxSlabId, audit);
    const result = await transaction.tax_slab.updateMany({ where: { id: taxSlabId, hotel_id: hotelId }, data: input });
    if (result.count !== 1) throw new AppError("Tax slab not found for this hotel.", { code: "TAX_SLAB_NOT_FOUND", statusCode: 404 });
    return serializeTaxSlab(await requireHotelTaxSlab(hotelId, taxSlabId, transaction));
  });
}

export async function deleteTaxSlab(hotelId, taxSlabId, audit = null) {
  await requireHotel(hotelId);
  try {
    return await prisma.$transaction(async (transaction) => {
      await lockHotel(transaction, hotelId);
      const taxSlab = await requireHotelTaxSlab(hotelId, taxSlabId, transaction);
      await clearDefaultTax(transaction, hotelId, taxSlabId, audit);
      const result = await transaction.tax_slab.deleteMany({ where: { id: taxSlabId, hotel_id: hotelId } });
      if (result.count !== 1) throw new AppError("Tax slab not found for this hotel.", { code: "TAX_SLAB_NOT_FOUND", statusCode: 404 });
      return serializeTaxSlab(taxSlab);
    });
  } catch (error) {
    if (error?.code === "P2003") {
      throw new AppError("Tax slab cannot be deleted while dependent records reference it.", {
        code: "TAX_SLAB_HAS_DEPENDENCIES",
        statusCode: 409,
      });
    }
    throw error;
  }
}
