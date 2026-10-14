DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM hotel
    WHERE lower(status) NOT IN ('active', 'inactive')
  ) THEN
    RAISE EXCEPTION 'Unexpected hotel status prevents lifecycle migration';
  END IF;
END $$;

CREATE TYPE "hotel_status" AS ENUM ('ACTIVE', 'INACTIVE');

ALTER TABLE "hotel"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "hotel_status"
    USING upper("status")::"hotel_status",
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- Hotel data is retained through lifecycle changes. Direct hotel ownership must
-- never become an accidental cascade-delete path for operational history.
ALTER TABLE "attendance" DROP CONSTRAINT "attendance_hotel_id_fkey";
ALTER TABLE "customer" DROP CONSTRAINT "customer_hotel_id_fkey";
ALTER TABLE "dining_area" DROP CONSTRAINT "dining_area_hotel_id_fkey";
ALTER TABLE "dining_table" DROP CONSTRAINT "dining_table_hotel_id_fkey";
ALTER TABLE "discount" DROP CONSTRAINT "discount_hotel_id_fkey";
ALTER TABLE "inventory" DROP CONSTRAINT "inventory_hotel_id_fkey";
ALTER TABLE "menu_category" DROP CONSTRAINT "menu_category_hotel_id_fkey";
ALTER TABLE "menu_item" DROP CONSTRAINT "menu_item_hotel_id_fkey";
ALTER TABLE "notification" DROP CONSTRAINT "notification_hotel_id_fkey";
ALTER TABLE "orders" DROP CONSTRAINT "orders_hotel_id_fkey";
ALTER TABLE "qr_code" DROP CONSTRAINT "qr_code_hotel_id_fkey";
ALTER TABLE "room" DROP CONSTRAINT "room_hotel_id_fkey";
ALTER TABLE "room_booking" DROP CONSTRAINT "room_booking_hotel_id_fkey";
ALTER TABLE "tax_slab" DROP CONSTRAINT "tax_slab_hotel_id_fkey";
ALTER TABLE "user_role" DROP CONSTRAINT "user_role_hotel_id_fkey";
ALTER TABLE "vendor" DROP CONSTRAINT "vendor_hotel_id_fkey";

ALTER TABLE "attendance" ADD CONSTRAINT "attendance_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "customer" ADD CONSTRAINT "customer_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "dining_area" ADD CONSTRAINT "dining_area_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "dining_table" ADD CONSTRAINT "dining_table_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "discount" ADD CONSTRAINT "discount_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "menu_category" ADD CONSTRAINT "menu_category_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "notification" ADD CONSTRAINT "notification_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "orders" ADD CONSTRAINT "orders_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "qr_code" ADD CONSTRAINT "qr_code_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "room" ADD CONSTRAINT "room_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "room_booking" ADD CONSTRAINT "room_booking_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tax_slab" ADD CONSTRAINT "tax_slab_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- This database gate closes the check/write race. It complements the HTTP
-- middleware and also protects current-source services called outside Express.
CREATE FUNCTION "assert_active_hotel_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  scoped_hotel_id uuid;
  lifecycle_status "hotel_status";
BEGIN
  scoped_hotel_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.hotel_id ELSE NEW.hotel_id END;
  SELECT status INTO lifecycle_status FROM hotel WHERE id = scoped_hotel_id FOR SHARE;
  IF lifecycle_status IS DISTINCT FROM 'ACTIVE'::"hotel_status" THEN
    RAISE EXCEPTION 'HOTEL_INACTIVE' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION "assert_active_order_item_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  lifecycle_status "hotel_status";
BEGIN
  SELECT h.status INTO lifecycle_status
  FROM hotel h JOIN orders o ON o.hotel_id = h.id
  WHERE o.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END
  FOR SHARE OF h;
  IF lifecycle_status IS DISTINCT FROM 'ACTIVE'::"hotel_status" THEN
    RAISE EXCEPTION 'HOTEL_INACTIVE' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION "assert_active_bill_item_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  lifecycle_status "hotel_status";
BEGIN
  SELECT h.status INTO lifecycle_status
  FROM hotel h JOIN bill b ON b.hotel_id = h.id
  WHERE b.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.bill_id ELSE NEW.bill_id END
  FOR SHARE OF h;
  IF lifecycle_status IS DISTINCT FROM 'ACTIVE'::"hotel_status" THEN
    RAISE EXCEPTION 'HOTEL_INACTIVE' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION "assert_active_discount_mapping_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  lifecycle_status "hotel_status";
BEGIN
  SELECT h.status INTO lifecycle_status
  FROM hotel h JOIN discount d ON d.hotel_id = h.id
  WHERE d.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.discount_id ELSE NEW.discount_id END
  FOR SHARE OF h;
  IF lifecycle_status IS DISTINCT FROM 'ACTIVE'::"hotel_status" THEN
    RAISE EXCEPTION 'HOTEL_INACTIVE' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'attendance', 'bill', 'customer', 'dining_area', 'dining_table',
    'discount', 'inventory', 'menu_category', 'menu_item', 'notification',
    'orders', 'payment', 'qr_code', 'room', 'room_booking', 'tax_slab',
    'user_role', 'vendor'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION assert_active_hotel_mutation()',
      'trg_' || table_name || '_active_hotel', table_name
    );
  END LOOP;
END $$;

CREATE TRIGGER "trg_order_item_active_hotel" BEFORE INSERT OR UPDATE OR DELETE ON "order_item"
FOR EACH ROW EXECUTE FUNCTION "assert_active_order_item_mutation"();

CREATE TRIGGER "trg_bill_item_active_hotel" BEFORE INSERT OR UPDATE OR DELETE ON "bill_item"
FOR EACH ROW EXECUTE FUNCTION "assert_active_bill_item_mutation"();

CREATE TRIGGER "trg_discount_menu_category_active_hotel" BEFORE INSERT OR UPDATE OR DELETE ON "discount_menu_category"
FOR EACH ROW EXECUTE FUNCTION "assert_active_discount_mapping_mutation"();

CREATE TRIGGER "trg_discount_menu_item_active_hotel" BEFORE INSERT OR UPDATE OR DELETE ON "discount_menu_item"
FOR EACH ROW EXECUTE FUNCTION "assert_active_discount_mapping_mutation"();
