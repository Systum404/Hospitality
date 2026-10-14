CREATE TABLE "hotel_billing_settings" (
    "hotel_id" UUID NOT NULL,
    "service_charge_enabled" BOOLEAN NOT NULL DEFAULT false,
    "service_charge_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "default_tax_slab_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_billing_settings_pkey" PRIMARY KEY ("hotel_id"),
    CONSTRAINT "ck_hotel_billing_settings_service_charge_rate" CHECK (
      "service_charge_rate" >= 0 AND "service_charge_rate" <= 100
      AND (NOT "service_charge_enabled" OR "service_charge_rate" > 0)
    )
);

CREATE UNIQUE INDEX "uq_tax_slab_hotel_scope" ON "tax_slab"("id", "hotel_id");
CREATE INDEX "idx_hotel_billing_settings_default_tax" ON "hotel_billing_settings"("default_tax_slab_id");

ALTER TABLE "hotel_billing_settings"
  ADD CONSTRAINT "hotel_billing_settings_hotel_id_fkey"
  FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "hotel_billing_settings"
  ADD CONSTRAINT "hotel_billing_settings_default_tax_slab_id_hotel_id_fkey"
  FOREIGN KEY ("default_tax_slab_id", "hotel_id") REFERENCES "tax_slab"("id", "hotel_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "bill" ADD COLUMN "service_charge_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "bill" ADD COLUMN "service_charge_snapshot" JSONB;

INSERT INTO "hotel_billing_settings" ("hotel_id", "service_charge_enabled", "service_charge_rate", "default_tax_slab_id")
SELECT "id", false, 0, NULL FROM "hotel"
ON CONFLICT ("hotel_id") DO NOTHING;
