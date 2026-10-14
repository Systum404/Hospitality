// Explicit local-only integration test. Fixtures are uniquely named and removed in finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import pg from "pg";
import { app } from "../app.js";
import { environment } from "../config/environment.js";
import { prisma } from "../db/prisma.js";
import { createAuthenticationToken } from "../services/tokenService.js";
import { entitledHotelFixture } from "./helpers/entitledHotelFixture.js";
import { deleteHotelFixtures } from "./helpers/hotelFixtureCleanup.js";

const target = new URL(environment.databaseUrl);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/hms", "Local hms only");
const countModels = ["hotel","users","user_role","room","room_booking","orders","order_item","bill","bill_item","payment","notification"];
const counts = async () => Object.fromEntries(await Promise.all(countModels.map(async name => [name, await prisma[name].count()])));
const before = await counts();
const historicalBookingsBefore = await prisma.room_booking.findMany({
  orderBy:{id:"asc"},
  include:{orders:{orderBy:{id:"asc"},include:{order_item:{orderBy:{id:"asc"}}}},bill:{include:{items:{orderBy:{position:"asc"}},payments:{orderBy:{created_at:"asc"}}}}},
});
const hotelId=randomUUID(), otherHotelId=randomUUID(), userIds=[];
let server;
const results=[];
const pass=(name)=>results.push(name);

function localToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const values=Object.fromEntries(parts.filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  return new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`);
}
const base=localToday();
const day=(offset)=>new Date(base.getTime()+offset*86400000).toISOString().slice(0,10);

try {
await prisma.hotel.createMany({data:[{id:hotelId,name:`Booking test ${hotelId}`,status:"ACTIVE",timezone:"Asia/Kolkata"},{id:otherHotelId,name:`Booking test ${otherHotelId}`,status:"ACTIVE",timezone:"Asia/Kolkata"}].map(entitledHotelFixture)});
  const tokens={}; const password_hash=await argon2.hash(randomUUID(),{type:argon2.argon2id});
  for(const roleName of ["Reception","Manager","Admin","Captain","Kitchen"]){const role=await prisma.role.findUniqueOrThrow({where:{name:roleName}});const userId=randomUUID(),assignmentId=randomUUID();userIds.push(userId);await prisma.users.create({data:{id:userId,email:`${userId}@booking-test.invalid`,name:"Booking test",password_hash}});await prisma.user_role.create({data:{id:assignmentId,user_id:userId,role_id:role.id,hotel_id:hotelId}});tokens[roleName]=await createAuthenticationToken({userId,userRoleId:assignmentId},600);}
  const rooms={active:randomUUID(),second:randomUUID(),lifecycle:randomUUID(),overdue:randomUUID(),inactive:randomUUID(),other:randomUUID()};
  await prisma.room.createMany({data:[{id:rooms.active,hotel_id:hotelId,room_number:"BOOK-A",status:"active",capacity:2,base_price:"100.00"},{id:rooms.second,hotel_id:hotelId,room_number:"BOOK-B",status:"active",capacity:4,base_price:"200.00"},{id:rooms.lifecycle,hotel_id:hotelId,room_number:"BOOK-L",status:"active",capacity:2,base_price:"100.00"},{id:rooms.overdue,hotel_id:hotelId,room_number:"BOOK-D",status:"active",capacity:2,base_price:"100.00"},{id:rooms.inactive,hotel_id:hotelId,room_number:"BOOK-X",status:"inactive",capacity:2,base_price:"100.00"},{id:rooms.other,hotel_id:otherHotelId,room_number:"BOOK-O",status:"active",capacity:2,base_price:"100.00"}]});
  server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const request=async(method,path,data,expected=200,role="Reception",tenant=hotelId)=>{const response=await fetch(`${origin}/api/hotels/${tenant}${path}`,{method,headers:{...(role?{Cookie:`aazira_auth=${tokens[role]||"invalid"}`}:{ }),"Content-Type":"application/json"},...(data!==undefined?{body:JSON.stringify(data)}:{})});const payload=await response.json();assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(payload)}`);return payload;};
  const input=(extra={})=>({room_id:rooms.active,customer_name:"Test Guest",customer_phone:"0000000000",adults:1,children:0,booking_from:day(0),booking_to:day(2),status:"reserved",...extra});
  const create=async(extra={},expected=201)=>request("POST","/room-bookings",input(extra),expected);
  const status=async(id,next,expected=200,role="Reception")=>request("PATCH",`/room-bookings/${id}/status`,{status:next},expected,role);
  const patch=async(id,data,expected=200)=>request("PATCH",`/room-bookings/${id}`,data,expected);
  const remove=async(id,expected=200,role="Manager",tenant=hotelId)=>request("DELETE",`/room-bookings/${id}`,undefined,expected,role,tenant);

  const primary=(await create()).data.room_booking;assert.equal(primary.booking_from,day(0));assert.equal(primary.booking_to,day(2));pass("date-only booking creation and retrieval preserve calendar dates");
  assert.equal((await create({room_id:rooms.second,booking_from:new Date(base.getTime()+3600000).toISOString(),booking_to:day(2)},400)).error.code,"INVALID_ROOM_BOOKING");pass("non-midnight timestamp is rejected for a date-only booking");
  assert.equal((await create({room_id:rooms.second,booking_from:"2026-02-30",booking_to:"2026-03-02"},400)).error.code,"INVALID_ROOM_BOOKING");pass("invalid calendar date is rejected");
  assert.equal((await create({room_id:rooms.second,booking_from:"2026-13-01",booking_to:"2027-01-02"},400)).error.code,"INVALID_ROOM_BOOKING");pass("out-of-range calendar date is rejected safely");
  assert.equal((await create({booking_to:day(0)},400)).error.code,"INVALID_BOOKING_DATES");pass("zero-night booking fails");
  await create({room_id:rooms.second,booking_from:day(20),booking_to:day(21),adults:-1},400);pass("negative adults fails");
  await create({room_id:rooms.second,booking_from:day(20),booking_to:day(21),children:-1},400);pass("negative children fails");
  await create({room_id:rooms.second,booking_from:day(20),booking_to:day(21),adults:0,children:0},400);pass("zero occupants fails");
  await create({room_id:rooms.active,booking_from:day(20),booking_to:day(21),adults:3},400);pass("capacity overflow fails");
  assert.equal((await create({room_id:rooms.inactive,booking_from:day(20),booking_to:day(21)},409)).error.code,"ROOM_NOT_ACTIVE");pass("inactive room fails");
  await create({room_id:rooms.other,booking_from:day(20),booking_to:day(21)},404);pass("cross-hotel room fails");
  assert.equal((await create({booking_from:day(1),booking_to:day(3)},409)).error.code,"ROOM_BOOKING_OVERLAP");pass("overlapping reserved fails");
  await create({booking_from:day(1),booking_to:day(3),status:"confirmed"},409);pass("overlapping confirmed fails");
  await status(primary.id,"confirmed");pass("reserved to confirmed succeeds");
  await create({booking_from:day(1),booking_to:day(3)},409);pass("confirmed booking blocks");
  const confirmedAgain=await status(primary.id,"confirmed");assert.equal(confirmedAgain.data.room_booking.status,"confirmed");pass("repeated confirmation idempotent");
  const checkedIn=(await status(primary.id,"checked-in")).data.room_booking;assert.ok(checkedIn.checked_in_at);pass("confirmed to checked-in succeeds");
  assert.equal((await create({booking_from:day(2),booking_to:day(3)},409)).error.code,"ROOM_OPERATIONALLY_OCCUPIED");pass("checked-in room blocks even at its scheduled departure boundary");
  const checkedInAgain=(await status(primary.id,"checked-in")).data.room_booking;assert.equal(checkedInAgain.checked_in_at,checkedIn.checked_in_at);pass("repeated check-in preserves timestamp");
  await status(primary.id,"checked-out");pass("explicit checkout releases operational occupancy");
  const boundary=(await create({booking_from:day(2),booking_to:day(3)})).data.room_booking;pass("exact checkout/start boundary succeeds");
  const cancelled=(await create({room_id:rooms.second,booking_from:day(5),booking_to:day(7)})).data.room_booking;await status(cancelled.id,"cancelled");await create({room_id:rooms.second,booking_from:day(5),booking_to:day(7)});pass("cancelled booking does not block");
  const cancelledAgain=await status(cancelled.id,"cancelled");assert.equal(cancelledAgain.data.room_booking.status,"cancelled");pass("repeated cancellation idempotent");
  await status(cancelled.id,"confirmed",409);pass("cancelled cannot reopen");
  const checkoutSource=(await create({room_id:rooms.second,booking_from:day(0),booking_to:day(1),status:"confirmed"})).data.room_booking;await status(checkoutSource.id,"checked-in");const checkedOut=(await status(checkoutSource.id,"checked-out")).data.room_booking;pass("checked-in to checked-out succeeds");
  const checkedOutAgain=(await status(checkoutSource.id,"checked-out")).data.room_booking;assert.equal(checkedOutAgain.checked_out_at,checkedOut.checked_out_at);pass("repeated checkout preserves timestamp");
  await create({room_id:rooms.second,booking_from:day(0),booking_to:day(1)});pass("checked-out booking does not block");
  await status(checkoutSource.id,"confirmed",409);pass("checked-out cannot reopen");
  await status(boundary.id,"checked-in",409);pass("reserved to checked-in forbidden");
  const cancelConfirmed=(await create({room_id:rooms.second,booking_from:day(8),booking_to:day(9),status:"confirmed"})).data.room_booking;await status(cancelConfirmed.id,"cancelled");pass("confirmed to cancelled succeeds");
  const early=(await create({room_id:rooms.second,booking_from:day(30),booking_to:day(31),status:"confirmed"})).data.room_booking;assert.equal((await status(early.id,"checked-in",409)).error.code,"BOOKING_CHECK_IN_WINDOW_INVALID");pass("early check-in fails");
  const past=(await create({room_id:rooms.second,booking_from:day(-2),booking_to:day(0),status:"confirmed"})).data.room_booking;await status(past.id,"checked-in",409);pass("check-in on checkout date fails");
  const inactiveCheckIn=(await create({room_id:rooms.second,booking_from:day(10),booking_to:day(11),status:"confirmed"})).data.room_booking;await prisma.room.update({where:{id:rooms.second},data:{status:"inactive"}});await status(inactiveCheckIn.id,"checked-in",409);await prisma.room.update({where:{id:rooms.second},data:{status:"active"}});pass("inactive room cannot check in");
  const editable=(await create({room_id:rooms.second,booking_from:day(12),booking_to:day(14)})).data.room_booking;await patch(editable.id,{customer_name:"Edited Guest",customer_phone:"1111111111",room_id:rooms.second,adults:2,children:1,booking_from:day(12),booking_to:day(15)});pass("reserved booking edits allowed fields");
  await status(editable.id,"confirmed");await patch(editable.id,{notes:"Confirmed edit"});pass("confirmed booking edits allowed fields");
  await patch(editable.id,{paid_amount:"1.00"},400);pass("edit rejects paid amount");
  await patch(editable.id,{payment_status:"paid"},400);pass("edit rejects payment status");
  await patch(editable.id,{total_amount:"1.00"},400);pass("edit rejects financial total");
  const originalRate=(await request("GET","/room-bookings")).data.room_bookings.find(b=>b.id===editable.id).room_rate;await prisma.room.update({where:{id:rooms.second},data:{base_price:"999.00"}});const editedAgain=(await patch(editable.id,{notes:"Rate preserved"})).data.room_booking;assert.equal(editedAgain.room_rate,originalRate);pass("historical room rate preserved");
  const overlapEdit=(await create({room_id:rooms.second,booking_from:day(16),booking_to:day(18)})).data.room_booking;await patch(overlapEdit.id,{room_id:rooms.active,booking_from:day(2),booking_to:day(3)},409);pass("changing room into conflict fails");
  await patch(overlapEdit.id,{booking_from:day(17),booking_to:day(19)});const datesConflict=(await create({room_id:rooms.second,booking_from:day(19),booking_to:day(21)})).data.room_booking;await patch(datesConflict.id,{booking_from:day(18)},409);pass("changing dates into conflict fails");
  const lifecycle=(await create({room_id:rooms.lifecycle,booking_from:day(0),booking_to:day(1),status:"confirmed"})).data.room_booking;
  await status(lifecycle.id,"checked-in");
  await patch(lifecycle.id,{room_id:rooms.second},409);pass("checked-in room change forbidden");
  await patch(lifecycle.id,{booking_to:day(4)},409);pass("checked-in dates change forbidden");
  await patch(lifecycle.id,{customer_phone:"2222222222"});pass("checked-in contact edit allowed");
  await status(lifecycle.id,"checked-out");await patch(lifecycle.id,{notes:"forbidden"},409);pass("checked-out immutable");
  await patch(cancelled.id,{notes:"forbidden"},409);pass("cancelled immutable");
  const available=await request("GET",`/room-availability?from=${encodeURIComponent(day(22))}&to=${encodeURIComponent(day(23))}&capacity=2`);assert.ok(available.data.rooms.every(r=>r.status==="active"&&r.capacity>=2));pass("availability returns active capacity-fitting rooms");
  const unavailable=await request("GET",`/room-availability?from=${encodeURIComponent(day(17))}&to=${encodeURIComponent(day(18))}`);assert.ok(!unavailable.data.rooms.some(r=>r.id===rooms.second));pass("availability excludes overlap");
  const selfAvailable=await request("GET",`/room-availability?from=${encodeURIComponent(day(17))}&to=${encodeURIComponent(day(19))}&bookingId=${overlapEdit.id}`);assert.ok(selfAvailable.data.rooms.some(r=>r.id===rooms.second));pass("availability edit excludes own booking");
  const overdueId=randomUUID();
  await prisma.room_booking.create({data:{id:overdueId,hotel_id:hotelId,room_id:rooms.overdue,booking_number:`OVERDUE-${randomUUID()}`,customer_name:"Overdue Guest",customer_phone:"0",adults:1,children:0,booking_from:new Date(`${day(-5)}T00:00:00.000Z`),booking_to:new Date(`${day(-3)}T00:00:00.000Z`),status:"checked-in",room_rate:"100.00",total_amount:"200.00",paid_amount:"0.00",payment_status:"pending",checked_in_at:new Date()}});
  const overdueAvailability=await request("GET",`/room-availability?from=${encodeURIComponent(day(30))}&to=${encodeURIComponent(day(31))}`);assert.ok(!overdueAvailability.data.rooms.some(r=>r.id===rooms.overdue));pass("overdue checked-in room is excluded from future availability");
  assert.equal((await create({room_id:rooms.overdue,booking_from:day(30),booking_to:day(31)},409)).error.code,"ROOM_OPERATIONALLY_OCCUPIED");pass("overdue checked-in room rejects a new reservation");
  await status(overdueId,"checked-out");
  const releasedAvailability=await request("GET",`/room-availability?from=${encodeURIComponent(day(30))}&to=${encodeURIComponent(day(31))}`);assert.ok(releasedAvailability.data.rooms.some(r=>r.id===rooms.overdue));pass("overdue checkout releases room availability");
  await request("GET",`/room-availability?from=${encodeURIComponent(day(1))}&to=${encodeURIComponent(day(1))}`,undefined,400);pass("availability rejects zero interval");
  await request("GET","/room-bookings",undefined,401,null);pass("unauthenticated denied");
  await request("GET","/room-bookings",undefined,200,"Reception");pass("Reception allowed");
  await request("GET","/room-bookings",undefined,200,"Manager");pass("Manager allowed");
  await request("GET","/room-bookings",undefined,403,"Admin");pass("Admin denied");
  await request("GET","/room-bookings",undefined,403,"Captain");pass("Captain denied");
  await request("GET","/room-bookings",undefined,403,"Kitchen");pass("Kitchen denied");
  await request("GET","/room-bookings",undefined,403,"Reception",otherHotelId);pass("cross-hotel URL denied");

  const receptionDelete=(await create({room_id:rooms.second,booking_from:day(60),booking_to:day(61)})).data.room_booking;
  const countBeforeReceptionDelete=await prisma.room_booking.count({where:{hotel_id:hotelId}});
  await remove(receptionDelete.id,403,"Reception");
  assert.equal(await prisma.room_booking.count({where:{hotel_id:hotelId}}),countBeforeReceptionDelete);
  assert.equal((await prisma.room_booking.findUnique({where:{id:receptionDelete.id}})).status,"reserved");
  pass("Reception cannot physically delete a booking");
  await remove(receptionDelete.id,403,"Admin");pass("Admin cannot physically delete a booking");
  await remove(receptionDelete.id,403,"Captain");pass("Captain cannot physically delete a booking");
  await remove(receptionDelete.id,403,"Kitchen");pass("Kitchen cannot physically delete a booking");
  await remove(receptionDelete.id,401,null);pass("unauthenticated delete denied");
  await remove("not-a-uuid",400,"Manager");pass("delete validates booking UUID");
  await remove(receptionDelete.id,403,"Manager",otherHotelId);pass("delete rejects a cross-hotel URL");

  await status(receptionDelete.id,"cancelled",200,"Reception");
  assert.equal((await prisma.room_booking.findUnique({where:{id:receptionDelete.id}})).status,"cancelled");
  await remove(receptionDelete.id,409,"Manager");
  assert.ok(await prisma.room_booking.findUnique({where:{id:receptionDelete.id}}));
  pass("Reception cancellation preserves immutable booking history");

  const reservedDelete=(await create({room_id:rooms.second,booking_from:day(62),booking_to:day(63)})).data.room_booking;
  await remove(reservedDelete.id,200,"Manager");
  assert.equal(await prisma.room_booking.findUnique({where:{id:reservedDelete.id}}),null);
  pass("Manager can delete an unused reserved booking");
  const confirmedDelete=(await create({room_id:rooms.second,booking_from:day(64),booking_to:day(65),status:"confirmed"})).data.room_booking;
  await remove(confirmedDelete.id,200,"Manager");
  assert.equal(await prisma.room_booking.findUnique({where:{id:confirmedDelete.id}}),null);
  pass("Manager can delete an unused confirmed booking");

  const checkedInDelete=(await create({room_id:rooms.active,booking_from:day(0),booking_to:day(1),status:"confirmed"})).data.room_booking;
  await status(checkedInDelete.id,"checked-in",200,"Reception");
  await remove(checkedInDelete.id,409,"Manager");
  assert.equal((await prisma.room_booking.findUnique({where:{id:checkedInDelete.id}})).status,"checked-in");
  pass("checked-in booking deletion is rejected");
  await status(checkedInDelete.id,"checked-out",200,"Reception");
  await remove(checkedInDelete.id,409,"Manager");
  assert.equal((await prisma.room_booking.findUnique({where:{id:checkedInDelete.id}})).status,"checked-out");
  pass("checked-out booking deletion is rejected");

  const orderDelete=(await create({room_id:rooms.second,booking_from:day(66),booking_to:day(67)})).data.room_booking;
  const dependentOrder=await prisma.orders.create({data:{id:randomUUID(),hotel_id:hotelId,room_booking_id:orderDelete.id,order_number:`BOOK-ORDER-${randomUUID()}`,source:"room_qr",customer_name:orderDelete.customer_name,customer_phone:orderDelete.customer_phone,status:"pending",payment_status:"pending"}});
  await remove(orderDelete.id,409,"Manager");
  assert.ok(await prisma.room_booking.findUnique({where:{id:orderDelete.id}}));
  assert.ok(await prisma.orders.findUnique({where:{id:dependentOrder.id}}));
  pass("booking with a room-service order cannot be deleted");
  await prisma.orders.delete({where:{id:dependentOrder.id}});
  await remove(orderDelete.id,200,"Manager");

  const foreignBooking=await prisma.room_booking.create({data:{id:randomUUID(),hotel_id:otherHotelId,room_id:rooms.other,booking_number:`BOOK-OTHER-${randomUUID()}`,customer_name:"Other hotel guest",customer_phone:"0",adults:1,children:0,booking_from:new Date(day(68)),booking_to:new Date(day(69)),status:"reserved",room_rate:"100.00",total_amount:"100.00",paid_amount:"0.00",payment_status:"pending"}});
  await remove(foreignBooking.id,404,"Manager",hotelId);
  assert.ok(await prisma.room_booking.findUnique({where:{id:foreignBooking.id}}));
  pass("booking ID from another hotel cannot be deleted");

  // Concurrent API requests serialize on the hotel lock; only one overlapping write succeeds.
  const raceRoom=randomUUID();await prisma.room.create({data:{id:raceRoom,hotel_id:hotelId,room_number:"BOOK-RACE",status:"active",capacity:2,base_price:"50.00"}});
  const raceInput=input({room_id:raceRoom,booking_from:day(40),booking_to:day(42)});
  const racePath=`/api/hotels/${hotelId}/room-bookings`;
  const raceResponses=await Promise.all([fetch(`${origin}${racePath}`,{method:"POST",headers:{"Content-Type":"application/json",Cookie:`aazira_auth=${tokens.Manager}`},body:JSON.stringify(raceInput)}),fetch(`${origin}${racePath}`,{method:"POST",headers:{"Content-Type":"application/json",Cookie:`aazira_auth=${tokens.Manager}`},body:JSON.stringify(raceInput)})]);
  const raceStatuses=raceResponses.map(response=>response.status).sort((a,b)=>a-b);assert.deepEqual(raceStatuses,[201,409]);
  const raceBodies=await Promise.all(raceResponses.map(response=>response.json()));assert.equal(raceBodies.find(body=>body.status==="error")?.error?.code,"ROOM_BOOKING_OVERLAP");pass("concurrent API conflict controlled");
  const successfulRaceBooking=raceBodies.find(body=>body.status==="success")?.data?.room_booking;
  assert.ok(successfulRaceBooking);
  const raceNotifications=await prisma.notification.findMany({where:{hotel_id:hotelId,event_key:`booking-created:${successfulRaceBooking.id}`}});
  assert.equal(raceNotifications.length,1);
  assert.equal(raceNotifications[0].user_id,userIds[0]);
  assert.equal(await prisma.notification.count({where:{hotel_id:hotelId,title:"New Room Booking",message:{contains:"Room BOOK-RACE."}}}),1);
  pass("concurrent booking attempts create notifications only for the one successful logical booking");

  // Independent database writers prove the exclusion constraint itself is authoritative.
  const directRoom=randomUUID();await prisma.room.create({data:{id:directRoom,hotel_id:hotelId,room_number:"BOOK-DB-RACE",status:"active",capacity:2,base_price:"50.00"}});
  const client=new pg.Client({connectionString:environment.databaseUrl});await client.connect();
  try { await prisma.room_booking.create({data:{id:randomUUID(),hotel_id:hotelId,room_id:directRoom,booking_number:`DB-${randomUUID()}`,customer_name:"DB test",customer_phone:"0",adults:1,children:0,booking_from:new Date(day(50)),booking_to:new Date(day(52)),status:"reserved",room_rate:"1",total_amount:"2",paid_amount:"0",payment_status:"pending"}});await assert.rejects(client.query(`INSERT INTO room_booking (id,hotel_id,room_id,booking_number,customer_name,customer_phone,adults,children,booking_from,booking_to,status,room_rate,total_amount,paid_amount,payment_status) VALUES ($1,$2,$3,$4,$5,$6,1,0,$7,$8,'confirmed',1,2,0,'pending')`,[randomUUID(),hotelId,directRoom,`DB-${randomUUID()}`,"DB test","0",day(51),day(53)]),error=>error.code==="23P01");pass("database exclusion constraint rejects overlap"); } finally {await client.end();}

  const health=await fetch(`${origin}/api/health`);assert.equal(health.status,200);assert.equal((await health.json()).database,"connected");pass("health connected");
} finally {
  if(server)await new Promise(resolve=>server.close(resolve));
  await prisma.users.deleteMany({where:{id:{in:userIds}}});
  await deleteHotelFixtures([hotelId,otherHotelId]);
  const after=await counts();assert.deepEqual(after,before);
  const historicalBookingsAfter = await prisma.room_booking.findMany({orderBy:{id:"asc"},include:{orders:{orderBy:{id:"asc"},include:{order_item:{orderBy:{id:"asc"}}}},bill:{include:{items:{orderBy:{position:"asc"}},payments:{orderBy:{created_at:"asc"}}}}}});
  assert.deepEqual(JSON.parse(JSON.stringify(historicalBookingsAfter)),JSON.parse(JSON.stringify(historicalBookingsBefore)));
  console.log(JSON.stringify({checks:results.length,results,countsBeforeAndAfter:after,cleanup:"All temporary hotel, user, room, booking, order, and financial records removed.",historicalBookings:`${historicalBookingsAfter.length} unchanged`}));
  await prisma.$disconnect();
}
