BEGIN;

CREATE UNIQUE INDEX "uq_dining_table_area_number"
  ON "dining_table"("hotel_id", "dining_area_id", "table_number");

DROP INDEX "uq_dining_table_number";

COMMIT;
