-- Vendor data-model update: replace the retired category field with nullable supplier details.
DROP INDEX "idx_vendor_category";

ALTER TABLE "vendor"
  DROP COLUMN "category",
  ADD COLUMN "items_supplied" TEXT,
  ADD COLUMN "payment_terms" TEXT;
