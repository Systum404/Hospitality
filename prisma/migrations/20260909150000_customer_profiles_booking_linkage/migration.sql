BEGIN;

-- Phase 17 is safe only while all historical customer links remain null.
-- Existing bookings and orders intentionally remain snapshot-only records.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "customer")
     OR EXISTS (SELECT 1 FROM "room_booking" WHERE "customer_id" IS NOT NULL)
     OR EXISTS (SELECT 1 FROM "orders" WHERE "customer_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'CUSTOMER_LINKAGE_REQUIRES_RECONCILIATION';
  END IF;
END $$;

ALTER TABLE "room_booking" DROP CONSTRAINT "room_booking_customer_id_fkey";
ALTER TABLE "orders" DROP CONSTRAINT "orders_customer_id_fkey";

-- A booking accepts the same validated 255-character guest name as before.
-- The full name is stored without speculative first/last-name parsing.
ALTER TABLE "customer" ALTER COLUMN "first_name" TYPE VARCHAR(255);

CREATE UNIQUE INDEX "uq_customer_hotel_scope" ON "customer"("id", "hotel_id");

ALTER TABLE "room_booking"
ADD CONSTRAINT "room_booking_customer_id_hotel_id_fkey"
FOREIGN KEY ("customer_id", "hotel_id")
REFERENCES "customer"("id", "hotel_id")
ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "orders"
ADD CONSTRAINT "orders_customer_id_hotel_id_fkey"
FOREIGN KEY ("customer_id", "hotel_id")
REFERENCES "customer"("id", "hotel_id")
ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
