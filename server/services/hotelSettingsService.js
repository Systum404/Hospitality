import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "../config/audit.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { createAuditEvent } from "./auditService.js";

const hotelFields = {
  id: true, code: true, name: true, type: true, address: true, city: true,
  state_province: true, country: true, postal_code: true, phone: true, email: true,
  timezone: true, logo_url: true, website: true, tax_registration_number: true,
  description: true, check_in_time: true, check_out_time: true, status: true,
};

const settingsFields = {
  service_charge_enabled: true,
  service_charge_rate: true,
  default_tax_slab_id: true,
  updated_at: true,
  default_tax_slab: { select: { id: true, name: true, rate: true, is_active: true } },
};

const fail = (message, code, statusCode) => { throw new AppError(message, { code, statusCode }); };
const serializeDecimal = value => value == null ? value : value.toFixed(2);
const serializeTax = tax => tax ? { ...tax, rate: serializeDecimal(tax.rate) } : null;
const serializeHotel = ({ address, email, ...hotel }) => ({ ...hotel, address_line: address, official_email: email });
const serializeSettings = settings => ({
  service_charge_enabled: settings.service_charge_enabled,
  service_charge_rate: serializeDecimal(settings.service_charge_rate),
  default_tax_slab_id: settings.default_tax_slab_id,
  default_tax: serializeTax(settings.default_tax_slab),
  updated_at: settings.updated_at.toISOString(),
});

async function lockHotel(tx, hotelId) {
  const rows = await tx.$queryRaw`SELECT id FROM hotel WHERE id = ${hotelId}::uuid FOR UPDATE`;
  if (!rows.length) fail("Hotel not found.", "HOTEL_NOT_FOUND", 404);
}

export async function getHotelSettings(hotelId) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: hotelFields });
  if (!hotel) fail("Hotel not found.", "HOTEL_NOT_FOUND", 404);
  const [settings, taxOptions] = await Promise.all([
    prisma.hotel_billing_settings.findUnique({ where: { hotel_id: hotelId }, select: settingsFields }),
    prisma.tax_slab.findMany({
      where: { hotel_id: hotelId, is_active: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, rate: true, applicable_on: true },
    }),
  ]);
  if (!settings) fail("Hotel billing settings are not initialized.", "HOTEL_BILLING_SETTINGS_NOT_INITIALIZED", 409);
  return {
    hotel: serializeHotel(hotel),
    billing: serializeSettings(settings),
    active_tax_options: taxOptions.map(tax => ({ ...tax, rate: serializeDecimal(tax.rate) })),
  };
}

export async function updateHotelBillingSettings(hotelId, input, audit) {
  return prisma.$transaction(async tx => {
    await lockHotel(tx, hotelId);
    const current = await tx.hotel_billing_settings.findUnique({ where: { hotel_id: hotelId }, select: settingsFields });
    if (!current) fail("Hotel billing settings are not initialized.", "HOTEL_BILLING_SETTINGS_NOT_INITIALIZED", 409);
    if (input.default_tax_slab_id) {
      const tax = await tx.tax_slab.findFirst({ where: { id: input.default_tax_slab_id, hotel_id: hotelId }, select: { is_active: true } });
      if (!tax) fail("Default tax slab not found for this hotel.", "DEFAULT_TAX_NOT_FOUND", 404);
      if (!tax.is_active) fail("Default tax slab must be active.", "DEFAULT_TAX_INACTIVE", 409);
    }
    const effectiveEnabled = input.service_charge_enabled ?? current.service_charge_enabled;
    const effectiveRate = input.service_charge_rate ?? serializeDecimal(current.service_charge_rate);
    if (effectiveEnabled && Number(effectiveRate) <= 0) {
      fail("An enabled service charge requires a positive rate.", "INVALID_SERVICE_CHARGE", 400);
    }
    const changedFields = Object.keys(input).filter(key => {
      const currentValue = key === "service_charge_rate" ? serializeDecimal(current[key]) : current[key];
      return currentValue !== input[key];
    });
    if (!changedFields.length) return serializeSettings(current);
    const updated = await tx.hotel_billing_settings.update({
      where: { hotel_id: hotelId },
      data: { ...input, updated_at: new Date() },
      select: settingsFields,
    });
    const auditBase = {
      ...audit, hotelId, targetId: hotelId, targetType: AUDIT_TARGET_TYPES.HOTEL_BILLING_SETTINGS,
      metadata: { changed_fields: changedFields },
    };
    await createAuditEvent(tx, { ...auditBase, action: AUDIT_ACTIONS.HOTEL_BILLING_SETTINGS_UPDATED });
    if (changedFields.some(field => field.startsWith("service_charge_"))) {
      await createAuditEvent(tx, { ...auditBase, action: AUDIT_ACTIONS.HOTEL_SERVICE_CHARGE_UPDATED });
    }
    if (changedFields.includes("default_tax_slab_id")) {
      await createAuditEvent(tx, { ...auditBase, action: AUDIT_ACTIONS.HOTEL_DEFAULT_TAX_UPDATED });
    }
    return serializeSettings(updated);
  });
}

export async function updateHotelMetadata(hotelId, input, audit) {
  return prisma.$transaction(async tx => {
    await lockHotel(tx, hotelId);
    const current = await tx.hotel.findUnique({ where: { id: hotelId }, select: hotelFields });
    if (!current) fail("Hotel not found.", "HOTEL_NOT_FOUND", 404);
    const changedFields = Object.keys(input).filter(key => current[key] !== input[key]);
    if (!changedFields.length) return serializeHotel(current);
    const updated = await tx.hotel.update({ where: { id: hotelId }, data: { ...input, updated_at: new Date() }, select: hotelFields });
    await createAuditEvent(tx, {
      ...audit, action: AUDIT_ACTIONS.HOTEL_METADATA_UPDATED, hotelId,
      metadata: { changed_fields: changedFields }, targetId: hotelId, targetType: AUDIT_TARGET_TYPES.HOTEL,
    });
    return serializeHotel(updated);
  });
}
