CREATE OR REPLACE FUNCTION "assert_active_hotel_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  scoped_hotel_id uuid;
  lifecycle_status "hotel_status";
BEGIN
  scoped_hotel_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.hotel_id ELSE NEW.hotel_id END;

  -- COMPANY-scoped user_role assignments intentionally have no hotel.
  IF scoped_hotel_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  SELECT status INTO lifecycle_status FROM hotel WHERE id = scoped_hotel_id FOR SHARE;
  IF lifecycle_status IS DISTINCT FROM 'ACTIVE'::"hotel_status" THEN
    RAISE EXCEPTION 'HOTEL_INACTIVE' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
