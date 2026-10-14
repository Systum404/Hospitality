import { prisma } from "../../db/prisma.js";

export async function deleteHotelFixtures(hotelIds) {
  if (!hotelIds.length) return;
  await prisma.$transaction(async transaction => {
    await transaction.payment.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.bill_item.deleteMany({ where: { bill: { hotel_id: { in: hotelIds } } } });
    await transaction.bill.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.order_item.deleteMany({ where: { orders: { hotel_id: { in: hotelIds } } } });
    await transaction.orders.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.attendance.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.notification.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.qr_code.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.room_booking.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.discount_menu_category.deleteMany({ where: { discount: { hotel_id: { in: hotelIds } } } });
    await transaction.discount_menu_item.deleteMany({ where: { discount: { hotel_id: { in: hotelIds } } } });
    await transaction.discount.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.menu_item.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.menu_category.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.inventory.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.vendor.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.dining_table.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.dining_area.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.room.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.customer.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.hotel_billing_settings.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.tax_slab.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.user_role.deleteMany({ where: { hotel_id: { in: hotelIds } } });
    await transaction.hotel.deleteMany({ where: { id: { in: hotelIds } } });
  });
}
