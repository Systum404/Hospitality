BEGIN;

-- Booking boundaries are hotel calendar dates. Capture their established
-- hotel-local interpretation before changing the physical column type.
CREATE TEMP TABLE "phase15_booking_dates_before" ON COMMIT DROP AS
SELECT
  booking.id,
  (booking.booking_from AT TIME ZONE hotel.timezone)::date AS booking_from,
  (booking.booking_to AT TIME ZONE hotel.timezone)::date AS booking_to
FROM "room_booking" AS booking
JOIN "hotel" AS hotel ON hotel.id = booking.hotel_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "room_booking" AS booking
    JOIN "hotel" AS hotel ON hotel.id = booking.hotel_id
    WHERE booking.booking_from AT TIME ZONE hotel.timezone
            <> date_trunc('day', booking.booking_from AT TIME ZONE hotel.timezone)
       OR booking.booking_to AT TIME ZONE hotel.timezone
            <> date_trunc('day', booking.booking_to AT TIME ZONE hotel.timezone)
  ) THEN
    RAISE EXCEPTION 'BOOKING_DATE_CONVERSION_REQUIRES_RECONCILIATION';
  END IF;
END $$;

CREATE FUNCTION "phase15_booking_local_date"(target_hotel uuid, target_value timestamptz)
RETURNS date
LANGUAGE sql
STABLE
STRICT
SET search_path = public
AS $$
  SELECT (target_value AT TIME ZONE hotel.timezone)::date
  FROM hotel
  WHERE hotel.id = target_hotel
$$;

ALTER TABLE "room_booking"
DROP CONSTRAINT "room_booking_no_overlap",
DROP CONSTRAINT "room_booking_dates_check";

ALTER TABLE "room_booking"
ALTER COLUMN "booking_from" TYPE date
  USING "phase15_booking_local_date"("hotel_id", "booking_from"),
ALTER COLUMN "booking_to" TYPE date
  USING "phase15_booking_local_date"("hotel_id", "booking_to");

DROP FUNCTION "phase15_booking_local_date"(uuid, timestamptz);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "room_booking" AS booking
    JOIN "phase15_booking_dates_before" AS previous USING (id)
    WHERE booking.booking_from <> previous.booking_from
       OR booking.booking_to <> previous.booking_to
  ) THEN
    RAISE EXCEPTION 'BOOKING_DATE_CONVERSION_CHANGED_LOGICAL_DATE';
  END IF;
END $$;

ALTER TABLE "room_booking"
ADD CONSTRAINT "room_booking_dates_check"
CHECK ("booking_to" > "booking_from"),
ADD CONSTRAINT "room_booking_no_overlap"
EXCLUDE USING gist (
  "hotel_id" WITH =,
  "room_id" WITH =,
  daterange("booking_from", "booking_to", '[)') WITH &&
)
WHERE ("status" IN ('reserved', 'confirmed', 'checked-in'));

COMMIT;
