import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { AppError } from "../middleware/errorHandler.js";

const publicFields = { id:true, hotel_id:true, first_name:true, last_name:true, phone:true, email:true, created_at:true, updated_at:true };
const serialize = customer => ({ ...customer, name:[customer.first_name,customer.last_name].filter(Boolean).join(" ") });

async function requireHotel(client, hotelId) {
  if (!await client.hotel.findUnique({where:{id:hotelId},select:{id:true}})) {
    throw new AppError("Hotel not found.",{code:"HOTEL_NOT_FOUND",statusCode:404});
  }
}

export async function resolveBookingCustomer(client, hotelId, { name, phone, email }) {
  const matches=await client.customer.findMany({where:{hotel_id:hotelId,phone},take:2,select:publicFields});
  if(matches.length>1)throw new AppError("Multiple customer profiles match this hotel and phone number.",{code:"CUSTOMER_IDENTITY_CONFLICT",statusCode:409});
  if(matches.length===1)return matches[0];
  return client.customer.create({data:{id:randomUUID(),hotel_id:hotelId,first_name:name,last_name:null,phone,email:email??null},select:publicFields});
}

export async function searchCustomers(hotelId, phone) {
  await requireHotel(prisma,hotelId);
  return (await prisma.customer.findMany({where:{hotel_id:hotelId,phone},orderBy:{created_at:"asc"},take:2,select:publicFields})).map(serialize);
}

export async function getCustomer(hotelId, customerId) {
  await requireHotel(prisma,hotelId);
  const customer=await prisma.customer.findFirst({where:{id:customerId,hotel_id:hotelId},select:publicFields});
  if(!customer)throw new AppError("Customer not found.",{code:"CUSTOMER_NOT_FOUND",statusCode:404});
  return serialize(customer);
}
