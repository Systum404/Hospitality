-- Phase 1 room-booking integrity. Existing data was audited before this migration.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "hotel"
ADD COLUMN "timezone" VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata';

ALTER TABLE "room_booking"
ADD CONSTRAINT "room_booking_dates_check"
CHECK ("booking_to" > "booking_from"),
ADD CONSTRAINT "room_booking_adults_check"
CHECK ("adults" >= 0),
ADD CONSTRAINT "room_booking_children_check"
CHECK ("children" >= 0),
ADD CONSTRAINT "room_booking_occupants_check"
CHECK (("adults" + "children") >= 1),
ADD CONSTRAINT "room_booking_no_overlap"
EXCLUDE USING gist (
  "hotel_id" WITH =,
  "room_id" WITH =,
  tstzrange("booking_from", "booking_to", '[)') WITH &&
)
WHERE ("status" IN ('reserved', 'confirmed', 'checked-in'));
