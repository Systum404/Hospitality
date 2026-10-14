import { randomUUID } from "node:crypto";
import { ROLE_KEYS } from "../config/roles.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";
import { notifyActiveHotelRoleUsers } from "./operationalNotificationService.js";

const fields = {
  id: true, hotel_id: true, name: true, category: true, quantity: true, unit: true,
  minimum_quantity: true, supplier_id: true, last_restocked: true, created_at: true, updated_at: true,
  vendor: { select: { id: true, name: true } },
};

function serialize({ quantity, minimum_quantity, last_restocked, ...item }) {
  return {
    ...item,
    quantity: quantity.toFixed(2),
    minimum_quantity: minimum_quantity.toFixed(2),
    last_restocked: last_restocked ? last_restocked.toISOString().slice(0, 10) : null,
  };
}

async function requireHotel(client, hotelId) {
  if (!await client.hotel.findUnique({ where: { id: hotelId }, select: { id: true } })) {
    throw new AppError("Hotel not found.", { code: "HOTEL_NOT_FOUND", statusCode: 404 });
  }
}

async function requireInventory(client, hotelId, inventoryId) {
  const item = await client.inventory.findFirst({ where: { id: inventoryId, hotel_id: hotelId }, select: fields });
  if (!item) throw new AppError("Inventory item not found.", { code: "INVENTORY_NOT_FOUND", statusCode: 404 });
  return item;
}

async function lockInventory(client, hotelId, inventoryId) {
  const rows = await client.$queryRaw`
    SELECT id
    FROM inventory
    WHERE id = ${inventoryId}::uuid AND hotel_id = ${hotelId}::uuid
    FOR UPDATE
  `;
  if (!rows.length) throw new AppError("Inventory item not found.", { code: "INVENTORY_NOT_FOUND", statusCode: 404 });
}

async function requireVendor(client, hotelId, vendorId) {
  if (vendorId === undefined || vendorId === null) return;
  if (!await client.vendor.findFirst({ where: { id: vendorId, hotel_id: hotelId }, select: { id: true } })) {
    throw new AppError("Vendor not found for this hotel.", { code: "VENDOR_NOT_FOUND", statusCode: 404 });
  }
}

export async function getInventoryItems(hotelId) {
  await requireHotel(prisma, hotelId);
  return (await prisma.inventory.findMany({
    where: { hotel_id: hotelId, OR: [{ supplier_id: null }, { vendor: { is: { hotel_id: hotelId } } }] },
    orderBy: { created_at: "desc" }, select: fields,
  })).map(serialize);
}

export async function createInventoryItem(hotelId, input) {
  await requireHotel(prisma, hotelId);
  await requireVendor(prisma, hotelId, input.supplier_id);
  return serialize(await prisma.inventory.create({ data: { id: randomUUID(), hotel_id: hotelId, ...input }, select: fields }));
}

export async function updateInventoryItem(hotelId, inventoryId, input) {
  return prisma.$transaction(async client => {
    await requireHotel(client, hotelId);
    await lockInventory(client, hotelId, inventoryId);
    const current = await requireInventory(client, hotelId, inventoryId);
    await requireVendor(client, hotelId, input.supplier_id);
    const wasAboveMinimum = current.quantity.greaterThan(current.minimum_quantity);
    const nextQuantity = Object.hasOwn(input, "quantity") ? new current.quantity.constructor(input.quantity) : current.quantity;
    const nextMinimum = Object.hasOwn(input, "minimum_quantity") ? new current.minimum_quantity.constructor(input.minimum_quantity) : current.minimum_quantity;
    const crossesIntoLowStock = wasAboveMinimum && nextQuantity.lessThanOrEqualTo(nextMinimum);
    const result = await client.inventory.updateMany({ where: { id: inventoryId, hotel_id: hotelId }, data: input });
    if (result.count !== 1) throw new AppError("Inventory item not found.", { code: "INVENTORY_NOT_FOUND", statusCode: 404 });
    const updated = await requireInventory(client, hotelId, inventoryId);
    if (crossesIntoLowStock) {
      await notifyActiveHotelRoleUsers(client, hotelId, ROLE_KEYS.MANAGER, {
        eventKey: `inventory-low:${inventoryId}:${randomUUID()}`,
        type: "manager_operational",
        title: "Low Stock Alert",
        message: `${updated.name} is at or below its configured minimum stock level.`,
      });
    }
    return serialize(updated);
  });
}

export async function deleteInventoryItem(hotelId, inventoryId) {
  await requireHotel(prisma, hotelId);
  const item = await requireInventory(prisma, hotelId, inventoryId);
  await prisma.inventory.deleteMany({ where: { id: inventoryId, hotel_id: hotelId } });
  return serialize(item);
}
