CREATE SEQUENCE "hotel_code_sequence" AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;

ALTER TABLE "hotel"
  ADD COLUMN "code" VARCHAR(32),
  ADD COLUMN "type" VARCHAR(50),
  ADD COLUMN "city" VARCHAR(100),
  ADD COLUMN "state_province" VARCHAR(100),
  ADD COLUMN "country" VARCHAR(100),
  ADD COLUMN "postal_code" VARCHAR(20),
  ADD COLUMN "currency_code" CHAR(3),
  ADD COLUMN "logo_url" VARCHAR(500),
  ADD COLUMN "website" VARCHAR(500),
  ADD COLUMN "tax_registration_number" VARCHAR(100),
  ADD COLUMN "description" TEXT,
  ADD COLUMN "check_in_time" VARCHAR(5),
  ADD COLUMN "check_out_time" VARCHAR(5);

UPDATE "hotel"
SET "code" = 'HTL-' || lpad(nextval('hotel_code_sequence')::text, 6, '0')
WHERE "code" IS NULL;

ALTER TABLE "hotel"
  ALTER COLUMN "code" SET NOT NULL,
  ALTER COLUMN "code" SET DEFAULT ('HTL-' || lpad(nextval('hotel_code_sequence')::text, 6, '0')),
  DROP COLUMN "total_rooms";

CREATE UNIQUE INDEX "uq_hotel_code" ON "hotel"("code");

ALTER TABLE "hotel"
  ADD CONSTRAINT "hotel_code_format" CHECK ("code" ~ '^HTL-[0-9]+$'),
  ADD CONSTRAINT "hotel_currency_code_format" CHECK ("currency_code" IS NULL OR "currency_code" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "hotel_check_in_time_format" CHECK ("check_in_time" IS NULL OR "check_in_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "hotel_check_out_time_format" CHECK ("check_out_time" IS NULL OR "check_out_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

CREATE FUNCTION "protect_hotel_code"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'HOTEL_CODE_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "trg_hotel_code_immutable"
BEFORE UPDATE OF "code" ON "hotel"
FOR EACH ROW EXECUTE FUNCTION "protect_hotel_code"();
