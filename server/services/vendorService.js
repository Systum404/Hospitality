import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";

const fields = { id:true, hotel_id:true, name:true, contact_person:true, phone:true, email:true, address:true, items_supplied:true, payment_terms:true, rating:true, is_active:true, created_at:true, updated_at:true };
const serialize = ({ rating, ...vendor }) => ({ ...vendor, rating: rating.toFixed(2) });
async function hotel(client, hotelId) { if (!await client.hotel.findUnique({ where:{id:hotelId}, select:{id:true} })) throw new AppError("Hotel not found.",{code:"HOTEL_NOT_FOUND",statusCode:404}); }
async function vendor(client, hotelId, vendorId) { const row=await client.vendor.findFirst({where:{id:vendorId,hotel_id:hotelId},select:fields}); if(!row) throw new AppError("Vendor not found.",{code:"VENDOR_NOT_FOUND",statusCode:404}); return row; }
export async function getVendors(hotelId) { await hotel(prisma,hotelId); return (await prisma.vendor.findMany({where:{hotel_id:hotelId},orderBy:{created_at:"desc"},select:fields})).map(serialize); }
export async function createVendor(hotelId,input) { await hotel(prisma,hotelId); return serialize(await prisma.vendor.create({data:{id:randomUUID(),hotel_id:hotelId,...input},select:fields})); }
export async function updateVendor(hotelId,vendorId,input) { await hotel(prisma,hotelId); await vendor(prisma,hotelId,vendorId); await prisma.vendor.updateMany({where:{id:vendorId,hotel_id:hotelId},data:input}); return serialize(await vendor(prisma,hotelId,vendorId)); }
export async function deleteVendor(hotelId,vendorId) { return prisma.$transaction(async tx=>{
  await hotel(tx,hotelId);
  await tx.$queryRaw`
    SELECT id
    FROM vendor
    WHERE id = ${vendorId}::uuid
      AND hotel_id = ${hotelId}::uuid
    FOR UPDATE
  `;
  const row=await vendor(tx,hotelId,vendorId);
  if(await tx.inventory.count({where:{supplier_id:vendorId}}))throw new AppError("Vendor cannot be deleted while inventory references it.",{code:"VENDOR_HAS_INVENTORY",statusCode:409});
  await tx.vendor.deleteMany({where:{id:vendorId,hotel_id:hotelId}});
  return serialize(row);
}); }
